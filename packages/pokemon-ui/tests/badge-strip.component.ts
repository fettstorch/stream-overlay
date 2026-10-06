import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import BadgeStrip from "../src/BadgeStrip.vue";

const badges = [
  { id: "boulder", name: "Boulder Badge", image: "/boulder.png" },
  { id: "cascade", name: "Cascade Badge", image: "/cascade.png" },
];

describe("BadgeStrip", () => {
  test("renders owned badges normally and dims unowned badges", () => {
    const wrapper = mount(BadgeStrip, {
      props: { badges, ownedBadgeIds: ["boulder"] },
    });
    expect(wrapper.get('img[title="Boulder Badge"]').classes()).toContain("owned");
    expect(wrapper.get('img[title="Cascade Badge"]').classes()).toContain("unowned");
  });
});
