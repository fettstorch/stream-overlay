import { defaultChatConfiguration, parseChatConfiguration, type ChatConfiguration } from "../../../modules/chat/src/config.ts";
import { defaultPaintConfiguration, parsePaintConfiguration, type PaintConfiguration } from "../../../modules/overlay-paint/src/config.ts";

export type CloudModuleSettings = {
  modules?: { chat: boolean; paint: boolean; pets: boolean };
  chat?: ChatConfiguration;
  paint?: PaintConfiguration;
};
export function moduleSettings(value: CloudModuleSettings) {
  const modules = value.modules ?? { chat: true, paint: true, pets: true };
  if ([modules.chat, modules.paint, modules.pets].some(enabled => typeof enabled !== "boolean")) throw new Error("Invalid module settings");
  const chat = parseChatConfiguration(value.chat ?? defaultChatConfiguration);
  const paint = parsePaintConfiguration(value.paint ?? defaultPaintConfiguration);
  if (!chat || !paint) throw new Error("Invalid appearance settings");
  return { modules: { ...modules }, chat, paint };
}
