import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CloudAdmin from "../src/CloudAdmin.vue";

afterEach(() => vi.unstubAllGlobals());
const session = { did: "did:plc:alice" };
const config = { enabled: true, streamerDid: session.did, revision: "1", commands: [{ id: "wave", command: "wave", mode: "effect", durationSeconds: 5, cooldownSeconds: 20, volume: 1, width: "", height: "", mirrored: false, image: { url: "https://cdn.example/wave.gif" } }] };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("Cloud Admin", () => {
  test("renders the established control-room module and command editor for saved PDS data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response(config)));
    const wrapper = mount(CloudAdmin, { attachTo: document.body }); await flushPromises();
    expect(wrapper.text()).toContain("Control room"); expect(wrapper.text()).toContain("Emoticons"); expect(wrapper.text()).toContain("!wave");
    expect(wrapper.find('[aria-label="Enable Emoticons"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Copy Emoticons effects OBS URL"]').exists()).toBe(true);
    await wrapper.get(".emoticon-controls .primary-button").trigger("click");
    expect(wrapper.text()).toContain("Create command"); expect(wrapper.text()).toContain("Media — drop files or choose");
    wrapper.unmount();
  });

  test("keeps a failed PDS read distinct from a genuinely missing configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response({ error: "configuration-unavailable" }, 502)));
    const failed = mount(CloudAdmin); await flushPromises();
    expect(failed.text()).toContain("saved configuration could not be loaded"); expect(failed.text()).toContain("did not replace it with an empty setup"); expect(failed.find(".emoticon-controls").exists()).toBe(false); failed.unmount();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/api/session") ? response(session) : response({ error: "configuration-not-found" }, 404)));
    const missing = mount(CloudAdmin); await flushPromises();
    expect(missing.text()).toContain("No cloud configuration yet"); expect(missing.find(".emoticon-controls").exists()).toBe(true); missing.unmount();
  });
});
