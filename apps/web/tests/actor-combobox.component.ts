import { afterEach, describe, expect, test, vi } from "vitest";
import { attachActorCombobox } from "../src/actor-combobox.ts";

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

type Suggestion = { did:string; handle:string; displayName:string; avatar:string };
function setup(searcher: (query: string, signal: AbortSignal) => Promise<Suggestion[]>) {
  const form = document.createElement("form"); const input = document.createElement("input"); const status = document.createElement("p"); form.append(input); document.body.append(form, status);
  const combobox = attachActorCombobox({ input, status, searcher, delayMs: 0 });
  return { form, input, status, combobox };
}

describe("Cloud Admin actor combobox", () => {
  test.each(["sign-in", "moderation"] as const)("debounces %s typing and cancels pending work on short input or disposal", async purpose => {
    vi.useFakeTimers();
    const input = document.createElement("input"), status = document.createElement("p"), parent = document.createElement("div");
    parent.append(input, status); document.body.append(parent);
    const searcher = vi.fn(async () => []);
    const combobox = attachActorCombobox({ input, status, searcher, purpose });
    function type(value: string) { input.value = value; input.dispatchEvent(new Event("input")); }
    type("al"); await vi.advanceTimersByTimeAsync(200);
    type("alice"); await vi.advanceTimersByTimeAsync(299);
    expect(searcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(searcher).toHaveBeenCalledExactlyOnceWith("alice", expect.any(AbortSignal));
    type("bob"); type("b"); await vi.advanceTimersByTimeAsync(300);
    expect(searcher).toHaveBeenCalledTimes(1);
    type("carol"); combobox.dispose(); await vi.advanceTimersByTimeAsync(300);
    expect(searcher).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('[role="listbox"]')).toBeNull();
  });
  test("renders safe bounded results and supports keyboard selection", async () => {
    const searcher = vi.fn(async (): Promise<Suggestion[]> => [{ did: "did:plc:alice", handle: "alice.test", displayName: "Alice <script>", avatar: "https://cdn.example/alice.jpg" }]);
    const { input, status } = setup(searcher); input.value = "ali"; input.dispatchEvent(new Event("input")); await new Promise(resolve => setTimeout(resolve)); await new Promise(resolve => setTimeout(resolve));
    expect(input.getAttribute("aria-expanded")).toBe("true"); expect(document.body.textContent).toContain("Alice <script>"); expect(document.querySelector("script")).toBeNull();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.value).toBe("alice.test"); expect(status.textContent).toBe("Selected @alice.test");
  });

  test("keeps manual submission available for empty results and aborts stale searches", async () => {
    const signals: AbortSignal[] = []; const searcher = vi.fn(async (_query: string, signal: AbortSignal): Promise<Suggestion[]> => { signals.push(signal); return []; });
    const { input, status } = setup(searcher); input.value = "first"; input.dispatchEvent(new Event("input")); await new Promise(resolve => setTimeout(resolve)); input.value = "second"; input.dispatchEvent(new Event("input")); await new Promise(resolve => setTimeout(resolve)); await new Promise(resolve => setTimeout(resolve));
    expect(signals[0].aborted).toBe(true); expect(status.textContent).toContain("still sign in"); expect(input.value).toBe("second");
  });
});
