import { afterEach, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ChatComposer from "../src/CrystalChatTest.vue";

afterEach(() => vi.unstubAllGlobals());

test("chat composer sends through the existing owner endpoint and clears after success", async () => {
  const fetcher = vi.fn(async () => Response.json({ sent: true }));
  vi.stubGlobal("fetch", fetcher);
  const wrapper = mount(ChatComposer, { props: { did: "did:plc:owner", purpose: "chat" } });
  try {
    expect(wrapper.text()).not.toContain("Pokémon");
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get("input").setValue("Hello from the preview");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/accounts/did%3Aplc%3Aowner/chat/message",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Hello from the preview" }),
      }),
    );
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("");
    expect(wrapper.get('[role="status"]').text()).toContain("Message sent");
  } finally {
    wrapper.unmount();
  }
});

test("chat permission failure preserves the draft and offers chat authorization", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error: "chat-permission-required",
          message: "Sign in again to allow chat.",
        },
        { status: 403 },
      ),
    ),
  );
  const wrapper = mount(ChatComposer, { props: { did: "did:plc:owner", purpose: "chat" } });
  try {
    await wrapper.get("input").setValue("Keep this draft");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("Keep this draft");
    expect(wrapper.get('[role="status"]').text()).toBe("Sign in again to allow chat.");
    expect(wrapper.get("a").text()).toBe("Authorize chat");
    expect(wrapper.get("a").attributes("href")).toBe("/oauth/login?handle=did%3Aplc%3Aowner");
  } finally {
    wrapper.unmount();
  }
});
