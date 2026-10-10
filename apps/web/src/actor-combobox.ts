import { getDebouncer } from "@fettstorch/jule";

export type ActorSuggestion = { did: string; handle: string; displayName: string; avatar: string };

type Options = {
  input: HTMLInputElement;
  status: HTMLElement;
  searcher: (query: string, signal: AbortSignal) => Promise<ActorSuggestion[]>;
  delayMs?: number;
  onSelect?: (actor: ActorSuggestion) => void;
  purpose?: "sign-in" | "moderation";
};

export function attachActorCombobox({ input, status, searcher, delayMs = 300, onSelect, purpose = "sign-in" }: Options) {
  const list = document.createElement("div");
  list.id = `actor-suggestions-${crypto.randomUUID()}`;
  list.className = "actor-suggestions";
  list.role = "listbox";
  list.hidden = true;
  input.parentElement!.append(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  let results: ActorSuggestion[] = [];
  let active = -1;
  const searchDebouncer = getDebouncer();
  let controller: AbortController | undefined;
  let sequence = 0;

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function activate(index: number) {
    if (!results.length) return;
    active = (index + results.length) % results.length;
    const options = list.querySelectorAll<HTMLElement>("[role=option]");
    options.forEach((option, optionIndex) => option.setAttribute("aria-selected", String(optionIndex === active)));
    input.setAttribute("aria-activedescendant", options[active].id);
    options[active].scrollIntoView?.({ block: "nearest" });
  }

  function select(actor: ActorSuggestion) {
    input.value = actor.handle;
    close();
    status.textContent = `Selected @${actor.handle}`;
    input.focus();
    onSelect?.(actor);
  }

  function render(actors: ActorSuggestion[]) {
    results = actors;
    list.replaceChildren();
    for (const [index, actor] of actors.entries()) {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${list.id}-${index}`;
      option.role = "option";
      option.setAttribute("aria-selected", "false");
      if (actor.avatar) { const avatar = new Image(); avatar.src = actor.avatar; avatar.alt = ""; option.append(avatar); }
      else { const placeholder = document.createElement("span"); placeholder.className = "avatar-placeholder"; placeholder.ariaHidden = "true"; option.append(placeholder); }
      const text = document.createElement("span");
      const name = document.createElement("strong"); name.textContent = actor.displayName || actor.handle;
      const handle = document.createElement("small"); handle.textContent = `@${actor.handle}`;
      text.append(name, handle); option.append(text);
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => select(actor));
      list.append(option);
    }
    list.hidden = actors.length === 0;
    input.setAttribute("aria-expanded", String(actors.length > 0));
  }

  async function search(query: string, requestSequence: number) {
    controller?.abort(); controller = new AbortController();
    status.textContent = "Searching Bluesky…";
    try {
      const body = await searcher(query, controller.signal);
      if (requestSequence !== sequence) return;
      const actors = Array.isArray(body) ? body.slice(0, 6) : [];
      render(actors);
      status.textContent = actors.length ? `${actors.length} Bluesky profile${actors.length === 1 ? "" : "s"} found.` : purpose === "moderation" ? "No profiles found. Enter the exact handle to resolve the account." : "No Bluesky profiles found. You can still sign in with this handle.";
    } catch (error) {
      if (requestSequence !== sequence || (error instanceof DOMException && error.name === "AbortError")) return;
      render([]);
      status.textContent = purpose === "moderation" ? "Search is unavailable. Enter the exact handle to resolve the account." : "Bluesky search is unavailable. You can still sign in with this handle.";
    }
  }

  function queueSearch() {
    searchDebouncer.clear(); controller?.abort(); const requestSequence = ++sequence;
    const query = input.value.trim().replace(/^@/, "");
    if (query.length < 2) { results = []; list.replaceChildren(); close(); status.textContent = ""; return; }
    status.textContent = "Waiting to search…";
    searchDebouncer.debounce(() => void search(query, requestSequence), delayMs);
  }

  input.addEventListener("input", queueSearch);
  input.addEventListener("focus", () => { if (results.length) { list.hidden = false; input.setAttribute("aria-expanded", "true"); } });
  input.addEventListener("blur", () => setTimeout(close));
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" && results.length) { event.preventDefault(); if (list.hidden) { list.hidden = false; input.setAttribute("aria-expanded", "true"); } activate(active + 1); }
    else if (event.key === "ArrowUp" && results.length) { event.preventDefault(); activate(active < 0 ? results.length - 1 : active - 1); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); select(results[active]); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  });

  return { close, dispose() { searchDebouncer.clear(); sequence++; controller?.abort(); list.remove(); } };
}
