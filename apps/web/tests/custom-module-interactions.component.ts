import { expect, test, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CustomModulePreview from "../src/CustomModulePreview.vue";
import CloudCustomModuleControls from "../src/CloudCustomModuleControls.vue";
import { customModuleDocument } from "../src/custom-module-document.ts";
import {
  moveCustomModuleElement,
  customModuleInteractions,
} from "../src/custom-module-interactions.ts";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";

afterEach(() => vi.unstubAllGlobals());
test("ZIP uploads save immediately and use the isolated bundle preview without code save controls", async () => {
  const zipBlob = { $type: "blob", ref: { $link: "bafyzip" }, mimeType: "application/zip", size: 100 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(zipBlob)));
  const config = { enabled: true, streamerDid: "did:plc:test", revision: "new", commands: [], customModules: [{ ...defaultCustomModuleSettings, id: "zip", name: "App" }] };
  const save = vi.fn(async () => true);
  const wrapper = mount(CloudCustomModuleControls, { props: { config, moduleId: "zip", save } });
  await wrapper.get('input[aria-label="ZIP app mode"]').setValue(true);
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", { value: [new File(["zip data"], "app.zip", { type: "application/zip" })], configurable: true });
  await input.trigger("change"); await flushPromises();
  expect(wrapper.get("iframe.draft-overlay").attributes("src")).toMatch(/^\/api\/accounts\/did%3Aplc%3Atest\/custom-module-bundles\/bafyzip\/\?channel=/);
  expect(wrapper.get("iframe.draft-overlay").attributes("sandbox")).toBe("allow-scripts");
  expect(wrapper.get("iframe.draft-overlay").attributes("srcdoc")).toBeUndefined();
  expect(wrapper.find(".editor-actions").exists()).toBe(false);
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith({ ...config, customModules: [{ ...config.customModules[0], bundle: { name: "app.zip", blob: zipBlob } }] });
  await wrapper.get('input[aria-label="ZIP app mode"]').setValue(false);
  expect((wrapper.get('input[aria-label="ZIP app mode"]').element as HTMLInputElement).checked).toBe(false);
  expect(wrapper.get("iframe.draft-overlay").attributes("src")).toBeUndefined();
  expect(wrapper.classes()).not.toContain("module-section");
  const zip = new File(["zip data"], "dropped.zip", { type: "application/zip" });
  await wrapper.trigger("drop", { dataTransfer: { types: ["Files"], files: [zip] } }); await flushPromises();
  expect(wrapper.get("iframe.draft-overlay").attributes("src")).toContain("custom-module-bundles/bafyzip/");
  await wrapper.get('input[aria-label="ZIP app mode"]').setValue(false);
  wrapper.findComponent(CustomModulePreview).vm.$emit("mediaDrop", [zip], 10, 20);
  await flushPromises();
  expect(wrapper.get("iframe.draft-overlay").attributes("src")).toContain("custom-module-bundles/bafyzip/");
  wrapper.unmount();
});
const blob = {
  $type: "blob" as const,
  ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" },
  mimeType: "image/png",
  size: 4,
};
test("HTTPS images and attached resources resolve while scripts remain isolated", () => {
  const output = customModuleDocument({
    ...defaultCustomModuleSettings,
    html: '<img src="streamface-media:one"><img src="https://evil.test/image"><video src="streamface-media:video" autoplay muted loop></video><img src="streamface-media:local">',
    media: [
      { id: "one", blob, url: "https://pds.example/xrpc/com.atproto.sync.getBlob?cid=abc" },
      { id: "video", blob: { ...blob, mimeType: "video/mp4" }, url: "https://pds.example/video" },
      { id: "local", blob, url: "blob:http://localhost/abc" },
    ],
  });
  const doc = new DOMParser().parseFromString(output, "text/html");
  expect(doc.querySelectorAll("img")[0].getAttribute("src")).toContain("https://pds.example/");
  expect(doc.querySelectorAll("img")[1].getAttribute("src")).toBe("https://evil.test/image");
  expect(doc.querySelectorAll("img")[2].getAttribute("src")).toBe("blob:http://localhost/abc");
  expect(doc.querySelector("video")!.getAttribute("src")).toBe("https://pds.example/video");
  const policy = doc.querySelector("meta[http-equiv]")!.getAttribute("content")!;
  expect(policy).toContain("https://pds.example");
  expect(policy).toContain("img-src data: blob: https:");
  expect(policy).not.toContain("evil.test");
  expect(policy).not.toContain("allow-same-origin");
  expect(doc.querySelectorAll("script")).toHaveLength(1);
});
test("local previews accept matching image and video data, never authored or mismatched data URLs", () => {
  const output = customModuleDocument({
    ...defaultCustomModuleSettings,
    html: '<img src="streamface-media:image"><video src="streamface-media:video"></video><img src="streamface-media:wrong"><img src="data:image/png;base64,ZGF0YQ==">',
    media: [
      { id: "image", blob, url: "data:image/png;base64,ZGF0YQ==" },
      { id: "video", blob: { ...blob, mimeType: "video/mp4" }, url: "data:video/mp4;base64,ZGF0YQ==" },
      { id: "wrong", blob, url: "data:image/svg+xml;base64,ZGF0YQ==" },
    ],
  });
  const doc = new DOMParser().parseFromString(output, "text/html");
  expect(doc.querySelectorAll("img")[0].getAttribute("src")).toBe("data:image/png;base64,ZGF0YQ==");
  expect(doc.querySelector("video")!.getAttribute("src")).toBe("data:video/mp4;base64,ZGF0YQ==");
  expect(doc.querySelectorAll("img")[1].hasAttribute("src")).toBe(false);
  expect(doc.querySelectorAll("img")[2].hasAttribute("src")).toBe(false);
});
test("moving nested elements keeps their parent and unrelated source, including existing styles", () => {
  const html =
    '<section class="card">\n  <h1 style="color: red; transform: rotate(10deg)">Title</h1>\n  <p>Other</p>\n</section>';
  const next = moveCustomModuleElement(
    html,
    1,
    "color: blue; transform: none !important; position: absolute !important; left: 25% !important; top: 30% !important; width: 40% !important; height: 10% !important;",
  );
  const doc = new DOMParser().parseFromString(next, "text/html");
  expect(doc.querySelector("h1")!.style.color).toBe("red");
  expect(doc.querySelector("h1")!.style.transform).toBe("rotate(10deg)");
  expect(doc.querySelector("h1")!.style.left).toBe("25%");
  expect(doc.querySelector("h1")!.parentElement!.tagName).toBe("SECTION");
  expect(next).toContain("<p>Other</p>");
  expect(() => moveCustomModuleElement(html, 100, "left: 1%")).toThrow();
});
test("moving an element preserves a leading JavaScript block and its body index", () => {
  const html = '<script>window.overlayValue = 42;</script><div>Move me</div>';
  const next = moveCustomModuleElement(html, 0, "left: 25%;");
  expect(next).toContain('<script>window.overlayValue = 42;</script>');
  const doc = new DOMParser().parseFromString(customModuleDocument({ ...defaultCustomModuleSettings, html: next }), "text/html");
  expect(doc.querySelector('div[data-sf-index="0"]')?.getAttribute("style")).toContain("left: 25%");
});
test("preview accepts movement only from its own frame and current channel", () => {
  const html = "<h1>Title</h1>";
  const wrapper = mount(CustomModulePreview, {
    attachTo: document.body,
    props: { settings: { ...defaultCustomModuleSettings, html } },
  });
  const frame = wrapper.get("iframe").element as HTMLIFrameElement;
  const channel = frame.srcdoc.match(/\)\(\.\.\.\["([a-z0-9-]+)"/)![1];
  const data = {
    type: "custom-module-move",
    channel,
    index: 0,
    style: "left: 25%; top: 30%; position: absolute",
  };
  window.dispatchEvent(new MessageEvent("message", { source: window, data }));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ...data, channel: "foreign" },
    }),
  );
  expect(wrapper.emitted("html")).toBeUndefined();
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
  expect(wrapper.emitted("html")![0][0]).toContain("left: 25%");
  wrapper.unmount();
});
test("media drops upload before adding percentage source, refresh on save, and retain blob references", async () => {
  const fetch = vi.fn(async () => Response.json(blob));
  vi.stubGlobal("fetch", fetch);
  const save = vi.fn(async () => true);
  const config = {
    enabled: true,
    streamerDid: "did:plc:alice",
    revision: "new",
    commands: [],
    customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Test" }],
  };
  const wrapper = mount(CloudCustomModuleControls, { props: { config, moduleId: "one", save } });
  await vi.dynamicImportSettled();
  await flushPromises();
  wrapper
    .getComponent(CustomModulePreview)
    .vm.$emit("mediaDrop", [new File(["data"], "picture.png", { type: "image/png" })], 25, 30);
  await flushPromises();
  expect(save).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.waitFor(() =>
    expect(wrapper.get(".draft-overlay").attributes("srcdoc")).toContain("data:image/png;base64,ZGF0YQ=="),
  );
  const srcdoc = wrapper.get(".draft-overlay").attributes("srcdoc");
  expect(srcdoc).toContain("left: 25%");
  expect(srcdoc).toContain("data:image/png;base64,ZGF0YQ==");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save overlay")!
    .trigger("click");
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(2);
  const saved = save.mock.calls[0][0] as typeof config;
  expect(saved.customModules[0].html).toContain("streamface-media:");
  expect((saved.customModules[0] as any).media[0].blob).toEqual(blob);
  expect((saved.customModules[0] as any).media[0].url).toBeUndefined();
  wrapper.unmount();
});
test("failed uploads leave authored source untouched and show the request reference", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { message: "PDS rejected upload", requestId: "fixture-upload" },
        { status: 400 },
      ),
    ),
  );
  const config = {
    enabled: true,
    streamerDid: "did:plc:alice",
    revision: "new",
    commands: [],
    customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Test" }],
  };
  const wrapper = mount(CloudCustomModuleControls, {
    props: { config, moduleId: "one", save: vi.fn() },
  });
  await vi.dynamicImportSettled();
  await flushPromises();
  wrapper
    .getComponent(CustomModulePreview)
    .vm.$emit("mediaDrop", [new File(["data"], "picture.png", { type: "image/png" })], 25, 30);
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain("fixture-upload");
  expect(wrapper.getComponent(CustomModulePreview).props("settings").html).toBe(
    defaultCustomModuleSettings.html,
  );
  wrapper.unmount();
});
test("hover and drag use measured percentage coordinates and post only after a real move", () => {
  const element = document.createElement("h1");
  element.dataset.sfIndex = "0";
  element.textContent = "Heading";
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 243.5,
    height: 40,
  } as DOMRect);
  vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
  Object.defineProperty(document.body, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(document.body, "clientHeight", { configurable: true, value: 500 });
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const stop = customModuleInteractions("test-drag");
  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 110, clientY: 110 }));
  expect(document.body.lastElementChild!.getAttribute("style")).toContain("display: flex");
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 110, clientY: 110 }),
  );
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  expect(post).not.toHaveBeenCalled();
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 110, clientY: 110 }),
  );
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: 310, clientY: 160 }));
  document.dispatchEvent(new MouseEvent("mouseup"));
  expect(element.style.left).toBe("30%");
  expect(element.style.top).toBe("30%");
  expect(element.style.width).toBe("24.35%");
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: "custom-module-move", channel: "test-drag", index: 0 }),
    "*",
  );
  stop();
  element.remove();
  vi.restoreAllMocks();
});
test("resize handles preserve ratios by default and unlock without persisting lock state", () => {
  const element = document.createElement("div");
  element.dataset.sfIndex = "0";
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 } as DOMRect);
  vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
  Object.defineProperty(document.body, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(document.body, "clientHeight", { configurable: true, value: 500 });
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const stop = customModuleInteractions("resize-test");
  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  const resize = document.querySelector('[aria-label="Resize element"]')!;
  const lock = document.querySelector('[aria-label="Lock aspect ratio"]')!;
  const scale = (dx: number, dy: number) => {
    resize.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 300, clientY: 200 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 300 + dx, clientY: 200 + dy }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  };
  scale(100, 50);
  expect(element.style.width).toBe("30%");
  expect(element.style.height).toBe("30%");
  expect(element.style.left).toBe("10%");
  expect(lock.getAttribute("aria-pressed")).toBe("true");
  lock.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(lock.getAttribute("aria-pressed")).toBe("false");
  scale(100, 0);
  expect(element.style.width).toBe("30%");
  expect(element.style.height).toBe("20%");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "custom-module-move", index: 0 }), "*");
  expect(element.outerHTML).not.toContain("locked");
  stop(); element.remove(); post.mockRestore();
});
test("renaming preserves unsaved source and resolved media URLs do not keep a saved draft dirty", async () => {
  const module = {
    ...defaultCustomModuleSettings,
    id: "one",
    name: "Before",
    media: [{ id: "pic", blob, url: "blob:http://localhost/preview" }],
  };
  const config = {
    enabled: true,
    streamerDid: "did:plc:alice",
    revision: "new",
    commands: [],
    customModules: [module],
  };
  const save = vi.fn(async () => true);
  const wrapper = mount(CloudCustomModuleControls, { props: { config, moduleId: "one", save } });
  await vi.dynamicImportSettled();
  await flushPromises();
  wrapper
    .getComponent(CustomModulePreview)
    .vm.$emit("html", '<img src="streamface-media:pic" style="left:25%">');
  await wrapper.setProps({ config: { ...config, customModules: [{ ...module, name: "After" }] } });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save overlay")!
    .trigger("click");
  await flushPromises();
  const candidate = save.mock.calls[0][0] as typeof config;
  expect(candidate.customModules[0].name).toBe("After");
  expect(candidate.customModules[0].html).toContain("left:25%");
  await wrapper.setProps({
    config: {
      ...candidate,
      customModules: [
        {
          ...candidate.customModules[0],
          media: [{ id: "pic", blob, url: "https://pds.example/blob" }],
        },
      ],
    },
  });
  expect(
    wrapper
      .findAll("button")
      .find((button) => button.text() === "✓ Saved")!
      .attributes("disabled"),
  ).toBeDefined();
  wrapper.unmount();
});

test("moving from a scoped preview to its resize controls keeps them available", () => {
  vi.useFakeTimers();
  const root = document.createElement("div");
  const layer = document.createElement("div");
  layer.dataset.sfIndex = "0";
  root.append(layer);
  document.body.append(root);
  const stop = customModuleInteractions("controls-hover", {}, {}, { root });
  layer.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  const resize = document.querySelector('[aria-label="Resize element"]')!;
  root.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: resize }));
  expect((resize.parentElement as HTMLElement).style.display).toBe("flex");
  resize.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  expect((resize.parentElement as HTMLElement).style.display).toBe("flex");
  root.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: document.body }));
  expect((resize.parentElement as HTMLElement).style.display).toBe("flex");
  vi.advanceTimersByTime(1000);
  expect((resize.parentElement as HTMLElement).style.display).toBe("none");
  stop();
  root.remove();
  vi.useRealTimers();
});

test("crossing transparent gaps gives time to reach the controls and entering them cancels deselection", () => {
  vi.useFakeTimers();
  const root = document.createElement("div"), layer = document.createElement("div");
  layer.dataset.sfIndex = "0"; root.append(layer); document.body.append(root);
  const stop = customModuleInteractions("hover-grace", {}, {}, { root });
  try {
    layer.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const controls = document.querySelector('[aria-label="Resize element"]')!.parentElement!;
    root.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(controls.style.display).toBe("flex");
    controls.dispatchEvent(new MouseEvent("pointerenter"));
    vi.advanceTimersByTime(500);
    expect(controls.style.display).toBe("flex");
    controls.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: document.body }));
    vi.advanceTimersByTime(1000);
    expect(controls.style.display).toBe("none");
  } finally { stop(); root.remove(); vi.useRealTimers(); }
});

test("rotation drags around the center, snaps with Shift, and preserves authored transforms", () => {
  const element = document.createElement("div");
  element.dataset.sfIndex = "0";
  element.style.cssText = "left:10%;top:20%;width:20%;height:20%;transform:scale(.9);rotate:15deg";
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 } as DOMRect);
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const stop = customModuleInteractions("rotation-test", { rotate: "data:image/png;base64,test" });
  try {
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const rotate = document.querySelector('[aria-label="Rotate element"]')!;
    expect((rotate as HTMLElement).style.backgroundImage).toContain("data:image/png");
    rotate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 300, clientY: 150 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 250, shiftKey: true }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(element.style.rotate).toBe("105deg");
    expect(element.style.left).toBe("10%");
    expect(element.style.width).toBe("20%");
    expect(element.style.transform).toBe("scale(.9)");
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "custom-module-move", index: 0 }), "*");
    const html = moveCustomModuleElement('<div style="color:red;transform:scale(.9)">Content</div>', 0, element.style.cssText);
    const saved = new DOMParser().parseFromString(html, "text/html").querySelector("div")!;
    expect(saved.style.rotate).toBe("105deg");
    expect(saved.style.transform).toBe("scale(.9)");
    expect(saved.style.color).toBe("red");
  } finally { stop(); element.remove(); vi.restoreAllMocks(); }
});
