import { afterEach, expect, test, vi } from "vitest";
import { adminFetch } from "../src/cloud-admin-fetch.ts";

afterEach(() => vi.unstubAllGlobals());

test("session expiry notifies admin without consuming the caller's response", async () => {
  const expired = vi.fn();
  window.addEventListener("cloud-session-expired", expired);
  try {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "session-expired", message: "Sign in again" }, { status: 401 })));
    const response = await adminFetch("/api/accounts/did:plc:alice/media", { method: "POST" });
    expect(expired).toHaveBeenCalledOnce();
    expect((await response.json()).error).toBe("session-expired");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "forbidden" }, { status: 403 })));
    await adminFetch("/api/accounts/did:plc:alice/media");
    expect(expired).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("cloud-session-expired", expired);
  }
});
