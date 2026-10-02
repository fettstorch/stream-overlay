import { Observable } from "@fettstorch/jule";
import type { StreamChatMessage } from "./model.ts";

export function observeStreamChat(url = "/api/chat/events") {
  const messages = new Observable<StreamChatMessage>();
  const events = new EventSource(url);
  events.addEventListener("message", (event) => {
    try {
      messages.emit(JSON.parse(event.data) as StreamChatMessage);
    } catch {
      // Ignore malformed events and keep the shared stream alive.
    }
  });
  return { messages, close: () => events.close() };
}
