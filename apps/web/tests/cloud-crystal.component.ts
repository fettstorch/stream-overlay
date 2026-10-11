import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Overlay from "../src/CloudCrystalOverlay.vue";
import Controls from "../src/CloudCrystalControls.vue";
import ChatTest from "../src/CrystalChatTest.vue";
import PettingControls from "../src/CrystalPettingControls.vue";
import DeleteConfirmation from "../src/DeleteConfirmation.vue";
import placeholder from "../../../assets/unknown-pokemon.svg";
const chat = vi.hoisted(() => ({ receive: undefined as any }));
vi.mock("../src/actor-search.ts", () => ({
  loadPublicActorProfile: vi.fn(async (did: string) => ({ did, avatar: "https://example.test/avatar.png" })),
}));
const giphy = vi.hoisted(() => ({
  searchGiphy: vi.fn(async () => [
    {
      id: "pika",
      title: "Pikachu",
      preview: "https://example.test/preview.gif",
      url: "https://example.test/pikachu.gif",
    },
  ]),
}));
vi.mock("../src/giphy.ts", () => giphy);
const relay = vi.hoisted(() => ({
  receive: undefined as any,
  reconnect: undefined as any,
  hello: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@streamface/browser-runtime", () => ({
  RelayClient: class {
    constructor(_url: string, hello: unknown, receive: any, reconnect: any) {
      relay.receive = receive;
      relay.reconnect = reconnect;
      relay.hello(hello);
    }
    send = relay.send;
    close = relay.close;
  },
}));
vi.mock("@streamface/stream-chat", () => ({
  DirectStreamChatService: class {
    messages = {
      subscribe: (receive: any) => {
        chat.receive = receive;
        return () => {};
      },
    };
    setStreamerDid() {}
    stop() {}
  },
}));
let wrapper: ReturnType<typeof mount> | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const snapshot = (hp: number) => ({
  party: [
    {
      id: "0001-0002",
      nationalDexNumber: 25,
      name: "PIKA",
      level: 5,
      hp,
      maxHp: 20,
      experience: 125,
      experienceAtLevel: 125,
      experienceAtNextLevel: 216,
      isEgg: false,
    },
  ],
  badges: { ownedBadgeIds: ["zephyr"] },
  capturedAt: "now",
});
test("Crystal overlay receives rapid HP updates, refreshes artwork, and clears stale state", async () => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/pokemon-crystal-mgba/?did=did:plc:a&preview=1");
  let media = [{ number: 25, url: "https://example.test/one.gif" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ pokemonCrystalMgbaMedia: media })),
  );
  wrapper = mount(Overlay);
  await flushPromises();
  expect(relay.hello).toHaveBeenCalledWith(
    expect.objectContaining({ page: "pokemon-crystal-mgba", channel: "preview" }),
  );
  expect(wrapper.find(".crystal-cloud-overlay").exists()).toBe(false);
  relay.receive({ type: "pokemon-crystal-mgba", snapshot: snapshot(20) });
  await flushPromises();
  expect(wrapper.text()).toContain("PIKA");
  expect(wrapper.html()).toContain("one.gif");
  relay.receive({ type: "pokemon-crystal-mgba", snapshot: snapshot(7) });
  await flushPromises();
  expect(wrapper.find(".hp-meter .meter-fill").attributes("style")).toContain("35%");
  media = [{ number: 25, url: "https://example.test/two.gif" }];
  relay.receive({ type: "config-changed" });
  await flushPromises();
  expect(wrapper.html()).toContain("two.gif");
  await vi.advanceTimersByTimeAsync(10001);
  expect(wrapper.find(".crystal-cloud-overlay").exists()).toBe(false);
  relay.receive({ type: "pokemon-crystal-mgba", snapshot: snapshot(6) });
  await flushPromises();
  relay.reconnect();
  await flushPromises();
  expect(wrapper.find(".crystal-cloud-overlay").exists()).toBe(false);
});
test("Crystal controls save only artwork mappings and restore defaults", async () => {
  const config = {
    streamerDid: "did:plc:a",
    enabled: true,
    commands: [],
    pokemonCrystalMgbaMedia: [{ number: 25, url: "https://example.test/old.gif" }],
  };
  const save = vi.fn(async () => true);
  wrapper = mount(Controls, { props: { config, save } });
  for (const button of wrapper.findAll("button")) {
    expect(button.find('.button-press-shade[aria-hidden="true"]').exists()).toBe(true);
    expect(button.find('.button-hover-shade[aria-hidden="true"]').exists()).toBe(true);
    expect(button.find(".button-content").exists()).toBe(true);
  }
  await wrapper
    .find('input[placeholder="https://… or pikachu"]')
    .setValue("https://example.test/new.gif");
  expect(wrapper.get("form button").classes()).toContain("success-button");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(save).toHaveBeenCalledWith({
    ...config,
    pokemonCrystalMgbaMedia: [{ number: 25, url: "https://example.test/new.gif" }],
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Remove")!
    .trigger("click");
  await flushPromises();
  expect(save).toHaveBeenLastCalledWith({ ...config, pokemonCrystalMgbaMedia: [] });
});
test("live party artwork selects the species automatically and clears stale party data", async () => {
  vi.useFakeTimers();
  wrapper = mount(Controls, { props: { panel: "artwork", config: { streamerDid: "did:plc:a", enabled: true, commands: [] }, save: vi.fn(async () => true) } });
  relay.receive({ type: "pokemon-crystal-mgba", snapshot: snapshot(20) });
  await flushPromises();
  expect(wrapper.get(".party-artwork-card").text()).toContain("PIKA");
  expect(wrapper.get(".party-artwork-card img").attributes("src")).toBe(placeholder);
  expect(wrapper.get('input[type="number"]').element.parentElement!.parentElement!.style.display).toBe("none");
  await wrapper.get(".party-artwork-card button").trigger("click");
  expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe("25");
  expect(wrapper.get('input[type="number"]').element.parentElement!.parentElement!.style.display).not.toBe("none");
  await vi.advanceTimersByTimeAsync(10001);
  expect(wrapper.find(".party-artwork-card").exists()).toBe(false);
});
test("Crystal artwork searches stickers, applies direct media and accepts file drops", async () => {
  vi.useFakeTimers();
  const blob = {
    $type: "blob",
    ref: { $link: "bafkreigh2akiscaildc6rnag6ni5nrd6tmjuj6aqn5mltlhdp4dt2o5x4i" },
    mimeType: "image/gif",
    size: 4,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => Response.json(String(input).endsWith("/media") ? blob : {})),
  );
  const save = vi.fn(async () => true);
  wrapper = mount(Controls, {
    props: { config: { streamerDid: "did:plc:a", enabled: true, commands: [] }, save },
  });
  await wrapper.get('input[placeholder="https://… or pikachu"]').setValue("pikachu");
  expect(wrapper.find("form button").exists()).toBe(false);
  await vi.advanceTimersByTimeAsync(401);
  await flushPromises();
  expect(giphy.searchGiphy).toHaveBeenCalledWith("pikachu", "stickers");
  expect(wrapper.get(".sticker-results button .button-press-shade").exists()).toBe(true);
  expect(wrapper.get(".sticker-results button .button-hover-shade").exists()).toBe(true);
  expect(wrapper.get(".sticker-results button .button-content").text()).toBe("Apply");
  await wrapper.get(".sticker-results button").trigger("click");
  await flushPromises();
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      pokemonCrystalMgbaMedia: [{ number: 25, url: "https://example.test/pikachu.gif" }],
    }),
  );
  await wrapper
    .get(".artwork-drop")
    .trigger("drop", {
      dataTransfer: { files: [new File(["GIF8"], "pika.gif", { type: "image/gif" })] },
    });
  await flushPromises();
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ pokemonCrystalMgbaMedia: [{ number: 25, blob }] }),
  );
});
test("sticker batches advance and a new query resets pagination", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  giphy.searchGiphy.mockResolvedValueOnce(Array.from({ length: 18 }, (_, index) => ({ id: String(index), title: "Sticker", preview: "https://example.test/preview.gif", url: "https://example.test/sticker.gif" })));
  wrapper = mount(Controls, { props: { config: { streamerDid: "did:plc:a", enabled: true, commands: [] }, save: vi.fn(async () => true) } });
  const input = wrapper.get('input[placeholder="https://… or pikachu"]');
  await input.setValue("pikachu");
  await vi.advanceTimersByTimeAsync(401);
  await flushPromises();
  await wrapper.findAll("button").find(button => button.text() === "Next batch")!.trigger("click");
  await flushPromises();
  expect(giphy.searchGiphy).toHaveBeenLastCalledWith("pikachu", "stickers", 18);
  await input.setValue("eevee");
  await vi.advanceTimersByTimeAsync(401);
  await flushPromises();
  expect(giphy.searchGiphy).toHaveBeenLastCalledWith("eevee", "stickers");
});
test("preview listens to real chat and submits a signed party witness for pet history", async () => {
  history.replaceState({}, "", "/pokemon-crystal-mgba/?did=did:plc:a&preview=1");
  const fetcher = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  wrapper = mount(Overlay);
  await flushPromises();
  relay.receive({
    type: "pokemon-crystal-mgba",
    snapshot: snapshot(20),
    petWitness: "signed-party",
  });
  chat.receive({
    id: "did:plc:petter:abc",
    text: "!pet PIKA",
    author: { did: "did:plc:petter" },
  });
  await flushPromises();
  expect(wrapper.find(".pet-hearts").exists()).toBe(true);
  expect(wrapper.html()).toContain("https://example.test/avatar.png");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/accounts/did%3Aplc%3Aa/pokemon-crystal-mgba/pet",
    expect.objectContaining({
      body: JSON.stringify({
        witness: "signed-party",
        uri: "at://did:plc:petter/place.stream.chat.message/abc",
      }),
    }),
  );
});
test("thoughts rotate through the party and pause their visible lifetime during pets", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (input) => Response.json(String(input).includes("pet-counts")
    ? [{ pokemonId: "0001-0002", petterDid: "did:plc:petter", count: 2 }, { pokemonId: "second", petterDid: "did:plc:other", count: 1 }]
    : {})));
  wrapper = mount(Overlay);
  const team = snapshot(20);
  team.party.push({ ...team.party[0]!, id: "second", name: "SECOND" });
  const refresh = () => relay.receive({ type: "pokemon-crystal-mgba", snapshot: team });
  refresh();
  const live = setInterval(refresh, 1000);
  try {
    await vi.advanceTimersByTimeAsync(120000);
    await flushPromises();
    expect(wrapper.get(".pokemon-thought").element.closest("figure")?.textContent).toContain("PIKA");
    await vi.advanceTimersByTimeAsync(5000);
    chat.receive({ id: "did:plc:petter:thought", text: "!pet PIKA", author: { did: "did:plc:petter" } });
    await flushPromises();
    expect(wrapper.find(".pokemon-thought").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(wrapper.find(".pokemon-thought").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(wrapper.find(".pokemon-thought").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(100000);
    await flushPromises();
    expect(wrapper.get(".pokemon-thought").element.closest("figure")?.textContent).toContain("SECOND");
  } finally { clearInterval(live); }
});
test("pet deletion uses shared confirmation and preserves account preferences", async () => {
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => Response.json(init?.method === "DELETE" ? { removed: 1 } : [{ pokemonId: "0001-0002", petterDid: "did:plc:petter", count: 2 }]));
  vi.stubGlobal("fetch", fetcher);
  const config = { enabled: true, streamerDid: "did:plc:a", commands: [], revision: "new", preferences: { confirmDeletion: true, vimControls: true } };
  const save = vi.fn(async () => true);
  wrapper = mount(PettingControls, { props: { config, save }, global: { stubs: { DeleteConfirmation: true } } });
  await flushPromises();
  await wrapper.findAll("button").find(button => button.text() === "Remove")!.trigger("click");
  expect(wrapper.findComponent(DeleteConfirmation).exists()).toBe(true);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  wrapper.findComponent(DeleteConfirmation).vm.$emit("confirm", true);
  await flushPromises();
  expect(save).toHaveBeenCalledWith({ ...config, preferences: { confirmDeletion: false, vimControls: true } });
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  await wrapper.setProps({ config: { ...config, preferences: { ...config.preferences, confirmDeletion: false } } });
  await wrapper.findAll("button").find(button => button.text() === "Reset all pet counts")!.trigger("click");
  await flushPromises();
  expect(wrapper.findComponent(DeleteConfirmation).exists()).toBe(false);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
});
test("pet test sends a real owner chat message and clears the composer only after success", async () => {
  const fetcher = vi.fn(async () => Response.json({ sent: true }));
  vi.stubGlobal("fetch", fetcher);
  wrapper = mount(ChatTest, { props: { did: "did:plc:a" } });
  await wrapper.get("input").setValue("!pet PIKA");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/accounts/did%3Aplc%3Aa/chat/message",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "!pet PIKA" }) }),
  );
  expect((wrapper.get("input").element as HTMLInputElement).value).toBe("");
});
