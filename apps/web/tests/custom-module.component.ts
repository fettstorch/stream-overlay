import { expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { customModuleDocument, customModulePolicy } from "../src/custom-module-document.ts";
import CustomModulePreview from "../src/CustomModulePreview.vue";
import CloudCustomModuleControls from "../src/CloudCustomModuleControls.vue";
import { defaultCustomModuleSettings } from "../../../modules/custom-module/src/config.ts";
import { mergeSetup } from "../src/setup-import.ts";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";

test("untrusted HTML cannot add executable or navigable content to the sandbox", () => {
  const html = `<div id="room" style="color:red">Hello</div><script>alert(1)</script><img src="https://evil.test/track" onerror="alert(1)"><iframe srcdoc="<script>alert(1)</script>"></iframe><svg onload="alert(1)"><script>alert(1)</script></svg><form action="https://evil.test"><input autofocus></form><a href="javascript:alert(1)">Link</a><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><object data="https://evil.test"></object><style>@import 'https://evil.test';</style>`;
  const output = customModuleDocument({ ...defaultCustomModuleSettings, html });
  const doc = new DOMParser().parseFromString(output, "text/html");
  expect(doc.querySelector("div")?.textContent).toBe("Hello");
  expect(doc.querySelector("div")?.getAttribute("style")).toBe("color:red");
  expect(
    doc.querySelectorAll("script:not([nonce]), iframe, svg, form, input, a, base, object"),
  ).toHaveLength(0);
  expect(doc.querySelectorAll("script[nonce]")).toHaveLength(1);
  expect(doc.querySelector("script")!.textContent).not.toContain("alert(1)");
  expect(doc.querySelectorAll("[onerror], [onload], [src], [href]")).toHaveLength(0);
  expect(doc.querySelectorAll("meta[http-equiv]")).toHaveLength(1);
  expect(doc.querySelector("meta[http-equiv]")?.getAttribute("content")).toContain(
    `script-src 'nonce-${doc.querySelector("script")!.getAttribute("nonce")}'`,
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
  expect(customModulePolicy).toContain("script-src 'none'");
  expect(customModulePolicy).toContain("connect-src 'none'");
  expect(customModulePolicy).not.toContain("https:");
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
      { ...defaultCustomModuleSettings, id: "one", name: "Score", html: "<h1>Draft</h1>" },
    ],
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Discard changes")!
    .trigger("click");
  expect(editor.state.doc.toString()).toBe(defaultCustomModuleSettings.html);
  wrapper.unmount();
});

test("Vim write in either source saves the current module's complete draft", async () => {
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
  htmlEditor.dispatch({
    changes: { from: 0, to: htmlEditor.state.doc.length, insert: "<h1>Saved</h1>" },
  });
  cssEditor.dispatch({
    changes: { from: 0, to: cssEditor.state.doc.length, insert: "h1 { color: red; }" },
  });
  for (const editor of [htmlEditor, cssEditor]) {
    Vim.handleEx(getCM(editor)!, "w");
    expect(save).toHaveBeenCalledTimes(editor === htmlEditor ? 1 : 2);
    expect(save).toHaveBeenLastCalledWith({
      ...config,
      customModules: [
        { ...config.customModules[0], html: "<h1>Saved</h1>", css: "h1 { color: red; }" },
        config.customModules[1],
      ],
    });
    Vim.handleEx(getCM(editor)!, "w");
    expect(save).toHaveBeenCalledTimes(editor === htmlEditor ? 1 : 2);
    finishSave(true);
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Custom Module saved");
  }
  wrapper.unmount();
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
  expect(rendered).not.toContain("alert(1)");
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
