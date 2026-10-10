import DOMPurify from "dompurify";
import scaleIcon from "./assets/custom-module-scale.png?inline";
import lockIcon from "./assets/custom-module-lock.png?inline";
import { customModuleInteractions } from "./custom-module-interactions.ts";
import {
  validateCustomModuleSettings,
  type CustomModuleSettings,
} from "../../../modules/custom-module/src/config.ts";

// Trusted interaction script only; never allow shared origin or user-authored scripts.
export const customModuleSandbox = "allow-scripts";
export const customModulePolicy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const trustedScriptNonce = crypto.randomUUID();

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
  // Resources are capabilities from attached PDS blobs, not arbitrary authored URLs.
  elements.forEach((element, index) => {
    const src = sources[index];
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
  const html = DOMPurify.sanitize(source.body.innerHTML, {
    ALLOWED_TAGS: [
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
      "data-sf-index",
    ],
    ALLOW_DATA_ATTR: false,
    // All src values were removed above and only validated attachment URLs restored.
    ADD_URI_SAFE_ATTR: ["data-sf-index", "src"],
  });
  // HTML serialization does not escape raw-text style elements. Escape every '<'
  // as a CSS escape so untrusted CSS cannot close our style and inject markup.
  const css = settings.css.replace(/</g, "\\3c ");
  const nonce = trustedScriptNonce;
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
    .replace("script-src 'none'", `script-src 'nonce-${nonce}'`)
    .replace("img-src data:", `img-src data: blob: ${origins}`)
    .replace("media-src 'none'", `media-src data: blob: ${origins}`);
  const args = JSON.stringify([channel, { scale: scaleIcon, lock: lockIcon }, locks]).replace(/</g, "\\u003c");
  const script = `(${customModuleInteractions.toString()})(...${args});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color-scheme:light}body{position:relative}${css}\n[data-sf-index]{touch-action:none;user-select:none;cursor:move}</style></head><body>${html}<script nonce="${nonce}">${script}</script></body></html>`;
}
