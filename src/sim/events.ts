// Typed event bus (3D master plan §3.2) — the one-way channel from the
// simulation to whatever presentation is attached (Phaser today, Babylon 3D).
// The sim EMITS facts; views subscribe. Nothing in /src/sim may import a
// renderer, and views must never reach into sim internals to mutate state.

export interface SimEventMap {
  /** A chunk's terrain data became resident (generate + scars applied). */
  chunkLoaded: { cx: number; cy: number };
  /** A resident chunk was dropped from the streaming ring. */
  chunkUnloaded: { cx: number; cy: number };
  /** Resident chunks re-derived (disaster scar added/healed) — views rebuild. */
  chunksRefreshed: Record<string, never>;
  /** Day/night phase changed (dawn/day/dusk/night). */
  phaseChanged: { phase: "dawn" | "day" | "dusk" | "night"; day: number };
  /** A new game-day started. */
  dayStarted: { day: number };
  /** Weather changed. */
  weatherChanged: { kind: string };
  /** Blood moon began / ended tonight. */
  bloodMoon: { active: boolean };
  /** Generic one-line banner for the UI layer. */
  banner: { text: string; color?: string };
  /** Positional one-shot sound cue (id from engine/audio.ts surface). */
  sound: { id: string; x?: number; y?: number };
  /** Floating combat text at a sim position. */
  floatText: { x: number; y: number; text: string; color?: string };
  /** Camera/feel impulses (shake trauma 0..1, hitstop ms, zoom punch). */
  impulse: { kind: "shake" | "hitstop" | "zoomPunch" | "hurtPulse"; amount: number };
}

export type SimEventName = keyof SimEventMap;

type Handler<K extends SimEventName> = (payload: SimEventMap[K]) => void;

export class EventBus {
  private handlers = new Map<SimEventName, Set<Handler<SimEventName>>>();

  on<K extends SimEventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<SimEventName>);
    return () => this.off(name, fn);
  }

  off<K extends SimEventName>(name: K, fn: Handler<K>): void {
    this.handlers.get(name)?.delete(fn as Handler<SimEventName>);
  }

  emit<K extends SimEventName>(name: K, payload: SimEventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
