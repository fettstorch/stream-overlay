import { afterEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { shallowRef } from "vue";
import SharedOverlay from "../src/SharedOverlay.vue";
import LayoutEditor from "../src/OverlayLayoutEditor.vue";
import { createSharedOverlayRuntime, overlayRuntimeKey } from "../src/shared-overlay-runtime.ts";
const transports = vi.hoisted(() => ({ relays: [] as any[], chats: [] as any[] }));
vi.mock("@streamface/browser-runtime", () => ({
  RelayClient: class {
    send = vi.fn();
    close = vi.fn();
    constructor(
      public url: string,
      public hello: any,
      public receive: any,
    ) {
      transports.relays.push(this);
    }
  },
}));
vi.mock("@streamface/stream-chat", async (original) => ({
  ...(await original<typeof import("@streamface/stream-chat")>()),
  DirectStreamChatService: class {
    messages = { subscribe: vi.fn(() => () => {}) };
    events = { subscribe: vi.fn(() => () => {}) };
    setStreamerDid = vi.fn();
    stop = vi.fn();
    constructor() {
      transports.chats.push(this);
    }
  },
}));
vi.mock("../src/OverlayNative.vue", () => ({
  default: { props: ["kind"], template: '<div :data-native="kind" />' },
}));
vi.mock("../src/OverlayChat.vue", () => ({ default: { template: "<div>Chat</div>" } }));
vi.mock("../src/CloudCrystalOverlay.vue", () => ({ default: { template: "<div>Pokémon</div>" } }));
const config = {
  streamerDid: "did:plc:fixture",
  enabled: true,
  commands: [],
  revision: "one",
  modules: { chat: true, paint: false, pets: false },
  bot: { enabled: true, rules: [] },
};
let host: ReturnType<typeof createSharedOverlayRuntime> | undefined;
let wrapper: ReturnType<typeof mount> | undefined;
afterEach(() => {
  wrapper?.unmount();
  host?.close();
  wrapper = undefined;
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  transports.relays.length = 0;
  transports.chats.length = 0;
});
test("one host shares transports across consumers and only the last release stops chat", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(config)),
  );
  host = createSharedOverlayRuntime(config.streamerDid, false, ["emoticons", "chat", "bot"]);
  await flushPromises();
  const releaseEmotes = host.acquireChat("emoticons"),
    releaseChat = host.acquireChat("chat");
  expect(transports.relays).toHaveLength(1);
  expect(transports.chats).toHaveLength(1);
  releaseEmotes();
  expect(transports.chats[0].setStreamerDid).toHaveBeenLastCalledWith(config.streamerDid);
  releaseChat();
  expect(transports.chats[0].setStreamerDid).toHaveBeenLastCalledWith("");
  expect(transports.relays[0].close).not.toHaveBeenCalled();
  host.close();
  expect(transports.relays[0].close).toHaveBeenCalledTimes(1);
  host = undefined;
});
test("saved toggles unmount modules; isolated preview respects toggle without mounting Bot", async () => {
  const state = shallowRef({
    ...config,
    preferences: {
      confirmDeletion: true,
      overlayLayout: [{ id: "chat", x: 1000, y: 2000, width: 3000, height: 4000, order: 12 }],
    },
  });
  const facade = { config: state, preview: true, did: config.streamerDid };
  wrapper = mount(SharedOverlay, {
    props: { only: "chat" },
    global: { provide: { [overlayRuntimeKey as symbol]: facade } },
  });
  expect(wrapper.findAll(".overlay-layer")).toHaveLength(1);
  expect(wrapper.get(".overlay-layer").attributes("style")).toContain("left: 10%");
  expect(wrapper.find('[data-module="bot"]').exists()).toBe(false);
  state.value = { ...state.value, modules: { ...state.value.modules, chat: false } };
  await flushPromises();
  expect(wrapper.findAll(".overlay-layer")).toHaveLength(0);
  state.value = { ...state.value, modules: { ...state.value.modules, chat: true } };
  await flushPromises();
  expect(wrapper.findAll(".overlay-layer")).toHaveLength(1);
  await wrapper.setProps({ fit: true });
  expect(wrapper.get(".overlay-layer").attributes("style")).toContain("left: 10%");
  expect(wrapper.find(".chat-preview-fit").exists()).toBe(true);
});
test("layout edits stay local until saved and preserve other preferences and module settings", async () => {
  const save = vi.fn(async () => true);
  wrapper = mount(LayoutEditor, {
    attachTo: document.body,
    props: {
      config: { ...config, preferences: { confirmDeletion: false, vimControls: true } },
      previewUrl: "/overlay/?preview=1",
      dimensions: { width: 1920, height: 1080 },
      modules: [{ id: "chat", name: "Chat" }],
      save,
    },
  });
  const region = wrapper.get('[data-layout-module="chat"]').element as HTMLElement;
  const parent = region.parentElement!;
  vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
    left: 740,
    top: 175,
    right: 990,
    bottom: 475,
    width: 250,
    height: 300,
  } as DOMRect);
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
  Object.defineProperties(parent, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } });
  Object.defineProperty(region, "offsetParent", { value: parent });
  region.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 740, clientY: 175 }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: 120, clientY: 175 }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await flushPromises();
  expect(save).not.toHaveBeenCalled();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save layout")!
    .trigger("click");
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      modules: config.modules,
      preferences: {
        confirmDeletion: false,
        vimControls: true,
        overlayLayout: [expect.objectContaining({ id: "chat", x: 1200 })],
      },
    }),
  );
});

test("dragging the layer list changes front-to-back order without changing module geometry", async () => {
  const layout = [
    { id: "chat", x: 1000, y: 2000, width: 2500, height: 5000, order: 20 },
    { id: "pokemon-crystal-mgba", x: 300, y: 1000, width: 3000, height: 8000, order: 10 },
  ];
  const save = vi.fn(async () => true);
  wrapper = mount(LayoutEditor, {
    props: {
      config: { ...config, preferences: { confirmDeletion: true, overlayLayout: layout } },
      previewUrl: "/overlay/?preview=1",
      dimensions: { width: 1920, height: 1080 },
      modules: [
        { id: "chat", name: "Chat" },
        { id: "overlay-paint", name: "Paint" },
        { id: "pokemon-crystal-mgba", name: "Pokémon" },
      ],
      save,
    },
  });
  expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(4);
  expect(wrapper.find("select").exists()).toBe(false);
  expect(wrapper.find('input[type="number"]').exists()).toBe(false);
  expect(wrapper.findAll("[data-layer]").map((row) => row.attributes("data-layer"))).toEqual([
    "overlay-paint",
    "chat",
    "emoticons-board",
    "pokemon-crystal-mgba",
  ]);
  const list = wrapper.get("ol").element as HTMLElement;
  list.setPointerCapture = vi.fn();
  list.hasPointerCapture = vi.fn(() => true);
  list.releasePointerCapture = vi.fn();
  for (const row of wrapper.findAll("[data-layer]")) {
    Object.defineProperties(row.element, {
      offsetTop: { get: () => [...list.children].indexOf(row.element) * 36 },
      offsetHeight: { value: 32 },
    });
  }
  await wrapper.get('[data-layer="chat"]').trigger("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 40,
  });
  await wrapper.get("ol").trigger("pointermove", {
    pointerId: 1,
    clientX: 10,
    clientY: 0,
  });
  expect(wrapper.findAll("[data-layer]")[0]!.attributes("data-layer")).toBe("chat");
  expect(wrapper.get('[data-layer="chat"]').classes()).toContain("dragging");
  await wrapper.get("ol").trigger("pointerup", { pointerId: 1 });
  expect(list.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(wrapper.find(".dragging").exists()).toBe(false);
  expect(wrapper.findAll("[data-layer]").map((row) => row.attributes("data-layer"))).toEqual([
    "chat",
    "overlay-paint",
    "emoticons-board",
    "pokemon-crystal-mgba",
  ]);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save layout")!
    .trigger("click");
  const saved = save.mock.calls[0]![0] as any;
  expect(saved.preferences.overlayLayout.find((item: any) => item.id === "chat")).toEqual({
    ...layout[0],
    order: 4,
  });
  expect(
    saved.preferences.overlayLayout.find((item: any) => item.id === "pokemon-crystal-mgba"),
  ).toEqual({ ...layout[1], order: 1 });
  expect(
    saved.preferences.overlayLayout.find((item: any) => item.id === "overlay-paint").order,
  ).toBe(3);
});

test("layer ordering is keyboard accessible and reset restores the saved stack", async () => {
  wrapper = mount(LayoutEditor, {
    props: {
      config,
      previewUrl: "/overlay/?preview=1",
      dimensions: { width: 1920, height: 1080 },
      modules: [
        { id: "chat", name: "Chat" },
        { id: "overlay-paint", name: "Paint" },
      ],
      save: vi.fn(async () => true),
    },
  });
  await wrapper
    .get('[aria-label="Select Chat layer"]')
    .trigger("keydown", { key: "ArrowUp", altKey: true });
  expect(wrapper.findAll("[data-layer]").map((row) => row.attributes("data-layer"))).toEqual([
    "chat",
    "overlay-paint",
    "emoticons-board",
  ]);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Reset edits")!
    .trigger("click");
  expect(wrapper.findAll("[data-layer]").map((row) => row.attributes("data-layer"))).toEqual([
    "overlay-paint",
    "chat",
    "emoticons-board",
  ]);
});

test("command listing can be disabled independently but follows the parent Emotes toggle", async () => {
  const state = shallowRef({
    ...config,
    preferences: {
      confirmDeletion: true,
      overlayLayout: [
        {
          id: "emoticons-board",
          x: 7400,
          y: 200,
          width: 2500,
          height: 3000,
          order: 15,
          hidden: true,
        },
      ],
    },
  });
  wrapper = mount(SharedOverlay, {
    global: { provide: { [overlayRuntimeKey as symbol]: { config: state, preview: true } } },
  });
  expect(wrapper.find('[data-module="emoticons-board"]').exists()).toBe(false);
  expect(wrapper.find('[data-module="emoticons"]').exists()).toBe(true);
  state.value = { ...state.value, preferences: { ...state.value.preferences, overlayLayout: state.value.preferences.overlayLayout.map(item => ({...item, hidden: false})) } };
  await flushPromises();
  expect(wrapper.find('[data-module="emoticons-board"]').exists()).toBe(true);
  state.value = { ...state.value, enabled: false };
  await flushPromises();
  expect(wrapper.find('[data-module="emoticons-board"]').exists()).toBe(false);
});

test("list actions emit module commands without changing the layout", async () => {
  wrapper = mount(LayoutEditor, {
    props: { config, previewUrl: "/overlay/?preview=1", dimensions: {width:1920,height:1080},
      modules: [{id:"chat",name:"Chat",enabled:true}], save:vi.fn(async () => true) },
  });
  const row = wrapper.get('[data-layer="chat"]');
  expect((row.get("input").element as HTMLInputElement).checked).toBe(true);
  await row.get("input").setValue(false);
  expect(wrapper.emitted("toggle-module")![0]![0]).toBe("chat");
  await row.get('[aria-label="Edit Chat"]').trigger("click");
  expect(wrapper.emitted("edit-module")![0]).toEqual(["chat"]);
  expect(wrapper.findAll("button").find(button => button.text() === "Save layout")!.attributes("disabled")).toBeDefined();
});

test("page modules leave the shared overlay, fill their own page, and respect enable changes", async () => {
  const module = { id: "page", name: "Page", enabled: true, displayMode: "page" as const, html: "<h1>Page</h1>", css: "" };
  const state = shallowRef({ ...config, customModules: [module, { ...module, id: "legacy", displayMode: undefined }] });
  wrapper = mount(SharedOverlay, {
    global: { provide: { [overlayRuntimeKey as symbol]: { config: state, preview: false, report: vi.fn() } } },
  });
  expect(wrapper.find('[data-module="custom:page"]').exists()).toBe(false);
  expect(wrapper.find('[data-module="custom:legacy"]').exists()).toBe(true);
  await wrapper.setProps({ only: "custom:page" });
  expect(wrapper.findAll(".overlay-layer")).toHaveLength(1);
  expect(wrapper.get(".overlay-layer").attributes("style")).toContain("inset: 0");
  state.value = { ...state.value, customModules: [{ ...module, enabled: false }] };
  await flushPromises();
  expect(wrapper.findAll(".overlay-layer")).toHaveLength(0);
});
