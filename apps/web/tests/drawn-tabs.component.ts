import { expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import DrawnTabs from "../src/DrawnTabs.vue";

test("hand-drawn tabs select accessible panels with pointer and keyboard controls", async () => {
  const active = ref("commands");
  const Host = defineComponent({
    components: { DrawnTabs },
    setup: () => ({ active }),
    template: `<DrawnTabs v-model="active" label="Tools" :tabs="[
      {id:'commands',label:'Commands'}, {id:'middle',label:'Middle'}, {id:'create',label:'Create new'}
    ]"><p>{{ active }}</p></DrawnTabs>`,
  });
  const wrapper = mount(Host, { attachTo: document.body });
  try {
    const tabs = wrapper.findAll('[role="tab"]');
    for (const tab of tabs) {
      expect(tab.findAll('.tab-ink > span')).toHaveLength(3);
      expect(tab.get('.tab-ink').attributes('aria-hidden')).toBe('true');
    }
    expect(tabs[0]!.classes()).toContain("tab-left");
    expect(tabs[1]!.classes()).not.toContain("tab-left");
    expect(tabs[1]!.classes()).not.toContain("tab-right");
    expect(tabs[2]!.classes()).toContain("tab-right");
    expect(tabs.map(tab => (tab.element as HTMLElement).style.zIndex)).toEqual(['5', '2', '1']);
    expect((wrapper.get('[role="tabpanel"]').element as HTMLElement).style.zIndex).toBe('4');
    await tabs[0]!.trigger("keydown", { key: "ArrowRight" });
    expect(active.value).toBe("middle");
    expect(tabs.map(tab => (tab.element as HTMLElement).style.zIndex)).toEqual(['3', '5', '1']);
    expect(document.activeElement).toBe(tabs[1]!.element);
    expect(tabs[1]!.attributes("tabindex")).toBe("0");
    expect(wrapper.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe(
      tabs[1]!.attributes("id"),
    );
    await tabs[1]!.trigger("keydown", { key: "End" });
    expect(active.value).toBe("create");
    await tabs[2]!.trigger("keydown", { key: "ArrowRight" });
    expect(active.value).toBe("commands");
    await tabs[2]!.trigger("click");
    expect(active.value).toBe("create");
    expect(wrapper.get('[role="tabpanel"]').text()).toBe("create");
  } finally {
    wrapper.unmount();
  }
});
