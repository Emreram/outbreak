// Tiny procedural sound effects via the Web Audio API — no asset files, works
// offline on any device (CLAUDE.md §13 Phase 7 "Sound"). Created lazily and
// resumed on the first user gesture (browsers block autoplay until then).

class Sfx {
  private ctx: AudioContext | null = null;
  private enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return null;
      }
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  swing(): void {
    this.tone(220, 0.09, "sawtooth", 0.05, 120);
  }
  hurt(): void {
    this.tone(90, 0.2, "square", 0.08, 60);
  }
  kill(): void {
    this.tone(160, 0.14, "sawtooth", 0.07, 50);
  }
  pickup(): void {
    this.tone(620, 0.08, "sine", 0.05, 880);
  }
  /** Pickup blip that pitches up with a rapid-loot combo (U3 loot feel). */
  tick(combo = 1): void {
    const f = 540 * Math.pow(1.12, Math.min(8, combo - 1));
    this.tone(f, 0.07, "sine", 0.05, f * 1.5);
  }
  ui(): void {
    this.tone(440, 0.05, "sine", 0.04);
  }
  death(): void {
    this.tone(200, 0.5, "sawtooth", 0.09, 40);
  }
  shot(): void {
    this.tone(180, 0.07, "square", 0.06, 70);
  }
  reload(): void {
    this.tone(320, 0.05, "square", 0.04, 240);
  }
  boom(): void {
    this.tone(70, 0.42, "sawtooth", 0.12, 28);
  }
}

export const sfx = new Sfx();
