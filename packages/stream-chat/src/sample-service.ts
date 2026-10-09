import { Observable } from "@fettstorch/jule";
import type { StreamChatMessage } from "./model.ts";

const samples = [
  { name: "Mira", text: "Hey everyone! 👋", color: "#526baf" },
  { name: "Alex", text: "This is a sample message. Adjust the colors, font size and perspective to match your stream.", color: "#ad527f" },
  { name: "Sam", text: "Looking good! ✨\nLonger messages wrap onto multiple lines.", color: "#348c78" },
  { name: "Robin", text: "Short messages work too 💛", color: "#97722d" },
];

/** Local preview messages only: never connects to or posts in a stream's chat. */
export class SampleChatService {
  readonly messages = new Observable<StreamChatMessage>();
  private timer?: ReturnType<typeof setInterval>;
  private streamerDid = "";
  private sequence = 0;
  setStreamerDid(did: string) {
    if (this.streamerDid === did) return;
    this.stop();
    if (!did) return;
    this.streamerDid = did;
    queueMicrotask(() => { if (this.streamerDid === did) for (let i = 0; i < samples.length; i++) this.emit(); });
    this.timer = setInterval(() => this.emit(), 5000);
  }
  private emit() {
    const sample = samples[this.sequence % samples.length]!;
    const avatar = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${sample.color}"/><text x="32" y="43" text-anchor="middle" fill="white" font-family="sans-serif" font-size="32">${sample.name[0]}</text></svg>`)}`;
    this.messages.emit({ id: `sample-${this.sequence++}`, streamerDid: this.streamerDid, text: sample.text, createdAt: new Date().toISOString(), author: { did: `did:example:${sample.name.toLowerCase()}`, displayName: sample.name, avatar } });
  }
  stop() { clearInterval(this.timer); this.timer = undefined; this.streamerDid = ""; }
}
