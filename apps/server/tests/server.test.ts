import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDependencies, handleRequest } from "../src/server.ts";
import { sessionCookie } from "../src/auth.ts";
import { CloudConfigMissingError } from "../src/pds.ts";
import { StructuredLogger } from "../src/logger.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function webRoot() {
  const root = mkdtempSync(join(tmpdir(), "stream-overlay-web-"));
  roots.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<h1>Admin</h1>");
  writeFileSync(join(root, "cloud-admin.html"), "<h1>Admin</h1>");
  writeFileSync(join(root, "assets/app.js"), "console.log('ready')");
  return root;
}

describe("cloud server boundary", () => {
  function dependencies(webRoot: string) { const deps = createDependencies({ PUBLIC_ORIGIN: "https://overlay.example", SESSION_SECRET: "test-secret-with-at-least-thirty-two-bytes", LEXICON_NAMESPACE:"com.example.streamoverlay", AUTH_DATA_DIR: join(webRoot, "auth") }); return { ...deps, webRoot, logger: new StructuredLogger(undefined, () => {}) }; }
  test("reports health without reading web files", async () => {
    const response = await handleRequest(new Request("http://localhost/health"), dependencies("/missing"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("serves the built web application under its stable admin path", async () => {
    const root = webRoot();
    const index = await handleRequest(new Request("http://localhost/admin/"), dependencies(root));
    const asset = await handleRequest(new Request("http://localhost/admin/assets/app.js"), dependencies(root));
    expect(await index.text()).toBe("<h1>Admin</h1>");
    expect(await asset.text()).toContain("ready");
  });

  test("does not expose files outside the built web directory", async () => {
    const root = webRoot(); const response = await handleRequest(new Request("http://localhost/other"), dependencies(root));
    expect(response.status).toBe(404);
  });

  test("rejects cross-origin authenticated writes before touching the PDS", async () => { const root=webRoot();const deps=dependencies(root);let saved=false;(deps as any).pds={save:async()=>{saved=true}};const cookie=await sessionCookie("did:plc:alice",deps.secret);const response=await handleRequest(new Request("https://overlay.example/api/accounts/did:plc:alice/config",{method:"PUT",headers:{origin:"https://evil.example",cookie:`stream_overlay_session=${cookie}`,"content-type":"application/json"},body:JSON.stringify({enabled:true,streamerDid:"did:plc:alice",commands:[]})}),deps);expect(response.status).toBe(403);expect(saved).toBe(false); });

  test("accepts localhost and 127.0.0.1 as the same local write origin", async () => {
    const root=webRoot(); const deps=createDependencies({PUBLIC_ORIGIN:"http://127.0.0.1:3010",SESSION_SECRET:"test-secret-with-at-least-thirty-two-bytes",LEXICON_NAMESPACE:"com.example.streamoverlay",AUTH_DATA_DIR:join(root,"auth")});
    (deps as any).pds={save:async(_did:string,body:unknown)=>body}; const cookie=await sessionCookie("did:plc:alice",deps.secret);
    const response=await handleRequest(new Request("http://localhost:3010/api/accounts/did:plc:alice/config",{method:"PUT",headers:{origin:"http://localhost:3010",cookie:`stream_overlay_session=${cookie}`,"content-type":"application/json"},body:JSON.stringify({enabled:false,streamerDid:"did:plc:alice",revision:"old",commands:[]})}),deps);
    expect(response.status).toBe(200); expect((await response.json()).enabled).toBe(false);
  });

  test("returns sanitized actionable PDS save failures", async () => {
    const root=webRoot(); const deps=dependencies(root); (deps as any).pds={save:async()=>{throw Object.assign(new Error("token rejected: secret detail"),{status:403,error:"Forbidden"})}}; const cookie=await sessionCookie("did:plc:alice",deps.secret);
    const response=await handleRequest(new Request("https://overlay.example/api/accounts/did:plc:alice/config",{method:"PUT",headers:{origin:"https://overlay.example",cookie:`stream_overlay_session=${cookie}`,"content-type":"application/json"},body:JSON.stringify({enabled:false,streamerDid:"did:plc:alice",commands:[]})}),deps);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({error:"pds-write-not-authorized",message:"Your ATProto session does not grant access to write these records.",requestId:expect.any(String)}); expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  });

  test("returns sanitized actionable media upload failures", async () => {
    const root=webRoot(); const deps=dependencies(root); (deps as any).pds={upload:async()=>{throw Object.assign(new Error("token secret rejected"),{status:403,error:"Forbidden"})}}; const cookie=await sessionCookie("did:plc:alice",deps.secret);
    const response=await handleRequest(new Request("https://overlay.example/api/accounts/did:plc:alice/media",{method:"POST",headers:{origin:"https://overlay.example",cookie:`stream_overlay_session=${cookie}`,"content-type":"image/gif"},body:new Uint8Array([1,2,3])}),deps);
    expect(response.status).toBe(403); expect(await response.json()).toEqual({error:"pds-upload-not-authorized",message:"Your ATProto session cannot upload media. Sign in again to grant media access.",requestId:expect.any(String)});
  });

  test("correlates upload ingress, body read, failure, and response without logging credentials", async () => {
    const root=webRoot(), lines:string[]=[]; const deps=dependencies(root); deps.logger=new StructuredLogger(undefined,line=>lines.push(line)); (deps as any).pds={upload:async()=>{throw Object.assign(new Error("Bearer super-secret-token"),{status:403,error:"Forbidden"})}}; const cookie=await sessionCookie("did:plc:alice",deps.secret);
    const response=await handleRequest(new Request("https://overlay.example/api/accounts/did:plc:alice/media?code=oauth-secret",{method:"POST",headers:{origin:"https://overlay.example",cookie:`stream_overlay_session=${cookie}`,authorization:"Bearer hidden","content-type":"image/gif"},body:new Uint8Array([1,2,3])}),deps); const requestId=response.headers.get("x-request-id")!; const events=lines.map(line=>JSON.parse(line));
    expect(events.filter(entry=>entry.requestId===requestId).map(entry=>entry.event)).toEqual(["cloud.http.request-received","cloud.upload.request-received","cloud.upload.body-read-started","cloud.upload.body-read-completed","cloud.upload.request-failed","cloud.http.request-completed"]); expect(lines.join("\n")).not.toContain("super-secret"); expect(lines.join("\n")).not.toContain("oauth-secret"); expect(lines.join("\n")).not.toContain(cookie);
  });

  test("distinguishes a missing cloud configuration from an unavailable PDS", async () => {
    const root = webRoot(); const deps = dependencies(root);
    (deps as any).pds = { publicConfig: async () => { throw new CloudConfigMissingError(); } };
    const missing = await handleRequest(new Request("https://overlay.example/api/accounts/did:plc:alice/config"), deps);
    expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: "configuration-not-found" });
    (deps as any).pds = { publicConfig: async () => { throw new Error("offline"); } };
    const unavailable = await handleRequest(new Request("https://overlay.example/api/accounts/did:plc:alice/config"), deps);
    expect(unavailable.status).toBe(502); expect(await unavailable.json()).toEqual({ error: "configuration-unavailable" });
  });

  test("separates local defaults from deploy configuration and keeps origin aligned with PORT", () => { expect(createDependencies({}).origin).toBe("http://127.0.0.1:3010"); expect(createDependencies({PORT:"4567"}).origin).toBe("http://127.0.0.1:4567"); expect(()=>createDependencies({PUBLIC_ORIGIN:"https://overlay.example",SESSION_SECRET:"test-secret-with-at-least-thirty-two-bytes"})).toThrow("LEXICON_NAMESPACE"); });
});
