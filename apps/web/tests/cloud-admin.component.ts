import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudAdmin from "../src/CloudAdmin.vue";
import CloudEmoticonControls from "../src/CloudEmoticonControls.vue";

const actorMocks = vi.hoisted(() => ({
  loadPublicActorProfile: vi.fn(async () => ({ did: "did:plc:alice", handle: "alice.bsky.social", displayName: "Alice", avatar: "https://cdn.example/alice.jpg" })),
  searchPublicActors: vi.fn(async () => []),
}));
vi.mock("../src/actor-search.ts", () => actorMocks);

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); actorMocks.loadPublicActorProfile.mockReset(); actorMocks.loadPublicActorProfile.mockResolvedValue({ did: "did:plc:alice", handle: "alice.bsky.social", displayName: "Alice", avatar: "https://cdn.example/alice.jpg" }); });
const session = { did: "did:plc:alice" };
const config = { enabled: true, streamerDid: session.did, revision: "1", commands: [{ id: "wave", command: "wave", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false, image: { url: "https://cdn.example/wave.gif" } }] };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function mediaDrag(type: string, name = "drop.gif") { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [new File(["GIF8"], name)], dropEffect: "none" } }); return event; }

describe("Cloud Admin", () => {
  test("uses the account stream, plain pin emoji, lazy audible effects and a matching preview listing channel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response({ ...config, streamerDid: "did:plc:someone-else" }));
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(CloudAdmin); await flushPromises();
    expect(wrapper.find('[aria-label="Streamer handle"]').exists()).toBe(false);
    expect(wrapper.get('.pin-button').text()).toBe("📌");
    expect(wrapper.findAll('.module-message')).toHaveLength(0);
    await wrapper.get('button[aria-label="Show Emoticons details"]').trigger("click");
    const clipsToggle = wrapper.get('button[aria-label="Hide Clips"]');
    expect(clipsToggle.attributes('aria-expanded')).toBe('true');
    expect(clipsToggle.get('svg').classes()).toContain('expanded');
    await clipsToggle.trigger('click');
    expect(wrapper.get('button[aria-label="Show Clips"]').attributes('aria-expanded')).toBe('false');
    await wrapper.get('button[aria-label="Show Clips"]').trigger('click');
    expect(wrapper.find('iframe[title="Emoticons preview"]').exists()).toBe(false);
    expect(wrapper.find('details').exists()).toBe(false);
    await wrapper.get('button[aria-label="Show Effects preview (with sound)"]').trigger('click');
    expect(wrapper.get('iframe[title="Emoticons preview"]').attributes('src')).not.toContain('muted=1');
    expect(wrapper.get('iframe[title="Stream background"]').attributes('src')).toContain(encodeURIComponent(session.did));
    await wrapper.get('button[aria-label="Show Live command listing preview"]').trigger('click');
    expect(wrapper.get('iframe[title="Emoticons command listing preview"]').attributes('src')).toContain('preview=1');
    await wrapper.get('button[aria-label="Hide Effects preview (with sound)"]').trigger('click');
    expect(wrapper.find('iframe[title="Emoticons preview"]').exists()).toBe(false);
    wrapper.unmount();
  });
  test("does not label every sticker redundantly", () => {
    const wrapper = mount(CloudEmoticonControls, { props: { did: session.did, config: { ...config, commands: [{ ...config.commands[0], mode: 'sticker' }] }, save: vi.fn(async () => true) } });
    expect(wrapper.get('.command-list li').text()).not.toContain('Sticker'); wrapper.unmount();
  });
  test("shows save failures only on the module that made the change, with no generic success messages", async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/api/session') ? response(session) : init?.method === 'PUT' ? response({ message: 'Pets could not be saved.' }, 400) : response(config)));
    const wrapper = mount(CloudAdmin); await flushPromises();
    await wrapper.get('[aria-label="Enable Streamplace Pets"]').setValue(false); await flushPromises();
    expect(wrapper.findAll('.module-message')).toHaveLength(1);
    expect(wrapper.get('[data-module="streamplace-pets"] .module-message').text()).toContain('Pets could not be saved.');
    expect(wrapper.find('[data-module="emoticons"] .module-message').exists()).toBe(false); wrapper.unmount();
  });
  test("requires playable media and preserves original millisecond duration precision", async () => {
    const save = vi.fn(async () => true);
    const wrapper = mount(CloudEmoticonControls, { props: { did: session.did, config: { ...config, commands: [] }, save } });
    await wrapper.get(".primary-button").trigger("click"); await wrapper.get('input[placeholder="!wow"]').setValue("wave");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(save).not.toHaveBeenCalled(); expect(wrapper.text()).toContain("Add an image, audio, or video");
    expect(wrapper.get('input[min="0.001"]').attributes("step")).toBe("any"); wrapper.unmount();
  });
  test("includes every non-Pokémon module with working URL and appearance controls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/session")) return response(session);
      if (String(input).endsWith("/dimensions")) return response({ dimensions: { width: 2560, height: 1440 } });
      return response(init?.method === "PUT" ? JSON.parse(String(init.body)) : config);
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(CloudAdmin); await flushPromises();
    expect(wrapper.findAll("[data-module]").map(card => card.attributes("data-module"))).toEqual(["emoticons", "chat", "overlay-paint", "streamplace-pets"]);
    expect(wrapper.text()).toContain("2560 × 1440");
    for (const [name, path] of [["Chat", "/chat/"], ["Overlay Paint", "/paint/"], ["Streamplace Pets", "/pets/"]]) {
      await wrapper.get(`button[aria-label="Show ${name} details"]`).trigger("click");
      const iframe = wrapper.get(`iframe[title="${name} preview"]`);
      expect(iframe.attributes("src")).toContain(`${path}?did=did%3Aplc%3Aalice`);
    }
    expect(wrapper.findAll('[aria-label="Chat appearance"] input')).toHaveLength(7);
    const delay = wrapper.get('[aria-label="Paint appearance"] input[type=number]'); await delay.setValue(3.5); await delay.trigger("change"); await flushPromises();
    const write = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    const saved = JSON.parse(String(write[1]?.body));
    expect(saved.paint.decaySeconds).toBe(3.5); expect(saved.chat.fontSize).toBe(20); expect(saved.commands).toEqual(config.commands);
    expect(wrapper.find('a[href="https://rpg.actor/streampets"]').exists()).toBe(true);
    const attribution = wrapper.get('aside[aria-label="Streamplace Pets attribution"]');
    expect(attribution.classes()).toContain('upstream-info');
    expect(attribution.text()).toContain('Eli Mallon (iameli)');
    expect(attribution.find('a[href="https://github.com/streamplace/streamplace-pets"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('No redistribution licence');
    await wrapper.get('button[aria-label="Hide Chat details"]').trigger("click");
    expect(wrapper.find('iframe[title="Chat preview"]').exists()).toBe(false);
    wrapper.unmount();
  });
  test("tests a saved command through its authenticated account endpoint and preserves editing controls", async () => {
    const fetchMock = vi.fn(async () => response({ delivered: 1, message: "Test sent to connected effect sources." }));
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(CloudEmoticonControls, { props: { did: session.did, config, save: vi.fn(async () => true) } });
    expect(wrapper.findAll(".command-list button").map(button => button.text())).toEqual(["Test", "Edit", "Delete"]);
    await wrapper.get(".command-list button").trigger("click"); await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts/did%3Aplc%3Aalice/test/wave", { method: "POST" });
    expect(wrapper.text()).toContain("Test sent to connected effect sources."); wrapper.unmount();
  });
  test("presents anonymous sign-in as an ATProto account with accessible handle search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ authenticated: false }, 401)));
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises();
    expect(wrapper.text()).toContain("Connect your account"); expect(wrapper.text()).toContain("ATProto handle"); expect(wrapper.text()).not.toContain("Cloud account");
    const input = wrapper.get('input[name="handle"]'); expect(input.attributes("role")).toBe("combobox"); expect(input.attributes("aria-autocomplete")).toBe("list"); wrapper.unmount();
  });

  test("renders the established control-room module and command editor for saved PDS data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response(config)));
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises();
    expect(wrapper.text()).toContain("Control room"); expect(wrapper.text()).toContain("Emoticons"); expect(wrapper.text()).toContain("!wave");
    expect(wrapper.text()).toContain("ATPROTO ACCOUNT"); expect(wrapper.text()).toContain("Connected"); expect(wrapper.text()).toContain("@alice.bsky.social"); expect(wrapper.text()).not.toContain("CLOUD ACCOUNT");
    expect(wrapper.get(".account-profile img").attributes("src")).toBe("https://cdn.example/alice.jpg");
    expect(wrapper.find('[aria-label="Enable Emoticons"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Copy Emoticons effects OBS URL"]').exists()).toBe(true);
    await wrapper.get('button[aria-label="Show Emoticons details"]').trigger("click");
    await wrapper.get(".emoticon-controls .primary-button").trigger("click");
    expect(wrapper.text()).toContain("Create command"); expect(wrapper.text()).toContain("Media — drop files or choose");
    expect(wrapper.findAll('.drop-zone input[type="url"]')).toHaveLength(1); expect(wrapper.text()).not.toContain("Image/GIF URL"); expect(wrapper.text()).toContain("one visual and separate audio");
    wrapper.unmount();
  });

  test("uploads a GIF with an empty browser MIME and keeps separate audio", async () => {
    const save = vi.fn(async () => true);
    const fetchMock = vi.fn(async () => response({ $type: "blob", ref: { $link: "bafygif" }, mimeType: "image/gif", size: 4 }));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn(); });
    const wrapper = mount(CloudEmoticonControls, { props: { did: session.did, config: { ...config, commands: [] }, save } });
    await wrapper.get(".primary-button").trigger("click"); const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, "files", { configurable: true, value: [new File(["GIF8"], "dance.gif")] }); await input.trigger("change"); await flushPromises();
    Object.defineProperty(input.element, "files", { configurable: true, value: [new File(["sound"], "sound.mp3", { type: "audio/mpeg" })] }); await input.trigger("change"); await flushPromises();
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ headers: { "Content-Type": "image/gif" } }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ headers: { "Content-Type": "audio/mpeg" } }));
    expect(wrapper.text()).toContain("image attached"); expect(wrapper.text()).toContain("audio attached"); wrapper.unmount();
  });

  test("shows the correlated request reference for an upload failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "pds-upload-failed", message: "Your PDS rejected the media upload.", requestId: "request-123" }, 502)));
    const wrapper = mount(CloudEmoticonControls, { props: { did: session.did, config: { ...config, commands: [] }, save: vi.fn(async () => true) } }); await wrapper.get(".primary-button").trigger("click"); const input=wrapper.get('input[type="file"]'); Object.defineProperty(input.element,"files",{configurable:true,value:[new File(["GIF8"],"failed.gif")]}); await input.trigger("change"); await flushPromises(); expect(wrapper.text()).toContain("Your PDS rejected the media upload. Reference: request-123"); wrapper.unmount();
  });

  test("keeps a loaded blob reference while using its derived URL only for preview", async () => {
    const save = vi.fn(async () => true), stored = { $type: "blob", ref: { $link: "bafyblob" }, mimeType: "image/gif", size: 4 };
    const command = { ...config.commands[0], image: { blob: stored, url: "https://pds.example/xrpc/blob" } };
    const wrapper = mount(CloudEmoticonControls, { props: { did: session.did, config: { ...config, commands: [command] }, save } });
    await wrapper.get(".command-list button:nth-of-type(2)").trigger("click"); await wrapper.get("form").trigger("submit"); await flushPromises();
    const candidate = save.mock.calls[0][0]; expect(candidate.commands[0].image).toEqual({ blob: stored }); wrapper.unmount();
  });

  test("opens collapsed Create and uploads a card-dropped file exactly once", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/session")) return response(session);
      if (init?.method === "POST") return response({ $type: "blob", ref: { $link: "bafydrop" }, mimeType: "image/gif", size: 4 });
      return response(config);
    });
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:drop"); static revokeObjectURL = vi.fn(); });
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises(); const card = wrapper.get(".module-card");
    card.element.dispatchEvent(mediaDrag("dragenter")); await wrapper.vm.$nextTick(); expect(card.classes()).toContain("file-drag-active"); expect(wrapper.text()).toContain("Drop media to create a command");
    card.element.dispatchEvent(mediaDrag("drop")); await flushPromises();
    expect(wrapper.get('button[aria-label="Hide Emoticons details"]').attributes("aria-expanded")).toBe("true"); expect(wrapper.text()).toContain("Create command"); expect(wrapper.text()).toContain("image attached");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); wrapper.unmount();
  });

  test("does not duplicate nested drops or discard an open draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/api/session") ? response(session) : init?.method === "POST" ? response({ $type: "blob", ref: { $link: "bafydrop" }, mimeType: "image/gif", size: 4 }) : response(config));
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:drop"); static revokeObjectURL = vi.fn(); });
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises(); await wrapper.get('button[aria-label="Show Emoticons details"]').trigger("click"); await wrapper.get(".emoticon-controls .primary-button").trigger("click"); await wrapper.get('input[placeholder="!wow"]').setValue("draft");
    wrapper.get(".drop-zone").element.dispatchEvent(mediaDrag("drop")); await flushPromises();
    expect((wrapper.get('input[placeholder="!wow"]').element as HTMLInputElement).value).toBe("draft"); expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); wrapper.unmount();
  });

  test("rejects unsupported card drops without opening an empty editor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response(config)); vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises(); wrapper.get(".module-card").element.dispatchEvent(mediaDrag("drop", "notes.txt")); await flushPromises();
    expect(wrapper.find(".command-editor").exists()).toBe(false); expect(wrapper.text()).toContain("Unsupported file: notes.txt"); expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0); wrapper.unmount();
  });

  test("shares baseline search, pin persistence, and collapse behavior", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response(config)));
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises();
    expect(wrapper.get('button[aria-label="Show Emoticons details"]').attributes("aria-expanded")).toBe("false");
    expect((wrapper.get(".module-body").element as HTMLElement).style.display).toBe("none");
    await wrapper.get('button[aria-label="Show Emoticons details"]').trigger("click");
    expect(wrapper.get('button[aria-label="Hide Emoticons details"]').attributes("aria-expanded")).toBe("true");
    await wrapper.get('button[aria-label="Pin Emoticons"]').trigger("click");
    expect(localStorage.getItem("stream-overlay.admin.pinned-modules")).toBe('["emoticons"]');
    await wrapper.get('input[aria-label="Search modules"]').setValue("pokemon");
    expect(wrapper.text()).toContain("No modules match your search"); expect((wrapper.get(".module-card").element as HTMLElement).style.display).toBe("none"); wrapper.unmount();
  });

  test("shows a safe actionable server reason and preserves toggle state after a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/session")) return response(session);
      if (init?.method === "PUT") return response({ error: "pds-write-not-authorized", message: "Your ATProto session does not grant access to write these records." }, 400);
      return response(config);
    }));
    const wrapper = mount(CloudAdmin); await flushPromises();
    const toggle = wrapper.get('[aria-label="Enable Emoticons"]'); await toggle.setValue(false); await flushPromises();
    expect((toggle.element as HTMLInputElement).checked).toBe(true); expect(wrapper.text()).toContain("does not grant access to write these records"); expect(wrapper.text()).toContain("last saved configuration is still active"); wrapper.unmount();
  });

  test("keeps ATProto login usable when no public Bluesky profile is available", async () => {
    actorMocks.loadPublicActorProfile.mockRejectedValueOnce(new Error("not indexed"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response(config)));
    const wrapper = mount(CloudAdmin); await flushPromises();
    expect(wrapper.text()).toContain("Profile unavailable"); expect(wrapper.text()).toContain("Signed in with AT Protocol"); expect(wrapper.text()).toContain("Retry profile");
    expect(wrapper.text()).not.toContain(session.did); expect(wrapper.find(".account-profile img").exists()).toBe(false); wrapper.unmount();
  });

  test("keeps a failed PDS read distinct from a genuinely missing configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response({ error: "configuration-unavailable" }, 502)));
    const failed = mount(CloudAdmin); await flushPromises();
    expect(failed.text()).toContain("saved configuration could not be loaded"); expect(failed.text()).toContain("did not replace it with an empty setup"); expect(failed.find(".emoticon-controls").exists()).toBe(false); failed.unmount();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response({ error: "configuration-not-found" }, 404)));
    const missing = mount(CloudAdmin); await flushPromises();
    expect(missing.text()).toContain("No PDS configuration yet"); expect(missing.find(".emoticon-controls").exists()).toBe(true); missing.unmount();
  });
});
