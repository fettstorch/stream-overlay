import { createEmotePlayer } from "./emote-player.ts";
import type { SharedOverlayRuntime } from "./shared-overlay-runtime.ts";

import { EmoticonRuntime } from "@streamface/emoticons/src/runtime.ts";
import { createRoleAuthorizer } from "../../../modules/emoticons/src/roles.ts";
import { formatEventText } from "../../../modules/emoticons/src/events.ts";
import type {
  EmoticonCommand,
  EmoticonEvent,
  EmoticonState,
} from "@streamface/emoticons/src/contracts.ts";
import type { RelaySnapshot, EffectDiagnostic } from "@streamface/protocol";
import { createCloudBoard } from "./cloud-board.ts";
import { createStickerAssetCache } from "../../../modules/emoticons/src/asset-cache.ts";
import { createGiphyPreloader } from "./giphy.ts";

export function mountEmotes(container: HTMLElement, host: SharedOverlayRuntime, boardMode = false) {
  const did = host.did,
    channel = host.preview ? "preview" : "live";
  const relay = { send: host.send };
  let disposed = false;
  let releaseChat: (() => void) | undefined;
  let config: EmoticonState = { enabled: false, commands: [], assets: [] };
  let cooldowns: RelaySnapshot["cooldowns"] = {};
  let revision = 0;
  const testRequests = new Map<string, string>();
  let cooldownRequestId: string | undefined;
  const board = boardMode ? createCloudBoard(container) : undefined;
  const effectAssets = createStickerAssetCache();
  const giphyAssets = createGiphyPreloader();
  let preloadedGiphyIds = new Set<string>();
  let preloadedSources = new Set<string>();
  const player = createEmotePlayer(container, diagnostic, effectAssets, giphyAssets);
  let rejectionReason: string | undefined;
  const moderationLogTimes = new Map<string, number>();
  function moderationDiagnostic(
    event: "moderation-accepted" | "moderation-rejected",
    details: Omit<EffectDiagnostic, "type" | "event">,
  ) {
    const key = `${event}:${details.reason ?? "accepted"}`;
    const now = Date.now();
    // Chat spam must not itself flood the relay or the log sink.
    if (now - (moderationLogTimes.get(key) ?? -Infinity) < 5000) return;
    moderationLogTimes.set(key, now);
    diagnostic(event, details);
  }
  function diagnostic(
    event: EffectDiagnostic["event"],
    details: Omit<EffectDiagnostic, "type" | "event"> = {},
  ) {
    if (disposed) return;
    relay.send({ type: "diagnostic", event, ...details });
  }
  function renderBoard() {
    board?.render({ ...config, cooldowns });
  }
  function play(event: Extract<EmoticonEvent, { type: "effect" }>) {
    const requestId = testRequests.get(event.command.id);
    testRequests.delete(event.command.id);
    return player.play(event, requestId);
  }
  function nextRevision() {
    revision = Math.max(revision + 1, Date.now());
    return revision;
  }
  const authorize = createRoleAuthorizer();
  const runtime = boardMode
    ? undefined
    : new EmoticonRuntime({
        effect: play,
        authorize: (author, roles) => authorize(did, author, roles),
        log: (event, details) => {
          if (event === "emoticons.command-rejected") {
            rejectionReason = String(details?.reason ?? "unknown");
            if (
              ["user-blocked", "user-cooldown", "role-not-allowed", "role-lookup-failed"].includes(
                rejectionReason,
              )
            )
              moderationDiagnostic("moderation-rejected", {
                commandId: String(details?.commandId),
                reason: rejectionReason,
              });
          }
          if (event === "emoticons.moderation-accepted")
            moderationDiagnostic("moderation-accepted", { commandId: String(details?.commandId) });
        },
        cooldowns: (state) => {
          cooldowns = state;
          relay.send({
            type: "cooldowns",
            revision: nextRevision(),
            cooldowns: state,
            requestId: cooldownRequestId,
          });
        },
      });
  const chat = boardMode ? undefined : host.chat;
  const unsubscribeMessages = chat?.messages.subscribe((message) =>
    runtime?.message(message.id, message.text, message.author),
  );
  let eventMappings: import("../../../modules/emoticons/src/events.ts").EmoteEventMapping[] = [];
  const unsubscribeEvents = chat?.events.subscribe((event) => {
    if (!runtime) return;
    const mapping = eventMappings.find((mapping) => mapping.event === event.type);
    if (!mapping) return;
    rejectionReason = undefined;
    const accepted = runtime.trigger(
      mapping.commandId,
      "stream-event",
      event.id,
      event.author,
      false,
      formatEventText(mapping.text, event),
    );
    diagnostic(accepted ? "event-accepted" : "event-rejected", {
      commandId: mapping.commandId,
      reason: `event-${event.type}-${accepted ? "accepted" : (rejectionReason ?? "rejected")}`,
    });
  });
  function configure(cloud: import("./cloud-admin-types.ts").CloudConfig) {
    try {
      const commands: EmoticonCommand[] = cloud.commands.map((command) => ({
        ...command,
        imageAssetId: null,
        audioAssetId: null,
        videoAssetId: null,
        imageUrl: command.image?.url,
        imageGiphyId: command.image?.giphyId,
        audioUrl: command.audio?.url,
        videoUrl: command.video?.url,
      }));
      const giphyIds = new Set(
        commands.flatMap((command) => (command.imageGiphyId ? [command.imageGiphyId] : [])),
      );
      giphyAssets.retain(giphyIds);
      preloadedGiphyIds = new Set([...preloadedGiphyIds].filter((id) => giphyIds.has(id)));
      for (const command of commands)
        if (command.imageGiphyId) {
          const id = command.imageGiphyId;
          void giphyAssets
            .load(command.imageGiphyId)
            .then((url) => {
              command.imageUrl = url;
              if (!boardMode && !preloadedGiphyIds.has(id)) {
                preloadedGiphyIds.add(id);
                diagnostic("media-loaded", {
                  commandId: command.id,
                  reason: "giphy-preload-ready",
                });
              }
              if (config.commands === commands) renderBoard();
            })
            .catch(() => {
              if (!boardMode)
                diagnostic("media-failed", {
                  commandId: command.id,
                  reason: "giphy-preload-failed",
                });
            });
        }
      if (!boardMode) {
        const sources = new Set(
          commands.flatMap((command) =>
            [
              command.imageGiphyId ? undefined : command.imageUrl,
              command.videoUrl,
              command.audioUrl,
            ].filter((source): source is string => Boolean(source)),
          ),
        );
        effectAssets.retain(sources);
        for (const source of sources)
          if (!preloadedSources.has(source)) {
            preloadedSources.add(source);
            const started = performance.now();
            void effectAssets
              .load(source)
              .then(() => {
                diagnostic("media-loaded", {
                  reason: `preload-ready-${Math.round(performance.now() - started)}ms`,
                });
              })
              .catch(() => {
                preloadedSources.delete(source);
                diagnostic("media-failed", { reason: "preload-download-failed" });
              });
          }
        preloadedSources = new Set([...preloadedSources].filter((source) => sources.has(source)));
      }
      config = {
        enabled: cloud.enabled,
        commands,
        assets: [],
        cooldowns,
        moderation: cloud.moderation,
        roles: cloud.roles,
      };
      eventMappings = cloud.eventMappings ?? [];
      runtime?.configure(config);
      if (!cloud.enabled) player.clear();
      if (cloud.enabled && chat && !releaseChat) releaseChat = host.acquireChat("emoticons");
      if (!cloud.enabled) {
        releaseChat?.();
        releaseChat = undefined;
      }
      renderBoard();
      if (!boardMode)
        diagnostic("config-loaded", {
          count: commands.length,
          reason: cloud.enabled ? "enabled" : "disabled",
        });
    } catch {
      if (!boardMode) diagnostic("config-failed", { reason: "fetch-or-parse-error" });
    }
  }
  const stopRelay = host.listen(
    (message) => {
      if (message.type === "snapshot" && message.revision >= revision) {
        revision = message.revision;
        cooldowns = message.cooldowns;
        runtime?.configure({ ...config, cooldowns });
        renderBoard();
        if (boardMode)
          diagnostic("cooldowns-received", {
            requestId: message.requestId,
            count: Object.keys(cooldowns).length,
          });
      }

      // Tests use the same browser-owned runtime and cooldowns as chat commands.
      if (message.type === "test-command" && runtime) {
        diagnostic("test-received", {
          requestId: message.requestId,
          commandId: message.commandId,
          reason: new URLSearchParams(location.search).has("only")
            ? "isolated-preview"
            : "shared-overlay",
        });
        testRequests.set(message.commandId, message.requestId);
        rejectionReason = undefined;
        cooldownRequestId = message.requestId;
        const accepted = message.eventId
          ? runtime.trigger(
              message.commandId,
              "stream-event",
              message.requestId,
              undefined,
              false,
              formatEventText(message.eventText, {
                type: message.eventId,
                author: { displayName: "Example streamer" },
                viewerCount: 42,
              }),
            )
          : runtime.trigger(message.commandId);
        cooldownRequestId = undefined;
        diagnostic(accepted ? "test-accepted" : "test-rejected", {
          requestId: message.requestId,
          commandId: message.commandId,
          reason: accepted ? undefined : rejectionReason,
        });
        if (!accepted) testRequests.delete(message.commandId);
      }
    },
    () => {
      if (!boardMode) relay.send({ type: "cooldowns", revision: nextRevision(), cooldowns });
    },
  );
  const stopConfig = host.subscribe(configure);
  return () => {
    disposed = true;
    stopConfig();
    stopRelay();
    unsubscribeMessages?.();
    unsubscribeEvents?.();
    releaseChat?.();
    runtime?.clear();
    player.clear();
    effectAssets.clear();
    giphyAssets.clear();
    board?.close();
  };
}
