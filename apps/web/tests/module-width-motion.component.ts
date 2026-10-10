import { afterEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { vModuleWidth } from "../src/module-width-motion.ts";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });

function host() {
  return defineComponent({ directives: { moduleWidth: vModuleWidth }, setup: () => ({ open: ref(true) }),
    template: '<div class="module-grid"><article v-module-width="open" :class="[\'module-card\', { collapsed: !open }]"><div class="module-heading"><button @click="open = !open">Fold</button></div><div class="module-body">Body</div></article></div>' });
}

test('folding measures the header and animates width without leaving a measuring copy', async () => {
  const cancel = vi.fn();
  const animation = { cancel, onfinish: undefined as undefined | (() => void) };
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { width: this.classList.contains('collapsed') ? 320 : 1040 } as DOMRect;
  });
  const wrapper = mount(host());
  await wrapper.get('button').trigger('click');
  expect(animate).toHaveBeenCalledWith([{ width: '1040px' }, { width: '320px' }], expect.objectContaining({ duration: 500 }));
  expect(wrapper.findAll('article')).toHaveLength(1);
  expect(wrapper.get('article').element.style.flexGrow).toBe('0');
  // A rapid reversal cancels the old width animation and restores auto sizing.
  await wrapper.get('button').trigger('click');
  expect(cancel).toHaveBeenCalledOnce();
  expect(wrapper.get('article').element.style.flexGrow).toBe('');
  expect(wrapper.get('article').element.style.width).toBe('');
  wrapper.unmount();
});

test('reduced motion leaves the intrinsic card width untouched', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const wrapper = mount(host());
  await wrapper.get('button').trigger('click');
  expect(animate).not.toHaveBeenCalled();
  expect(wrapper.get('article').element.style.width).toBe('');
  wrapper.unmount();
});
