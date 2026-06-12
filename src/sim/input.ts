// Abstract input intents (3D master plan §3.2) — the renderer feeds these; the
// sim never touches keyboards, pointers, or touch DOM. Bindings stay identical
// to the Phaser path (WASD/arrows, Shift sprint, pointer aim); only the
// transport changes.

export interface InputState {
  /** Move intent, components in -1..1 (keyboard) or analog (touch stick). */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** Aim angle in radians (sim plane), or null when no pointer aim available. */
  aim: number | null;
  /** Held-down states. */
  fire: boolean;
  interact: boolean;
}

export function newInputState(): InputState {
  return { moveX: 0, moveY: 0, sprint: false, aim: null, fire: false, interact: false };
}
