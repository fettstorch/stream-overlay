import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { EditorView } from "@codemirror/view";
import CodeEditor from "../src/CodeEditor.vue";
import { getCM, Vim } from "@replit/codemirror-vim";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

test("Vim can be toggled on and off without replacing the document", async () => {
  const wrapper = mount(CodeEditor, {
    props: { modelValue: "abc", language: "css", label: "CSS source" },
  });
  const editor = EditorView.findFromDOM(
    wrapper.get('[aria-label="CSS source"]').element as HTMLElement,
  )!;
  expect(getCM(editor)).toBeNull();
  await wrapper.setProps({ vimMode: true });
  const cm = getCM(editor)!;
  expect(cm).toBeTruthy();
  Vim.handleEx(cm, "w");
  expect(wrapper.emitted("save")).toHaveLength(1);
  Vim.handleKey(cm, "l", "test");
  expect(editor.state.selection.main.head).toBe(1);
  Vim.handleKey(cm, "x", "test");
  expect(editor.state.doc.toString()).toBe("ac");
  await wrapper.setProps({ vimMode: false });
  expect(getCM(editor)).toBeNull();
  expect(editor.state.doc.toString()).toBe("ac");
  await wrapper.setProps({ vimMode: true });
  Vim.handleEx(getCM(editor)!, "write");
  expect(wrapper.emitted("save")).toHaveLength(2);
  wrapper.unmount();
});

test("CodeMirror edits text without rendering HTML and synchronizes external resets without emitting changes", async () => {
  const source = "<script>alert(1)</script><h1>Hello</h1>";
  const wrapper = mount(CodeEditor, {
    props: { modelValue: source, language: "html", label: "HTML source" },
  });
  const content = wrapper.get('[aria-label="HTML source"]');
  const editor = EditorView.findFromDOM(content.element as HTMLElement)!;
  expect(wrapper.find("script, h1").exists()).toBe(false);
  expect(wrapper.find(".cm-gutters").exists()).toBe(true);
  expect(editor.state.doc.toString()).toBe(source);
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "<p>Draft</p>" } });
  expect(wrapper.emitted("update:modelValue")).toEqual([["<p>Draft</p>"]]);
  await wrapper.setProps({ modelValue: "<p>Draft</p>" });
  await wrapper.setProps({ modelValue: source });
  expect(editor.state.doc.toString()).toBe(source);
  expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  document.documentElement.dataset.theme = "dark";
  await flushPromises();
  expect(editor.state.facet(EditorView.darkTheme)).toBe(true);
  document.documentElement.dataset.theme = "light";
  await flushPromises();
  expect(editor.state.facet(EditorView.darkTheme)).toBe(false);
  const dispatch = vi.spyOn(editor, "dispatch");
  wrapper.unmount();
  document.documentElement.dataset.theme = "dark";
  await flushPromises();
  expect(dispatch).not.toHaveBeenCalled();
});
