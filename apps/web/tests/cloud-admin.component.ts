import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudAdmin from "../src/CloudAdmin.vue";

const actorMocks = vi.hoisted(() => ({
  loadPublicActorProfile: vi.fn(async () => ({ did: "did:plc:alice", handle: "alice.bsky.social", displayName: "Alice", avatar: "https://cdn.example/alice.jpg" })),
  searchPublicActors: vi.fn(async () => []),
}));
vi.mock("../src/actor-search.ts", () => actorMocks);

afterEach(() => { vi.unstubAllGlobals(); actorMocks.loadPublicActorProfile.mockReset(); actorMocks.loadPublicActorProfile.mockResolvedValue({ did: "did:plc:alice", handle: "alice.bsky.social", displayName: "Alice", avatar: "https://cdn.example/alice.jpg" }); });
const session = { did: "did:plc:alice" };
const config = { enabled: true, streamerDid: session.did, revision: "1", commands: [{ id: "wave", command: "wave", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false, image: { url: "https://cdn.example/wave.gif" } }] };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("Cloud Admin", () => {
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
    await wrapper.get(".emoticon-controls .primary-button").trigger("click");
    expect(wrapper.text()).toContain("Create command"); expect(wrapper.text()).toContain("Media — drop files or choose");
    wrapper.unmount();
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
