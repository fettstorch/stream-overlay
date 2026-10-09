import { PaintService, parseCursor, parseSegments } from "../../../modules/overlay-paint/src/service.ts";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
import type { CloudConfig } from "./pds.ts";
import type { StructuredLogger } from "./logger.ts";

/** Drawings are transient, account-isolated relay state, never PDS records. */
export class CloudPaint {
  private accounts = new Map<string, { service: PaintService; enabled: boolean; lastAction: number; settings: string }>();
  constructor(private logger: StructuredLogger, private now = () => Date.now()) {}
  service(did: string, config: CloudConfig) {
    let account = this.accounts.get(did);
    if (!account) {
      if (this.accounts.size >= 200) throw new Error("Paint session limit reached");
      account = { service: new PaintService(), enabled: false, lastAction: this.now(), settings: "" };
      this.accounts.set(did, account);
    }
    const settings = moduleSettings(config);
    const signature = JSON.stringify(settings.paint);
    if (account.settings !== signature) { account.settings = signature; account.service.configure(settings.paint); }
    if (account.enabled !== settings.modules.paint) { account.enabled = settings.modules.paint; account.service.setEnabled(account.enabled); }
    return account;
  }
  async handle(request: Request, did: string, action: string, config: CloudConfig, requestId: string) {
    const account = this.service(did, config);
    if (action === "events") return account.service.events(request);
    const body = await request.json();
    let accepted = false;
    if (action === "segments") {
      const segments = parseSegments(body.segments);
      if (!segments) return Response.json({ message: "Invalid paint segments", requestId }, { status: 400 });
      accepted = account.service.append(segments);
      this.logger.log("info", "cloud.paint.stroke", { requestId, segments: segments.length, accepted });
    } else {
      const cursor = parseCursor(body.cursor);
      if (cursor === undefined) return Response.json({ message: "Invalid paint cursor", requestId }, { status: 400 });
      accepted = account.service.moveCursor(cursor);
    }
    account.lastAction = this.now();
    return Response.json({ accepted, requestId }, { status: accepted ? 200 : 409 });
  }
  configure(did: string, config: CloudConfig) { if (this.accounts.has(did)) this.service(did, config); }
  cleanup() { for (const [did, account] of this.accounts) if (!account.service.subscriberCount && this.now() - account.lastAction >= 3_600_000) { account.service.stop(); this.accounts.delete(did); } }
}
