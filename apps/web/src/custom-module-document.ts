import { visibleContentAt } from "./overlay-hit-test.ts";
import DOMPurify from "dompurify";
import scaleIcon from "./assets/custom-module-scale.png?inline";
import lockIcon from "./assets/custom-module-lock.png?inline";
import { customModuleInteractions } from "./custom-module-interactions.ts";
import {
  validateCustomModuleSettings,
  type CustomModuleSettings,
} from "../../../modules/custom-module/src/config.ts";

// Authored scripts run only inside an opaque-origin sandbox, never in the app.
export const customModuleSandbox = "allow-scripts";
export const customModulePolicy =
  "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline'; img-src data:; font-src 'none'; media-src 'none'; connect-src https: wss:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** This same boundary is used for drafts, imported setups and the public OBS page. */
export function customModuleDocument(settings: CustomModuleSettings, channel = "", locks: Record<number, boolean> = {}): string {
  validateCustomModuleSettings(settings);
  const source = new DOMParser().parseFromString(settings.html, "text/html");
  const elements = Array.from(source.body.querySelectorAll("*"));
  const sources = elements.map((element) => element.getAttribute("src"));
  elements.forEach((element, index) => {
    element.setAttribute("data-sf-index", String(index));
    element.removeAttribute("src");
  });
  // Resolve uploaded media references and preserve directly authored HTTPS images.
  elements.forEach((element, index) => {
    const src = sources[index];
    if ((element.tagName === "IMG" || element.tagName === "SCRIPT") && src) {
      try {
        const url = new URL(src);
        if (url.protocol === "https:") element.setAttribute("src", url.href);
      } catch {
        // Attachment references are resolved below.
      }
    }
    const id = src?.startsWith("streamface-media:")
      ? src.slice("streamface-media:".length)
      : undefined;
    const media = settings.media?.find((item) => item.id === id);
    if (
      media?.url &&
      ((element.tagName === "IMG" && media.blob.mimeType.startsWith("image/")) ||
        (element.tagName === "VIDEO" && media.blob.mimeType.startsWith("video/")))
    ) {
      const url = new URL(media.url);
      const localPreview = media.url.startsWith(`data:${media.blob.mimeType};base64,`);
      if (url.protocol === "https:" || url.protocol === "blob:" || localPreview)
        element.setAttribute("src", url.href);
    }
  });
  // DOMParser places leading scripts in <head>; preserve them without changing
  // the body element indices used by the positioning controls.
  const headScripts = Array.from(source.head.querySelectorAll("script"), (script) => {
    const src = script.getAttribute("src");
    if (src) {
      try {
        if (new URL(src).protocol !== "https:") return "";
      } catch { return ""; }
    }
    return script.outerHTML;
  }).join("");
  const html = DOMPurify.sanitize(headScripts + source.body.innerHTML, {
    FORCE_BODY: true,
    ALLOWED_TAGS: [
      "script",
      "button",
      "div",
      "span",
      "section",
      "article",
      "header",
      "footer",
      "main",
      "aside",
      "nav",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "small",
      "sub",
      "sup",
      "ul",
      "ol",
      "li",
      "dl",
      "dt",
      "dd",
      "blockquote",
      "pre",
      "code",
      "figure",
      "figcaption",
      "img",
      "video",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: [
      "class",
      "id",
      "style",
      "title",
      "alt",
      "width",
      "height",
      "colspan",
      "rowspan",
      "src",
      "autoplay",
      "loop",
      "muted",
      "playsinline",
      "type",
      "async",
      "defer",
      "nomodule",
      "crossorigin",
      "integrity",
      "data-sf-index",
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: (name) => /^on/i.test(name),
    // Only HTTPS images/scripts and validated attachment URLs were restored above.
    ADD_URI_SAFE_ATTR: ["data-sf-index", "src"],
  });
  // HTML serialization does not escape raw-text style elements. Escape every '<'
  // as a CSS escape so untrusted CSS cannot close our style and inject markup.
  const css = settings.css.replace(/</g, "\\3c ");
  const origins = [
    ...new Set(
      (settings.media ?? []).flatMap((item) => {
        try {
          const url = new URL(item.url!);
          return url.protocol === "https:" ? [url.origin] : [];
        } catch {
          return [];
        }
      }),
    ),
  ].join(" ");
  const policy = customModulePolicy
    .replace("img-src data:", "img-src data: blob: https:")
    .replace("media-src 'none'", `media-src data: blob: ${origins}`);
  const args = JSON.stringify([channel, { scale: scaleIcon, lock: lockIcon }, locks]).replace(/</g, "\\u003c");
  // Set textContent rather than interpolating raw source into HTML: strings such
  // as "</script>" must remain JavaScript, not terminate the surrounding tag.
  const javascript = JSON.stringify(settings.javascript ?? "").replace(/</g, "\\u003c");
  const authoredScript = settings.javascript
    ? `<script>{const script = document.createElement("script"); script.textContent = ${javascript}; document.body.append(script);}</script>`
    : "";
  const script = `(${customModuleInteractions.toString()})(...${args});
const visibleContentAt = (${visibleContentAt.toString()});
addEventListener("message", async event => {
  if (event.source !== parent || event.data?.type !== "overlay-content-hit-test" || typeof event.data.request !== "string" || !Number.isFinite(event.data.x) || !Number.isFinite(event.data.y)) return;
  const painted = await visibleContentAt(document, document.body, event.data.x, event.data.y);
  parent.postMessage({type:"overlay-content-hit", request:event.data.request, painted}, "*");
});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color-scheme:light}body{position:relative}${css}\n[data-sf-index]{touch-action:none;user-select:none;cursor:move}</style></head><body>${html}${authoredScript}<script>${script}</script></body></html>`;
}
