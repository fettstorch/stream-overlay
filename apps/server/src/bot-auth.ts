import { Agent, CredentialSession } from "@atproto/api";
import { StructuredLogger } from "./logger.ts";

export const streamfaceBotDid = "did:plc:j66wyknizjxecbnrenjzj7l3";

/** Dedicated service account only. User accounts continue to use OAuth. */
export class BotAuth {
  private readonly session: CredentialSession;
  private readonly agent: Agent;
  private pending?: Promise<Agent>;
  private retryAt = 0;
  private stopped = false;

  constructor(
    private readonly options: {
      identifier: string;
      appPassword: string;
      service: string;
      expectedDid: string;
    },
    private readonly logger: StructuredLogger,
    private readonly now = Date.now,
    fetcher: typeof fetch = fetch,
  ) {
    const service = new URL(options.service);
    if (
      service.protocol !== "https:" ||
      service.username ||
      service.password ||
      service.search ||
      service.hash
    )
      throw new Error(
        "BOT_PDS must be an HTTPS service URL without credentials or query parameters",
      );
    const boundedFetch: typeof fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        fetcher(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        }),
      { preconnect: fetcher.preconnect },
    );
    this.session = new CredentialSession(service, boundedFetch);
    this.agent = new Agent(this.session);
  }

  start() {
    void this.getAgent().catch(() => {});
  }

  getAgent(): Promise<Agent> {
    if (this.stopped) return Promise.reject(new Error("Bot authentication stopped"));
    // The SDK refreshes expiring access tokens when making authenticated requests.
    if (this.session.hasSession) return Promise.resolve(this.agent);
    if (this.pending) return this.pending;
    if (this.now() < this.retryAt)
      return Promise.reject(new Error("Bot login temporarily unavailable"));
    const operationId = crypto.randomUUID();
    this.logger.log("info", "cloud.bot.login-started", { operationId });
    this.pending = this.session
      .login({ identifier: this.options.identifier, password: this.options.appPassword })
      .then(() => {
        if (this.stopped) {
          this.session.session = undefined;
          throw new Error("Bot authentication stopped");
        }
        if (this.session.did !== this.options.expectedDid) {
          this.session.session = undefined;
          throw new Error("Bot account identity mismatch");
        }
        this.retryAt = 0;
        this.logger.log("info", "cloud.bot.login-completed", {
          operationId,
          did: this.options.expectedDid,
        });
        return this.agent;
      })
      .catch(() => {
        this.session.session = undefined;
        this.retryAt = this.now() + 60_000;
        this.logger.log("warn", "cloud.bot.login-failed", { operationId, retryAfterSeconds: 60 });
        throw new Error("Bot login failed. Check the service account and its app password.");
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  stop() {
    this.stopped = true;
    this.session.session = undefined;
  }
}

export function createBotAuth(env: NodeJS.ProcessEnv, logger: StructuredLogger) {
  const appPassword = env.BOT_APP_PASSWORD?.trim();
  if (!appPassword) {
    logger.log("info", "cloud.bot.disabled", { reason: "not-configured" });
    return undefined;
  }
  return new BotAuth(
    {
      appPassword,
      identifier: env.BOT_IDENTIFIER?.trim() || "streamface.live",
      expectedDid: env.BOT_EXPECTED_DID?.trim() || streamfaceBotDid,
      service: env.BOT_PDS?.trim() || "https://bsky.social",
    },
    logger,
  );
}
