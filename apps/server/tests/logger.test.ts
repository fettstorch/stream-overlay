import { describe, expect, test } from "bun:test";
import { StructuredLogger, safeError } from "../src/logger.ts";

describe("cloud structured logger", () => {
  test("identifies missing Streamface schemas without logging upstream payloads", () => {
    expect(safeError({ status: 400, error: "InvalidRequest", message: "Unknown lexicon type: live.streamface.chat.settings" })).toEqual({ upstreamStatus: 400, upstreamCode: "InvalidRequest", upstreamReason: "lexicon-not-found", lexicon: "live.streamface.chat.settings" });
    expect(safeError({ status: 400, error: "InvalidRequest", message: "Lexicon not found: lex:live.streamface.chat.settings" })).toEqual({ upstreamStatus: 400, upstreamCode: "InvalidRequest", upstreamReason: "lexicon-not-found", lexicon: "live.streamface.chat.settings" });
    expect(safeError({ status: 400, error: "InvalidRequest", message: "Private record contents: secret" })).toEqual({ upstreamStatus: 400, upstreamCode: "InvalidRequest" });
  });
  test("emits JSONL while redacting credential-shaped fields and values", () => { const lines:string[]=[]; const logger=new StructuredLogger(undefined,line=>lines.push(line)); logger.log("error","cloud.test",{requestId:"request-1",cookie:"session-secret",authorization:"Bearer secret",nested:{accessToken:"token-secret",safe:"visible"}}); const entry=JSON.parse(lines[0]); expect(entry.event).toBe("cloud.test"); expect(entry.cookie).toBe("[redacted]"); expect(entry.authorization).toBe("[redacted]"); expect(entry.nested.accessToken).toBe("[redacted]"); expect(entry.nested.safe).toBe("visible"); expect(lines[0]).not.toContain("session-secret"); });
  test("keeps only bounded upstream status and code", () => { expect(safeError(Object.assign(new Error("Bearer private"),{status:403,error:"Forbidden"}))).toEqual({upstreamStatus:403,upstreamCode:"Forbidden"}); expect(safeError({status:500,error:"secret detail with spaces"})).toEqual({upstreamStatus:500,upstreamCode:"UnknownError"}); });
});
