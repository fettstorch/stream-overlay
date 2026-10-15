export type CustomModuleSettings = {
  enabled: boolean;
  displayMode?: "overlay" | "page";
  html: string;
  css: string;
  javascript?: string;
  bundle?: CustomModuleBundle;
  media?: CustomModuleMedia[];
};
export type CustomModuleMedia = {
  id: string;
  blob: { $type: "blob"; ref: { $link: string }; mimeType: string; size: number };
  /** Resolved at delivery time, never persisted in the record. */
  url?: string;
};
export type CustomModule = CustomModuleSettings & { id: string; name: string };
export type CustomModuleBundle = {
  name: string;
  blob: CustomModuleMedia["blob"];
  /** Resolved ZIP download URL; never persisted. */
  url?: string;
};
export function customModuleBundlePath(did: string, bundle: CustomModuleBundle) {
  return `/api/accounts/${encodeURIComponent(did)}/custom-module-bundles/${encodeURIComponent(bundle.blob.ref.$link)}/`;
}

export function validateCustomModules(value: unknown): asserts value is CustomModule[] {
  if (!Array.isArray(value)) throw new Error("Invalid custom modules");
  const ids = new Set<string>();
  for (const item of value) {
    validateCustomModuleSettings(item);
    const module = item as CustomModule;
    if (
      typeof module.id !== "string" ||
      !/^[A-Za-z0-9._:~-]{1,128}$/.test(module.id) ||
      [".", ".."].includes(module.id) ||
      ids.has(module.id)
    )
      throw new Error("Invalid or duplicate custom module ID");
    if (
      typeof module.name !== "string" ||
      !module.name.trim() ||
      new TextEncoder().encode(module.name).length > 200
    )
      throw new Error("Custom module name must be between 1 and 200 bytes");
    ids.add(module.id);
  }
}

export const customModuleSourceLimit = 50_000;
const compactStarterHtml =
  '<section class="welcome"><h1>Welcome to my stream</h1><p>Make yourself at home.</p></section>';
const compactStarterCss =
  ".welcome { position: absolute; left: 4%; bottom: 7%; max-width: 70%; box-sizing: border-box; padding: 2vmin 3vmin; border: 0.3vmin solid white; border-radius: 2vmin; background: #111c; color: white; font: clamp(1rem, 2.5vmin, 2rem)/1.4 sans-serif; }\n.welcome h1 { margin: 0 0 0.5em; font-size: 1.5em; }\n.welcome p { margin: 0; }";
export const defaultCustomModuleSettings: CustomModuleSettings = {
  enabled: false,
  html: `<section class="welcome">
  <h1>Welcome to my stream</h1>
  <p>Make yourself at home.</p>
</section>`,
  css: `.welcome {
  position: absolute;
  left: 4%;
  bottom: 7%;
  max-width: 70%;
  box-sizing: border-box;
  padding: 2vmin 3vmin;
  border: 0.3vmin solid white;
  border-radius: 2vmin;
  background: #111c;
  color: white;
  font: clamp(1rem, 2.5vmin, 2rem) / 1.4 sans-serif;
}

.welcome h1 {
  margin: 0 0 0.5em;
  font-size: 1.5em;
}

.welcome p {
  margin: 0;
}`,
};

const oldStarterCss =
  ".welcome { position: absolute; left: 80px; bottom: 80px; padding: 32px; border: 4px solid white; border-radius: 24px; background: #111c; color: white; font: 28px sans-serif; }\n.welcome h1 { margin: 0 0 12px; }\n.welcome p { margin: 0; }";
/** Drop retired dimensions; update only exact starter source, never custom content. */
export function customModuleSettings(value: CustomModuleSettings): CustomModuleSettings {
  return {
    enabled: value.enabled,
    ...(value.displayMode !== undefined ? { displayMode: value.displayMode } : {}),
    html: value.html === compactStarterHtml ? defaultCustomModuleSettings.html : value.html,
    css:
      value.css === oldStarterCss || value.css === compactStarterCss
        ? defaultCustomModuleSettings.css
        : value.css,
    ...(value.media ? { media: value.media } : {}),
    ...(value.javascript !== undefined ? { javascript: value.javascript } : {}),
    ...(value.bundle ? { bundle: value.bundle } : {}),
  };
}

/** Validate storage, not trust: every renderer must still sanitize and sandbox. */
export function validateCustomModuleSettings(
  value: unknown,
): asserts value is CustomModuleSettings {
  if (!value || typeof value !== "object") throw new Error("Invalid Custom Module settings");
  const settings = value as CustomModuleSettings;
  if (typeof settings.enabled !== "boolean") throw new Error("Invalid Custom Module enabled state");
  if (settings.displayMode !== undefined && !["overlay", "page"].includes(settings.displayMode))
    throw new Error("Invalid Custom Module display mode");
  for (const field of ["html", "css", "javascript"] as const) {
    if (field === "javascript" && settings[field] === undefined) continue;
    if (
      typeof settings[field] !== "string" ||
      new TextEncoder().encode(settings[field]).length > customModuleSourceLimit
    )
      throw new Error(`Custom Module ${field.toUpperCase()} must be at most 50 KB`);
  }
  if (settings.media !== undefined) {
    if (!Array.isArray(settings.media) || settings.media.length > 100)
      throw new Error("Custom Modules support up to 100 media attachments");
    const ids = new Set<string>();
    for (const item of settings.media) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) ||
        ids.has(item.id) ||
        item.blob?.$type !== "blob" ||
        typeof item.blob.ref?.$link !== "string" ||
        !/^[a-zA-Z0-9]+$/.test(item.blob.ref.$link) ||
        !/^((image\/(png|jpeg|gif|webp|avif))|(video\/(mp4|webm|quicktime)))$/.test(
          item.blob.mimeType,
        ) ||
        !Number.isInteger(item.blob.size) ||
        item.blob.size <= 0 ||
        item.blob.size > 10_000_000
      )
        throw new Error("Invalid Custom Module media attachment");
      ids.add(item.id);
    }
  }
  if (settings.bundle !== undefined) {
    const bundle = settings.bundle;
    if (!bundle || typeof bundle.name !== "string" || !bundle.name.trim() ||
      new TextEncoder().encode(bundle.name).length > 200 ||
      bundle.blob?.$type !== "blob" || bundle.blob.mimeType !== "application/zip" ||
      typeof bundle.blob.ref?.$link !== "string" || !/^[a-zA-Z0-9]+$/.test(bundle.blob.ref.$link) ||
      !Number.isInteger(bundle.blob.size) || bundle.blob.size <= 0 || bundle.blob.size > 10_000_000)
      throw new Error("Invalid Custom Module ZIP bundle");
  }
}
