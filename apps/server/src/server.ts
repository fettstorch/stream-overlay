import { resolve, sep } from "node:path";

const defaultWebRoot = resolve(import.meta.dir, "../../web/dist");

type StaticTarget = { kind: "redirect"; location: string } | { kind: "file"; path: string };

function staticPath(pathname: string, webRoot: string): StaticTarget | null {
  if (pathname === "/") return { kind: "redirect", location: "/admin/" };
  if (pathname === "/admin") return { kind: "redirect", location: "/admin/" };
  if (!pathname.startsWith("/admin/")) return null;

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice("/admin/".length)) || "index.html";
  } catch {
    return null;
  }
  if (relativePath.split("/").includes("..")) return null;

  const root = resolve(webRoot);
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  return { kind: "file", path };
}

export async function handleRequest(request: Request, webRoot = defaultWebRoot) {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }

  const target = staticPath(url.pathname, webRoot);
  if (!target) return new Response("Not found", { status: 404 });
  if (target.kind === "redirect") return Response.redirect(new URL(target.location, url), 302);

  const file = Bun.file(target.path);
  if (!await file.exists()) return new Response("Not found", { status: 404 });
  return new Response(file);
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const webRoot = process.env.WEB_DIST ?? defaultWebRoot;
  Bun.serve({ port, fetch: request => handleRequest(request, webRoot) });
  console.log(`Stream Overlay server listening on port ${port}`);
}
