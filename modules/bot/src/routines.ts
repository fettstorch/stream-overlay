import type { BotRoutine, BotSettings } from "./config.ts";

/** Browser-owned deadlines. Never replay missed intervals after suspension. */
export class RoutineSchedule {
  private entries = new Map<string, { signature: string; due: number; routine: BotRoutine }>();
  update(settings: BotSettings | undefined, now: number) {
    const active = settings?.enabled ? (settings.routines ?? []).filter(item => item.enabled) : [];
    const ids = new Set(active.map(item => item.id));
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
    for (const routine of active) {
      const signature = JSON.stringify(routine);
      if (this.entries.get(routine.id)?.signature !== signature)
        this.entries.set(routine.id, { signature, routine, due: now + routine.intervalSeconds * 1000 });
    }
  }
  due(now: number): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) if (entry.due <= now) {
      ids.push(id);
      entry.due = now + entry.routine.intervalSeconds * 1000;
    }
    return ids;
  }
}
