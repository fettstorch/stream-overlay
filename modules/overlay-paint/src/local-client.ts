import { mountPaint } from "./client.ts";
const close = mountPaint(
  document.body,
  null,
  new URL(location.href).searchParams.get("interactive") === "1",
);
document.body.dataset.interactive = String(
  new URL(location.href).searchParams.get("interactive") === "1",
);
addEventListener("pagehide", close, { once: true });
