import { describe, expect, test } from "bun:test";
import { readSessionCookie, sessionCookie } from "../src/auth.ts";
import { parseConfig, validateMediaUrl } from "../src/pds.ts";
const secret = "a-secret-longer-than-thirty-two-characters";
describe("cloud auth and PDS records", () => {
  test("auth cookie is signed and rejects tampering", async () => { const value = await sessionCookie("did:plc:alice", secret); expect(await readSessionCookie(new Request("https://example.test", { headers: { cookie: `stream_overlay_session=${value}` } }), secret)).toBe("did:plc:alice"); expect(await readSessionCookie(new Request("https://example.test", { headers: { cookie: `stream_overlay_session=${value}x` } }), secret)).toBeUndefined(); });
  test("parses command records and converts storage units", () => { const namespace="invalid.streamoverlay.dev"; const result=parseConfig({$type:`${namespace}.settings`,enabled:true,streamerDid:"did:plc:alice",updatedAt:"v1"},[{$type:`${namespace}.command`,id:"one",command:"wave",mode:"effect",durationMilliseconds:1500,cooldownSeconds:20,volumePercent:55,width:"",height:"",mirrored:false}],namespace); expect(result?.commands[0].durationSeconds).toBe(1.5); expect(result?.commands[0].volume).toBe(.55); });
  test("only accepts HTTPS direct URL candidates", () => { expect(validateMediaUrl("https://cdn.example/clip.mp4")).toBe("https://cdn.example/clip.mp4"); expect(validateMediaUrl("http://cdn.example/clip.mp4")).toBeUndefined(); });
});
