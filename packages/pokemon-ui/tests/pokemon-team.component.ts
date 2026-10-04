import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import PokemonTeam from "../src/PokemonTeam.vue";

describe("PokemonTeam", () => {
  test("keeps the supplied bubble and favourite avatar unmirrored", async () => {
    const pokemon = { id: "kleo", nationalDexNumber: 37, name: "Kleo", level: 40, hp: 50, maxHp: 100, experience: 67907 };
    const wrapper = mount(PokemonTeam, { props: {
      party: [pokemon], images: {}, fallbackImage: "/unknown.svg", activePets: {},
      thought: { pokemonId: "kleo", avatar: "/avatar.png", bubbleImage: "/bubble.gif", heartsImage: "/hearts.gif", startedAt: 123 },
    } });
    expect(wrapper.get(".thought-bubble").attributes("src")).toBe("/bubble.gif");
    expect(wrapper.get(".thought-bubble").attributes("style")).toBeUndefined();
    expect(wrapper.get(".thought-avatar").attributes("src")).toBe("/avatar.png");
    expect(wrapper.get(".thought-avatar").attributes("style")).toBeUndefined();
    await wrapper.setProps({ party: [{ ...pokemon, id: "another" }, pokemon] });
    expect(wrapper.findAll("figure")[1]!.find(".pokemon-thought").exists()).toBe(true);
    await wrapper.setProps({ party: [] });
    expect(wrapper.find(".pokemon-thought").exists()).toBe(false);
    wrapper.unmount();
  });
  test("renders party identity and current level", () => {
    const wrapper = mount(PokemonTeam, {
      props: {
        party: [{
          id: "kleo-id",
          nationalDexNumber: 37,
          name: "Kleo",
          level: 40,
          hp: 50,
          maxHp: 100,
          experience: 67907,
        }],
        images: { 37: "/vulpix.gif" },
        fallbackImage: "/unknown.svg",
        activePets: {},
      },
    });
    expect(wrapper.get(".pokemon-name").text()).toBe("Kleo");
    expect(wrapper.get(".pokemon-level").text()).toBe("Lv.40");
    expect(wrapper.get(".hp-meter .meter-fill").attributes("style")).toContain("50%");
  });

  test("renders the active viewer avatar with pet effects", () => {
    const wrapper = mount(PokemonTeam, {
      props: {
        party: [{
          id: "kleo-id",
          nationalDexNumber: 37,
          name: "Kleo",
          level: 40,
          hp: 100,
          maxHp: 100,
          experience: 67907,
        }],
        images: {},
        fallbackImage: "/unknown.svg",
        activePets: {
          "kleo-id": {
            avatar: "/avatar.png",
            handImage: "/hand.gif",
            heartsImage: "/hearts.gif",
            startedAt: 123,
          },
        },
      },
    });
    expect(wrapper.get(".pet-author-avatar").attributes("src")).toBe("/avatar.png");
    expect(wrapper.get(".pet-effect").attributes("src")).toContain("/hand.gif?restart=123");
    expect(wrapper.get(".pet-hearts").exists()).toBe(true);
  });
});
