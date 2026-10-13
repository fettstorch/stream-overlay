import { unzipSync } from "fflate";

export class CustomBundleError extends Error {}
export type CustomBundleFiles = { files: Map<string, Uint8Array>; bytes: number };
const expandedLimit = 50_000_000;
export function unpackCustomBundle(bytes: Uint8Array): CustomBundleFiles {
  if (!bytes.length || bytes.length > 10_000_000)
    throw new CustomBundleError("ZIP apps must be between 1 byte and 10 MB.");
  let size = 0, count = 0;
  const names = new Set<string>();
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, { filter(file) {
      if (++count > 1000) throw new CustomBundleError("ZIP apps support up to 1,000 files.");
      if (file.name.startsWith("/") || file.name.includes("\\") || file.name.includes("\0") ||
        file.name.split("/").some((part) => part === ".." || part === "." || part === "__proto__") ||
        /^[a-z]:/i.test(file.name) || names.has(file.name))
        throw new CustomBundleError("The ZIP contains an invalid or duplicate file path.");
      names.add(file.name);
      size += file.originalSize;
      if (size > expandedLimit) throw new CustomBundleError("The unpacked app exceeds 50 MB.");
      return !file.name.endsWith("/") && !file.name.startsWith("__MACOSX/") && !file.name.endsWith(".DS_Store");
    } });
  } catch (error) {
    if (error instanceof CustomBundleError) throw error;
    throw new CustomBundleError("Could not read this ZIP. Upload the built app folder as a standard ZIP archive.");
  }
  const paths = Object.keys(unpacked);
  const entries = paths.filter((path) => /(^|\/)index\.html$/.test(path))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  const entry = entries[0];
  if (!entry) throw new CustomBundleError("The ZIP needs an index.html from your built app.");
  const prefix = entry.slice(0, -"index.html".length);
  if (prefix && paths.some((path) => !path.startsWith(prefix)))
    throw new CustomBundleError("Put index.html and its assets in the same root folder in the ZIP.");
  return { files: new Map(paths.map((path) => [path.slice(prefix.length), unpacked[path]])), bytes: size };
}

/** A bounded memory cache; nothing is extracted to disk. Concurrent asset loads share work. */
export class CustomBundleCache {
  private entries = new Map<string, CustomBundleFiles>();
  private pending = new Map<string, Promise<CustomBundleFiles>>();
  remember(key: string, bundle: CustomBundleFiles) {
    this.entries.delete(key);
    let used = [...this.entries.values()].reduce((total, item) => total + item.bytes, 0);
    while (this.entries.size && (used + bundle.bytes > expandedLimit || this.entries.size >= 10)) {
      const oldest = this.entries.keys().next().value!;
      used -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, bundle);
    return bundle;
  }
  async get(key: string, load: () => Promise<CustomBundleFiles>) {
    const cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return cached; }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 4) throw new CustomBundleError("Other ZIP apps are loading. Please try again shortly.");
    const operation = load().then((bundle) => this.remember(key, bundle))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
}
