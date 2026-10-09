---
name: debug
description: Debug a failing stream-overlay flow from actual runtime logs. Inspect existing logs first, add missing structured instrumentation and an accessible sink, then reproduce and diagnose from the captured evidence. Use when asked to debug a failure or investigate why a feature does not work.
---

# Evidence-first debugging

Work directly on the requested flow. Do not delegate unless the user explicitly asks for delegation. Follow the repository's AGENTS.md and GitButler guidance for edits and commits.

## 1. Read the actual logs

- Identify the runtime the user is using: local host, direct `cloud:dev`, or container. Verify its running build, origin, and relevant configuration without exposing secrets.
- Locate its existing log sink and inspect the relevant time window. Search a supplied request/reference ID first, then follow related events across the flow.
- Local host logging lives in `apps/local/src/logger.ts`; use the file location printed at startup. Cloud logging lives in `apps/server/src/logger.ts`: direct local development writes JSONL to stdout and `join(tmpdir(), "stream-overlay", "cloud.log")`; read the startup event's `logFile` field for its absolute path. Production containers default to stdout, available through service logs. `CLOUD_LOG_FILE` overrides the file destination when set.
- A logger in the source tree is not evidence that this flow is instrumented or that the running process is emitting accessible logs. Old files, another process's logs, and mocked test output are not the user's failure trace.

## 2. Fill gaps before guessing

If logs are absent, inaccessible, or stop short of the failing boundary, make the app produce useful logs using its existing logging mechanism. Do not ask the user to repeatedly retry an unobservable flow.

- Make the sink readable by the agent. For direct local development, inspect the default temporary log file even if terminal scrollback is inaccessible. Use `CLOUD_LOG_FILE` for an explicit alternative when needed. For hosted containers, inspect platform-collected stdout; do not rely on their ephemeral filesystem for durable logs. Do not create another logging framework.
- Instrument the smallest missing portion: action received, validation/auth decision, dispatch, downstream receipt, runtime acceptance/rejection with reason, and completion/failure as relevant. Include bounded status codes, identifiers, and counts; never media contents, credentials, cookies, OAuth data, or entire request/error objects.
- Carry one request/operation ID across HTTP, relay, and browser stages. A server saying “sent” does not prove the browser received, accepted, or played the command. Browser-only console output is insufficient when that browser is inaccessible: expose the needed bounded diagnostics through the existing logging/relay architecture, with appropriate validation and limits.
- Record rejection reasons as well as exceptions. Disabled modules, missing connections, cooldowns, queues, stale configuration, and failed media playback can prevent an action without throwing.
- Do not log heartbeats or animation ticks. Add targeted checks for the instrumentation and keep useful logs after the fix.
- Confirm the instrumentation is active in the actual process. If a rebuild/restart is needed, follow the user's existing server/browser-control constraints; do not kill their process or silently start a competing instance. If required access or authorization is unavailable, state the exact blocker.

## 3. Reproduce, then reason from evidence

Reproduce the failing action under the user's actual configuration, using the real UI/network URL shape where relevant. Use a safe local fixture when reproduction would otherwise mutate an external account without authorization. If user interaction is necessary, request one specific retry only after logging is ready.

Read the resulting logs immediately. Establish the last successful stage and the first failing or missing stage. For a missing event, verify the consumer was connected and the event would actually be emitted before treating its absence as proof.

Separate observed facts from hypotheses. Use the trace to narrow code inspection and confirm the cause; do not change MIME types, OAuth scopes, timeouts, or other adjacent behavior merely because they could explain the symptom. If the evidence is still insufficient, return to step 2 and capture the missing boundary.

## 4. Fix and verify when requested

For a fix request, implement the confirmed correction and replay the same flow. For a diagnosis-only request, explain the cause without changing behavior; the instrumentation above remains part of this debugging workflow.

Verify both the observable outcome and the correlated success trace. Keep regression tests for the actual failing boundary. Passing mocks, a successful build, or a transport delivery count alone do not establish end-to-end success.

Finish with a concise report: cause, trace evidence (IDs/stages and log location), change if any, and what was genuinely verified. If the actual runtime cannot be verified, explicitly say so rather than calling the issue fixed.
