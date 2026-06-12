// Typed event bus (3D master plan §3.2) — the one-way channel from the
// simulation to whatever presentation is attached (Phaser today, Babylon 3D).
// The sim EMITS facts; views subscribe. Nothing in /src/sim may import a
// renderer, and views must never reach into sim internals to mutate state.
//
// Continuous state (positions, hp, channel progress) is NOT evented — views
// poll the sim's entity arrays each frame and interpolate. Events cover
// discrete moments only (spawn/death/impact/UI cues).

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
  /** Generic one-line banner/toast for the UI layer. */
  banner: { text: string; color?: string };
  /** One-shot sound cue (name = engine/audio.ts sfx method), optional position. */
  sound: { id: string; x?: number; y?: number };
  /** Floating combat text at a sim position. */
  floatText: { x: number; y: number; text: string; color?: string };
  /** Camera/feel impulses (shake trauma 0..1, hitstop ms, zoom punch). */
  impulse: { kind: "shake" | "hitstop" | "zoomPunch" | "hurtPulse" | "flash"; amount: number };

  // --- entities ------------------------------------------------------------
  enemySpawned: { id: number };
  /** A contact attack landed its cooldown window (animation telegraph). */
  enemyAttack: { id: number; x: number; y: number };
  /** A spitter wound up an acid glob (before the projectile spawns). */
  enemySpit: { id: number; angle: number };
  /** corpse=true → the body converts to a lingering searchable corpse. */
  enemyRemoved: { id: number; corpse: boolean };
  corpseFaded: { id: number };
  animalSpawned: { id: number };
  animalRemoved: { id: number; killed: boolean };

  // --- combat FX moments -----------------------------------------------------
  /** Blood spray at a position; enemyId picks the fluid profile (none = player red). */
  splat: { x: number; y: number; dirX?: number; dirY?: number; power: number; enemyId?: number };
  /** Ground blood decal. */
  decal: { x: number; y: number; scale: number; enemyId?: number };
  gibs: { x: number; y: number; enemyId: number };
  swing: { x: number; y: number; facing: number; style: "slash" | "thrust" | "smash" };
  muzzle: { x: number; y: number; angle: number };
  casing: { x: number; y: number; angle: number };
  projectileSpawned: { id: number; kind: "bullet" | "pellet" | "arrow" | "rocket" | "acid" };
  projectileKilled: { id: number; x: number; y: number };
  explosion: { x: number; y: number; radius: number };
  zap: { x0: number; y0: number; x1: number; y1: number };
  screamRing: { x: number; y: number; id?: number };
  toxicCloud: { x: number; y: number };

  // --- loot ------------------------------------------------------------------
  dropSpawned: { id: number };
  dropRemoved: { id: number; pickedUp: boolean };
  pickup: { item: string; qty: number; combo: number; equipped: boolean };

  // --- scavenging --------------------------------------------------------------
  searchStarted: { x: number; y: number };
  searchCancelled: Record<string, never>;
  searchDone: { x: number; y: number; empty: boolean; gid?: string };
  /** A "corpse" prop lunged (playsDead roll) — an enemy spawned instead. */
  corpseLunged: { x: number; y: number };

  // --- GM encounters ---------------------------------------------------------
  /** A scripted dilemma fired — the view opens the GM choice/chat modal. */
  encounterRequested: { title: string; situation: string; choices: string[]; loc: string };

  // --- run state ----------------------------------------------------------------
  death: { reason: string };
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
