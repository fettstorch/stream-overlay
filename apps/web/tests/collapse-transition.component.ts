import { afterEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import CollapsibleSection from "../src/CollapsibleSection.vue";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("sections animate measured height, release sizing and become inert on collapse", async () => {
  const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish?: () => void }> = [];
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = { cancel: vi.fn(), onfinish: undefined as undefined | (() => void) };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const open = ref(false);
  const Host = defineComponent({ components: { CollapsibleSection }, setup: () => ({ open }),
    template: '<CollapsibleSection v-model:open="open" title="Preview"><p>Content</p></CollapsibleSection>' });
  const wrapper = mount(Host, { global: { stubs: { transition: false } } });
  const content = wrapper.get('.section-content');
  open.value = true;
  await nextTick();
  await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
  expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 500 });
  expect(content.attributes('inert')).toBeUndefined();
  animations[0]?.onfinish?.();
  expect((content.element as HTMLElement).style.overflow).toBe('');
  open.value = false;
  await nextTick();
  expect(content.attributes('inert')).toBeDefined();
  await vi.waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
  animations[1]?.onfinish?.();
  expect((content.element as HTMLElement).style.display).toBe('none');
  wrapper.unmount();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

test("reduced motion expands immediately without starting animation", async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const wrapper = mount(CollapsibleSection, { props: { title: 'Settings' }, global: { stubs: { transition: false } } });
  await wrapper.get('button').trigger('click');
  await vi.waitFor(() => expect((wrapper.get('.section-content').element as HTMLElement).style.display).not.toBe('none'));
  expect(animate).not.toHaveBeenCalled();
  wrapper.unmount();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

test("rapid toggles cancel old animations and unmount cleans up", async () => {
  const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish?: () => void }> = [];
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), onfinish: undefined as undefined | (() => void) };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const wrapper = mount(CollapsibleSection, { props: { title: 'Preview' }, global: { stubs: { transition: false } } });
  await wrapper.get('button').trigger('click');
  await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
  await wrapper.get('button').trigger('click');
  expect(animations[0]?.cancel).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
  await wrapper.get('button').trigger('click');
  expect(animations[1]?.cancel).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(animate).toHaveBeenCalledTimes(3));
  wrapper.unmount();
  expect(animations[2]?.cancel).toHaveBeenCalledOnce();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});
