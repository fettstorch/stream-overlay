import { expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { customModuleDocument, customModulePolicy } from "../src/custom-module-document.ts";
import CustomModulePreview from "../src/CustomModulePreview.vue";
import CloudCustomModuleControls from "../src/CloudCustomModuleControls.vue";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";
import { mergeSetup } from "../src/setup-import.ts";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { JSDOM } from "jsdom";

test("authored scripts and handlers are allowed while navigation and embeds stay sandboxed", () => {
  const html = `<div id="room" style="color:red">Hello</div><script>alert(1)</script><img src="https://evil.test/track" onerror="alert(1)"><iframe srcdoc="<script>alert(1)</script>"></iframe><svg onload="alert(1)"><script>alert(1)</script></svg><form action="https://evil.test"><input autofocus></form><a href="javascript:alert(1)">Link</a><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><object data="https://evil.test"></object><style>@import 'https://evil.test';</style>`;
  const output = customModuleDocument({ ...defaultCustomModuleSettings, html });
  const doc = new DOMParser().parseFromString(output, "text/html");
  expect(doc.querySelector("div")?.textContent).toBe("Hello");
  expect(doc.querySelector("div")?.getAttribute("style")).toBe("color:red");
  expect(
    doc.querySelectorAll("iframe, svg, form, input, a, base, object"),
  ).toHaveLength(0);
  expect(doc.querySelectorAll("script")).toHaveLength(2);
  expect(doc.querySelector("script")!.textContent).toBe("alert(1)");
  expect(doc.querySelector("img")?.getAttribute("onerror")).toBe("alert(1)");
  expect(doc.querySelectorAll("[href]")).toHaveLength(0);
  expect(doc.querySelector("img")?.getAttribute("src")).toBe("https://evil.test/track");
  expect(doc.querySelector("meta[http-equiv]")?.getAttribute("content")).toContain("img-src data: blob: https:");
  expect(doc.querySelectorAll("meta[http-equiv]")).toHaveLength(1);
  expect(doc.querySelector("meta[http-equiv]")?.getAttribute("content")).toContain(
    "script-src 'unsafe-inline' https:",
  );
});

test("CSS cannot break out of the style element or replace the resource policy", () => {
  const css = `</style><script>alert(1)</script><meta http-equiv="Content-Security-Policy" content="default-src *"><style>body { background: url(https://evil.test/track) } @import 'https://evil.test';`;
  const output = customModuleDocument({ ...defaultCustomModuleSettings, css });
  const doc = new DOMParser().parseFromString(output, "text/html");
  expect(doc.querySelectorAll("script")).toHaveLength(1);
  expect(doc.querySelector("script")!.textContent).not.toContain("alert(1)");
  expect(doc.querySelectorAll("meta[http-equiv]")).toHaveLength(1);
  expect(customModulePolicy).toContain("default-src 'none'");
  expect(customModulePolicy).toContain("script-src 'unsafe-inline' https:");
  expect(customModulePolicy).toContain("connect-src https: wss:");
  expect(customModulePolicy).toContain("frame-src 'none'");
});

test("inline JavaScript and event handlers execute in the generated overlay document", () => {
  const html = `<script>window.initialValue = 41;</script><button onclick="this.textContent = window.initialValue + 1">Run</button><script src="https://cdn.example/overlay.js" defer></script>`;
  const output = customModuleDocument({ ...defaultCustomModuleSettings, html });
  const runtime = new JSDOM(output, { runScripts: "dangerously" });
  try {
    const button = runtime.window.document.querySelector("button")!;
    button.click();
    expect(button.textContent).toBe("42");
    expect(runtime.window.document.querySelector('script[src]')?.getAttribute("src")).toBe("https://cdn.example/overlay.js");
    expect(runtime.window.document.querySelector('script[src]')?.hasAttribute("defer")).toBe(true);
  } finally {
    runtime.window.close();
  }
});

test("preview always has a restrictive sandbox and never renders content into the app DOM", () => {
  const wrapper = mount(CustomModulePreview, {
    props: { settings: { ...defaultCustomModuleSettings, html: '<h1 id="custom">Hello</h1>' } },
  });
  expect(wrapper.get("iframe").attributes("sandbox")).toBe("allow-scripts");
  expect(wrapper.get("iframe").attributes("referrerpolicy")).toBe("no-referrer");
  expect(wrapper.find("#custom").exists()).toBe(false);
  expect(wrapper.get("iframe").attributes("srcdoc")).toContain("Hello");
  expect(wrapper.get("iframe").attributes("style")).toBeUndefined();
  wrapper.unmount();
});

test("draft editing previews immediately, saves explicitly, and discard restores saved source", async () => {
  const config = {
    enabled: true,
    streamerDid: "did:plc:alice",
    revision: "new",
    commands: [],
    customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Score" }],
  };
  const save = vi.fn(async () => true);
  const wrapper = mount(CloudCustomModuleControls, { props: { config, save, moduleId: "one" } });
  await vi.dynamicImportSettled();
  await flushPromises();
  expect(wrapper.find('input[type="number"]').exists()).toBe(false);
  const editor = EditorView.findFromDOM(
    wrapper.get('[aria-label="Custom Module HTML"]').element as HTMLElement,
  )!;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "<h1>Draft</h1>" } });
  await flushPromises();
  expect(save).not.toHaveBeenCalled();
  expect(wrapper.get("iframe").attributes("srcdoc")).toContain("Draft");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save overlay")!
    .trigger("click");
  await flushPromises();
  expect(save).toHaveBeenCalledWith({
    ...config,
    customModules: [
      { ...defaultCustomModuleSettings, id: "one", name: "Score", html: "<h1>Draft</h1>", javascript: "" },
    ],
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Discard changes")!
    .trigger("click");
  expect(editor.state.doc.toString()).toBe(defaultCustomModuleSettings.html);
  wrapper.unmount();
});

test("Vim write in each source saves the current module's complete draft", async () => {
  const config = {
    enabled: true,
    streamerDid: "did:plc:alice",
    revision: "new",
    commands: [],
    preferences: { confirmDeletion: true, vimControls: true },
    customModules: [
      { ...defaultCustomModuleSettings, id: "one", name: "Score" },
      { ...defaultCustomModuleSettings, id: "two", name: "Other" },
    ],
  };
  let finishSave!: (value: boolean) => void;
  const save = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      }),
  );
  const wrapper = mount(CloudCustomModuleControls, { props: { config, save, moduleId: "one" } });
  await vi.dynamicImportSettled();
  await flushPromises();
  const htmlEditor = EditorView.findFromDOM(
    wrapper.get('[aria-label="Custom Module HTML"]').element as HTMLElement,
  )!;
  const cssEditor = EditorView.findFromDOM(
    wrapper.get('[aria-label="Custom Module CSS"]').element as HTMLElement,
  )!;
  const javascriptEditor = EditorView.findFromDOM(
    wrapper.get('[aria-label="Custom Module JavaScript"]').element as HTMLElement,
  )!;
  htmlEditor.dispatch({
    changes: { from: 0, to: htmlEditor.state.doc.length, insert: "<h1>Saved</h1>" },
  });
  cssEditor.dispatch({
    changes: { from: 0, to: cssEditor.state.doc.length, insert: "h1 { color: red; }" },
  });
  const javascript = 'document.querySelector("h1").textContent = "Updated";';
  javascriptEditor.dispatch({ changes: { from: 0, to: javascriptEditor.state.doc.length, insert: javascript } });
  await flushPromises();
  expect(wrapper.get("iframe").attributes("srcdoc").includes("Updated")).toBe(true);
  for (const [index, editor] of [htmlEditor, cssEditor, javascriptEditor].entries()) {
    Vim.handleEx(getCM(editor)!, "w");
    expect(save).toHaveBeenCalledTimes(index + 1);
    expect(save).toHaveBeenLastCalledWith({
      ...config,
      customModules: [
        { ...config.customModules[0], html: "<h1>Saved</h1>", css: "h1 { color: red; }", javascript },
        config.customModules[1],
      ],
    });
    Vim.handleEx(getCM(editor)!, "w");
    expect(save).toHaveBeenCalledTimes(index + 1);
    finishSave(true);
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Custom Module saved");
  }
  wrapper.unmount();
});

test("the JavaScript field runs after HTML and preserves closing script strings", () => {
  const output = customModuleDocument({ ...defaultCustomModuleSettings, html: '<p id="result"></p>', javascript: 'document.querySelector("#result").textContent = "</script><p>still a string</p>";' });
  const runtime = new JSDOM(output, { runScripts: "dangerously" });
  try {
    expect(runtime.window.document.querySelector("#result")?.textContent).toBe("</script><p>still a string</p>");
    expect(runtime.window.document.querySelectorAll("p")).toHaveLength(1);
  } finally { runtime.window.close(); }
});

test("copied Custom Module source is isolated again at render time", () => {
  const config = { enabled: true, streamerDid: "did:plc:target", revision: "target", commands: [] };
  const imported = mergeSetup(config, {
    ...config,
    streamerDid: "did:plc:source",
    customModules: [
      {
        ...defaultCustomModuleSettings,
        id: "one",
        name: "Score",
        html: "<script>alert(1)</script><h1>Copied</h1>",
      },
    ],
  });
  expect(imported.streamerDid).toBe(config.streamerDid);
  expect(imported.customModules?.[0].html).toContain("script");
  expect(imported.customModules?.[0].id).not.toBe("one");
  const rendered = customModuleDocument(imported.customModules![0]);
  expect(rendered).toContain("alert(1)");
  expect(rendered).toContain("Copied");
});

test("stream preview is opt-in, muted and separate from the sandboxed custom content", async () => {
  const config = {
    enabled: true,
    streamerDid: "did:plc:alice",
    revision: "new",
    commands: [],
    customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Score" }],
  };
  const save = vi.fn(async () => true);
  const wrapper = mount(CloudCustomModuleControls, { props: { config, save, moduleId: "one" } });
  expect(wrapper.find(".stream-background").exists()).toBe(false);
  const toggle = wrapper.get('input[aria-label="Show my stream behind the preview"]');
  await toggle.setValue(true);
  expect(wrapper.get(".stream-background").attributes("src")).toBe(
    "https://stream.place/embed/did%3Aplc%3Aalice?muted=true",
  );
  expect(wrapper.get(".stream-background").attributes("tabindex")).toBe("-1");
  expect(wrapper.get(".draft-overlay").attributes("sandbox")).toBe("allow-scripts");
  expect(wrapper.get(".draft-overlay").attributes("srcdoc")).not.toContain("stream.place");
  expect(save).not.toHaveBeenCalled();
  expect(
    wrapper.findAll("button").every((button) => button.attributes("disabled") !== undefined),
  ).toBe(true);
  await toggle.setValue(false);
  expect(wrapper.find(".stream-background").exists()).toBe(false);
  wrapper.unmount();
});

test("display mode saves immediately without saving or discarding code drafts", async () => {
  const config = { enabled: true, streamerDid: "did:plc:test", revision: "one", commands: [], customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Page" }] };
  let wrapper: ReturnType<typeof mount>;
  const save = vi.fn(async (candidate) => {
    await wrapper.setProps({ config: candidate });
    return true;
  });
  wrapper = mount(CloudCustomModuleControls, { props: { config, moduleId: "one", save, pageUrl: "/overlay/?did=did:plc:test&only=custom%3Aone&fit=1" } });
  try {
    const toggle = wrapper.get('[aria-label="Own page mode"]');
    expect(wrapper.get('.save-overlay-button').attributes("disabled")).toBeDefined();
    await toggle.setValue(true);
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith({ ...config, customModules: [{ ...config.customModules[0], displayMode: "page" }] });
    expect(wrapper.get('[aria-label="Copy module page URL"]').exists()).toBe(true);
    expect(wrapper.get('.save-overlay-button').attributes("disabled")).toBeDefined();
    expect(wrapper.get('.danger-button').attributes("disabled")).toBeDefined();

    wrapper.getComponent(CustomModulePreview).vm.$emit("html", "<h1>Unsaved code</h1>");
    await flushPromises();
    await toggle.setValue(false);
    await flushPromises();
    expect(save.mock.calls[1][0].customModules[0]).toEqual({ ...config.customModules[0], displayMode: "overlay" });
    expect(wrapper.getComponent(CustomModulePreview).props("settings").html).toBe("<h1>Unsaved code</h1>");
    await wrapper.get('.danger-button').trigger("click");
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.getComponent(CustomModulePreview).props("settings").html).toBe(config.customModules[0].html);
    expect(save).toHaveBeenCalledTimes(2);

    wrapper.getComponent(CustomModulePreview).vm.$emit("html", "<h1>Saved code</h1>");
    await toggle.setValue(true);
    await flushPromises();
    expect(save.mock.calls[2][0].customModules[0].html).toBe(config.customModules[0].html);
    await wrapper.get('.save-overlay-button').trigger("click");
    await flushPromises();
    expect(save.mock.calls[3][0].customModules[0]).toEqual({ ...config.customModules[0], displayMode: "page", html: "<h1>Saved code</h1>", javascript: "" });
  } finally { wrapper.unmount(); }
});

test.each([false, new Error("Failed")])("failed display mode save restores the toggle and retains code drafts (%s)", async (result) => {
  const config = { enabled: true, streamerDid: "did:plc:test", revision: "one", commands: [], customModules: [{ ...defaultCustomModuleSettings, id: "one", name: "Page" }] };
  let finish: (value: boolean) => void;
  const save = vi.fn(() => result instanceof Error ? Promise.reject(result) : new Promise<boolean>((resolve) => { finish = resolve; }));
  const wrapper = mount(CloudCustomModuleControls, { props: { config, moduleId: "one", save } });
  try {
    wrapper.getComponent(CustomModulePreview).vm.$emit("html", "<h1>Draft</h1>");
    const toggle = wrapper.get('[aria-label="Own page mode"]');
    await toggle.setValue(true);
    if (result === false) {
      expect(toggle.attributes("disabled")).toBeDefined();
      finish!(false);
    }
    await flushPromises();
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain("Could not save the display mode");
    expect(wrapper.getComponent(CustomModulePreview).props("settings").html).toBe("<h1>Draft</h1>");
  } finally { wrapper.unmount(); }
});

test("page URL uses overlay controls, copies the complete URL and reports clipboard failures", async () => {
  const pageUrl = "/overlay/?did=did:plc:test&token=private-token&only=custom%3Aone&fit=1";
  const config = { enabled: true, streamerDid: "did:plc:test", revision: "one", commands: [], customModules: [{ ...defaultCustomModuleSettings, displayMode: "page" as const, id: "one", name: "Page" }] };
  const clipboard = vi.fn(async () => {});
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const wrapper = mount(CloudCustomModuleControls, { props: { config, moduleId: "one", save: vi.fn(async () => true), pageUrl } });
  try {
    expect(wrapper.get('.overlay-url code').text()).toBe(pageUrl.replace("private-token", "…"));
    await wrapper.get('[aria-label="Open module page"]').trigger("click");
    expect(open).toHaveBeenCalledWith(pageUrl, "_blank", "noopener,noreferrer");
    const copy = wrapper.get('[aria-label="Copy module page URL"]');
    await copy.trigger("click");
    await flushPromises();
    expect(clipboard).toHaveBeenCalledWith(pageUrl);
    expect(copy.classes()).toContain("copied");
    clipboard.mockRejectedValueOnce(new Error("Denied"));
    await copy.trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe("Could not copy the URL.");
    await wrapper.setProps({ config: { ...config, customModules: [{ ...config.customModules[0], displayMode: "overlay" }] } });
    expect(wrapper.find('.overlay-url').exists()).toBe(false);
  } finally {
    wrapper.unmount();
    open.mockRestore();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
