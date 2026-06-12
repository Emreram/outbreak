// AnimController (animation plan WS1, master plan §3.7) — a PURE,
// Babylon-free pose-composition state machine. Three layers compose into one
// flat Pose each tick:
//   1. locomotion — continuous, sampled fresh from inputs (never accumulated)
//   2. action     — one one-shot track at a time, picked by priority
//                   (death 100 > spawn 90 > hit 80 > attack/leap/scream 60 >
//                   fire-recoil 40); equal/higher replaces, lower is dropped;
//                   trapezoid weight envelope (~130ms ramps)
//   3. stance     — a held loop (aim/reload/rummage/dizzy/…), weight ramped
//                   over ~150ms, plus the always-on additive breathe/twitch
//                   micro-layer (suppressed while an action ≥ hit plays)
// The registry (locomotion fn + action/stance tables) is dependency-injected
// so this module stays generic and headless tests drive it with fakes.
// Deterministic: same play()/tick() script ⇒ identical poses. Tick on SIM
// time so hitstop/pauses freeze animation for free (plan D4).

export interface JointSwing {
  swingY: number;
  liftZ: number;
}

export interface Pose {
  yawOffset: number; // added to -(facing) on root yaw (locomotion sets -sway)
  roll: number; // root lean
  pitch: number; // torso forward lean
  torsoTwist: number; // torso yaw (aim tracking, windup)
  scaleY: number; // root squash/stretch (1 = rest)
  rootY: number; // vertical offset, m
  rootX: number; // along-facing offset, m (lunge/recoil)
  armL: JointSwing;
  armR: JointSwing;
  elbowL: number;
  elbowR: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  headPitch: number;
  headYaw: number;
}

export function newPose(): Pose {
  return {
    yawOffset: 0,
    roll: 0,
    pitch: 0,
    torsoTwist: 0,
    scaleY: 1,
    rootY: 0,
    rootX: 0,
    armL: { swingY: 0, liftZ: 0 },
    armR: { swingY: 0, liftZ: 0 },
    elbowL: 0,
    elbowR: 0,
    hipL: 0,
    hipR: 0,
    kneeL: 0,
    kneeR: 0,
    headPitch: 0,
    headYaw: 0,
  };
}

export function resetPose(p: Pose): Pose {
  p.yawOffset = 0;
  p.roll = 0;
  p.pitch = 0;
  p.torsoTwist = 0;
  p.scaleY = 1;
  p.rootY = 0;
  p.rootX = 0;
  p.armL.swingY = 0;
  p.armL.liftZ = 0;
  p.armR.swingY = 0;
  p.armR.liftZ = 0;
  p.elbowL = 0;
  p.elbowR = 0;
  p.hipL = 0;
  p.hipR = 0;
  p.kneeL = 0;
  p.kneeR = 0;
  p.headPitch = 0;
  p.headYaw = 0;
  return p;
}

/** Continuous inputs sampled by locomotion/stances each tick. */
export interface LocoInput {
  timeMs: number; // sim clock
  phaseRad: number; // stride phase (parity frequencies)
  moving: boolean;
  speedFrac: number; // 0..~1.2, body speed / archetype speed (anti-slide)
  sprintFrac: number; // 0..1
  aimDeltaYaw: number; // wrapped aim - facing (aim stance)
  stunned: boolean;
  creep: boolean; // stalker close-in
  pauseGather: boolean; // lurcher pause window
  windPhase: number; // per-rig hash phase for twitches
}

export function newLocoInput(): LocoInput {
  return {
    timeMs: 0,
    phaseRad: 0,
    moving: false,
    speedFrac: 0,
    sprintFrac: 0,
    aimDeltaYaw: 0,
    stunned: false,
    creep: false,
    pauseGather: false,
    windPhase: 0,
  };
}

export interface ActorAnimSpec {
  kind: "humanoid" | "quad";
  /** BodyArchetype / animal kind / "survivor" — locomotion picks layers by it. */
  archetype: string;
  movement?: string; // ZombieDef.movement for archetype layers
  scale: number;
  /** Deterministic per-rig 0..1 (twitch phasing). */
  hash: number;
}

export interface ActionOpts {
  dirX?: number;
  dirY?: number;
  power?: number;
}

/** One-shot sampler: blend `w`-weighted channel offsets into the pose. */
export type ActionSampler = (t01: number, w: number, pose: Pose, inp: LocoInput, opts: ActionOpts, spec: ActorAnimSpec) => void;

export interface ActionDef {
  durationMs: number;
  priority: number;
  rampMs?: number; // default 130
  sample: ActionSampler;
}

/** Held-loop sampler (aim/reload/…): weight ramps 0..1 over ~150ms. */
export type StanceSampler = (w: number, pose: Pose, inp: LocoInput, spec: ActorAnimSpec) => void;

export interface AnimRegistry {
  locomotion: (spec: ActorAnimSpec, inp: LocoInput, pose: Pose) => void;
  actions: Record<string, ActionDef>;
  stances: Record<string, StanceSampler>;
  /** Breathe/twitch micro-layer; `suppress` is 0..1 (1 = fully suppressed). */
  additive?: (spec: ActorAnimSpec, inp: LocoInput, pose: Pose, suppress: number) => void;
}

const STANCE_RAMP_MS = 150;
const DEFAULT_ACTION_RAMP_MS = 130;
/** Actions at or above this priority suppress the additive micro-layer. */
const ADDITIVE_SUPPRESS_PRIORITY = 80;

export class AnimController {
  private readonly pose = newPose();
  private action: { name: string; def: ActionDef; tMs: number; opts: ActionOpts } | null = null;
  private stance: string | null = null;
  private stanceW = 0;

  constructor(
    readonly spec: ActorAnimSpec,
    private readonly registry: AnimRegistry,
  ) {}

  /** Start a one-shot. Equal/higher priority replaces the current; lower drops. */
  play(name: string, opts: ActionOpts = {}): boolean {
    const def = this.registry.actions[name];
    if (!def) return false;
    if (this.action && def.priority < this.action.def.priority) return false;
    this.action = { name, def, tMs: 0, opts };
    return true;
  }

  /** Hold (or release with null) a stance loop; weight ramps over 150ms. */
  setStance(name: string | null): void {
    if (name !== null && !this.registry.stances[name]) name = null;
    this.stance = name;
  }

  current(): string | null {
    return this.action?.name ?? null;
  }

  currentStance(): string | null {
    return this.stance;
  }

  /** Advance by sim-time dt and return the composed pose (reused object). */
  tick(dtMs: number, inp: LocoInput): Readonly<Pose> {
    const pose = resetPose(this.pose);

    // 1. locomotion (continuous)
    this.registry.locomotion(this.spec, inp, pose);

    // 2. stance (ramped hold)
    const target = this.stance ? 1 : 0;
    const step = dtMs / STANCE_RAMP_MS;
    this.stanceW = this.stanceW < target ? Math.min(target, this.stanceW + step) : Math.max(target, this.stanceW - step);
    if (this.stance && this.stanceW > 0.001) {
      this.registry.stances[this.stance](this.stanceW, pose, inp, this.spec);
    }

    // 3. action (one-shot with trapezoid envelope)
    let suppress = 0;
    if (this.action) {
      const a = this.action;
      a.tMs += dtMs;
      if (a.tMs >= a.def.durationMs) {
        this.action = null;
      } else {
        const t01 = a.tMs / a.def.durationMs;
        const ramp = a.def.rampMs ?? DEFAULT_ACTION_RAMP_MS;
        const w = Math.min(1, a.tMs / ramp, (a.def.durationMs - a.tMs) / ramp);
        a.def.sample(t01, w, pose, inp, a.opts, this.spec);
        if (a.def.priority >= ADDITIVE_SUPPRESS_PRIORITY) suppress = w;
      }
    }

    // 4. additive micro-layer (breathe/twitch), suppressed by heavy actions
    this.registry.additive?.(this.spec, inp, pose, suppress);

    return pose;
  }
}
