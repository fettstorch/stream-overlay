import { visibleContentAt } from "../../../modules/custom-module/src/visible-content.ts";
import type { CustomBundleFiles } from "./custom-module-bundle.ts";

const bridge = `<script>(() => { const visibleContentAt = (${visibleContentAt.toString()});
addEventListener("message", async event => {
  if (event.source !== parent || event.data?.type !== "overlay-content-hit-test" || typeof event.data.request !== "string" || !Number.isFinite(event.data.x) || !Number.isFinite(event.data.y)) return;
  const painted = await visibleContentAt(document, document.body, event.data.x, event.data.y);
  parent.postMessage({type:"overlay-content-hit", request:event.data.request, painted}, "*");
});
const channel = new URL(location.href).searchParams.get("channel");
if (channel) {
  addEventListener("dragover", event => {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
  }, true);
  addEventListener("drop", event => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    parent.postMessage({type:"custom-module-media-drop", channel, files, x:(event.clientX / innerWidth) * 100, y:(event.clientY / innerHeight) * 100}, "*");
  }, true);
}
})();</script>`;

export function customBundleResponse(bundle: CustomBundleFiles, path: string, head = false) {
  const file = bundle.files.get(path || "index.html");
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // Apply the sandbox to direct navigation as well as embedded previews.
    "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https: 'self' blob:; style-src 'unsafe-inline' https: 'self' blob:; img-src https: 'self' data: blob:; font-src https: 'self' data: blob:; media-src https: 'self' data: blob:; connect-src https: wss: 'self'; worker-src blob: 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (!file) return new Response("App file not found.", { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
  const mime = Bun.file(path || "index.html").type || "application/octet-stream";
  const response = new Response(head ? null : file as Uint8Array<ArrayBuffer>, { headers: { ...headers, "Content-Type": mime } });
  if (head || !mime.startsWith("text/html")) return response;
  return new HTMLRewriter().on("head", { element(element) {
    element.prepend('<style>html,body{background:transparent}</style>' + bridge, { html: true });
  } }).transform(response);
}
