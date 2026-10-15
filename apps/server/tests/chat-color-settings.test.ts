import { expect, test } from "bun:test";
import { parseModuleRecords, serializeModuleRecords } from "../src/module-records.ts";
import {
  defaultChatConfiguration,
  parseChatConfiguration,
} from "../../../modules/chat/src/config.ts";

test("chat color preference round-trips through PDS records and defaults off for old records", () => {
  const did = "did:plc:chatcolor";
  const config = parseModuleRecords(did, []);
  const records = serializeModuleRecords(
    { ...config, chat: { ...defaultChatConfiguration, respectUserChatColor: true } },
    [],
    "2026-10-15T12:00:00Z",
  );
  expect(parseModuleRecords(did, records).chat?.respectUserChatColor).toBe(true);
  const chat = records.find((record) => record.collection === "live.streamface.chat.settings")!;
  delete chat.value.respectUserChatColor;
  expect(parseModuleRecords(did, records).chat?.respectUserChatColor).toBe(false);
  expect(parseChatConfiguration({ fadeOut: 0, respectUserChatColor: "yes" })).toBeNull();
});
