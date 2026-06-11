// Tiny procedural sound layer via the Web Audio API — no asset files, works
// offline on any device (CLAUDE.md §13 Phase 7 "Sound"). Created lazily and
// resumed on the first user gesture (browsers block autoplay until then).
//
// U4 adds an AMBIENT layer (generated noise/sine beds per biome group + a night
// layer with cricket/bird chirps), simple POSITIONAL one-shots (stereo pan +
// distance falloff) and the heartbeat/feel one-shots. Everything stays behind
// ensure()'s null-guard so headless/holdout environments can never throw.

interface SpatialOpts {
  pan?: number; // -1 .. 1
  dist?: number; // world px — gain falls off as 1/(1+dist/300)
}

type AmbGroup = "city" | "nature" | "water";

class Sfx {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null; // white (one-shots)
  private brownBuf: AudioBuffer | null = null; // brown (wind beds)
  private amb: { group: AmbGroup; night: boolean; stops: Array<() => void> } | null = null;
  private chirpTimer: ReturnType<typeof setInterval> | null = null;

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
    if (!this.sfxBus && this.ctx) {
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.ctx.destination);
      this.ambBus = this.ctx.createGain();
      this.ambBus.gain.value = 0.6;
      this.ambBus.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Wire a voice's tail through an optional stereo panner into the sfx bus. */
  private route(tail: AudioNode, ctx: AudioContext, opts?: SpatialOpts): void {
    if (opts?.pan !== undefined && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      tail.connect(p);
      tail = p;
    }
    tail.connect(this.sfxBus ?? ctx.destination);
  }

  private spatialGain(gain: number, opts?: SpatialOpts): number {
    return opts?.dist !== undefined ? gain / (1 + opts.dist / 300) : gain;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, opts?: SpatialOpts): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(this.spatialGain(gain, opts), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this.route(g, ctx, opts);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A short filtered-noise burst (rustles, gunfire crack, knocks). */
  private noise(dur: number, filterFreq: number, gain: number, opts?: SpatialOpts): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = filterFreq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(this.spatialGain(gain, opts), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    this.route(g, ctx, opts);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** A blip scheduled slightly ahead (chirp scheduler). */
  private blip(freq: number, dur: number, gain: number, at: number, type: OscillatorType = "sine"): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.ambBus ?? ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // --- ambient beds (U4) ----------------------------------------------------

  /** Looping brown-noise wind through a lowpass, breathing on a slow LFO. */
  private startWind(level: number, lowpass: number): () => void {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return () => {};
    if (!this.brownBuf) {
      this.brownBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const d = this.brownBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = Math.max(-1, Math.min(1, last + (Math.random() * 2 - 1) * 0.04));
        d[i] = last * 2.4;
      }
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = level * 0.4;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(f).connect(g).connect(this.ambBus);
    src.start(t);
    lfo.start(t);
    return () => {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.linearRampToValueAtTime(0.0001, now + 1.6);
      setTimeout(() => {
        try {
          src.stop();
          lfo.stop();
        } catch {
          /* already stopped */
        }
        g.disconnect();
      }, 1800);
    };
  }

  /** Detuned sine pair — the dead city's electrical hum. */
  private startHum(level: number): () => void {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return () => {};
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 2);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.frequency.value = 55;
    o2.frequency.value = 55.7;
    o1.connect(g);
    o2.connect(g);
    g.connect(this.ambBus);
    o1.start(t);
    o2.start(t);
    return () => {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.linearRampToValueAtTime(0.0001, now + 1.6);
      setTimeout(() => {
        try {
          o1.stop();
          o2.stop();
        } catch {
          /* already stopped */
        }
        g.disconnect();
      }, 1800);
    };
  }

  /** Crossfade the ambient bed to a biome group + night layer. Idempotent. */
  setAmbience(group: AmbGroup, night: boolean): void {
    if (this.amb && this.amb.group === group && this.amb.night === night) return;
    const ctx = this.ensure();
    if (!ctx) return;
    for (const stop of this.amb?.stops ?? []) stop();
    const stops: Array<() => void> = [];
    if (group === "city") {
      stops.push(this.startWind(0.05, 500));
      stops.push(this.startHum(0.028));
    } else if (group === "water") {
      stops.push(this.startWind(0.09, 260));
    } else {
      stops.push(this.startWind(0.06, 420));
    }
    if (night) stops.push(this.startWind(0.045, 150)); // darker pressure under it all
    this.amb = { group, night, stops };
    this.startChirps();
  }

  /** Night crickets / day birds, scheduled a beat ahead on a slow poll. */
  private startChirps(): void {
    if (this.chirpTimer) return;
    this.chirpTimer = setInterval(() => {
      const ctx = this.ctx;
      const amb = this.amb;
      if (!ctx || ctx.state !== "running" || !amb) return;
      const t = ctx.currentTime + 0.4;
      if (amb.night) {
        if (Math.random() < 0.1 && amb.group !== "city") {
          const f = 3900 + Math.random() * 500;
          for (let i = 0; i < 3; i++) this.blip(f, 0.03, 0.016, t + i * 0.07);
        }
      } else if (amb.group === "nature" && Math.random() < 0.06) {
        this.blip(2300 + Math.random() * 300, 0.08, 0.02, t);
        this.blip(1800 + Math.random() * 200, 0.1, 0.016, t + 0.13);
      }
    }, 320);
  }

  /** Tear the ambient layer down (scene shutdown). */
  stopAmbience(): void {
    for (const stop of this.amb?.stops ?? []) stop();
    this.amb = null;
    if (this.chirpTimer) {
      clearInterval(this.chirpTimer);
      this.chirpTimer = null;
    }
  }

  // --- one-shots --------------------------------------------------------------

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
  /** A low dead-throat rasp from a direction (proximity groans, U4). */
  groan(pan = 0, dist = 0): void {
    this.tone(72, 0.5, "sawtooth", 0.07, 46, { pan, dist });
  }
  /** Distant gunfire — crack + body (heartbeat beacons, U4). */
  gunshotFar(pan = 0, dist = 0): void {
    this.noise(0.2, 380, 0.12, { pan, dist });
    this.tone(110, 0.12, "square", 0.05, 50, { pan, dist });
  }
  /** A car-alarm honk; the scene repeats it while the beacon lives (U4). */
  alarm(pan = 0, dist = 0): void {
    this.tone(660, 0.3, "square", 0.03, 655, { pan, dist });
  }
  /** Searching/rummaging rustle (U1 channel start). */
  rustle(): void {
    this.noise(0.14, 1300, 0.05);
  }
  /** Lock giving way. */
  unlock(): void {
    this.tone(1250, 0.04, "square", 0.05, 950);
  }
  /** Boards creaking off (U5 pry). */
  pry(): void {
    this.tone(160, 0.32, "sawtooth", 0.05, 290);
  }
  /** A fist on wood from inside (U5 trapped survivor). */
  knock(): void {
    this.tone(150, 0.09, "sine", 0.1, 70);
  }
  /** A flare streaking up (U4 night beacon). */
  flare(): void {
    this.tone(540, 0.8, "sine", 0.035, 1500);
  }
  /** Dissonant danger sting — the pack has your scent (U4). */
  sting(): void {
    this.tone(196, 0.55, "sawtooth", 0.06, 92);
    this.tone(207, 0.55, "sawtooth", 0.045, 98);
  }

  // --- pets (PR-A): species voices + taming feedback -------------------------

  /** A pet calls out — one synth recipe per voice family, positional-capable. */
  petVoice(voice: string, pan = 0, dist = 0): void {
    const o = { pan, dist };
    switch (voice) {
      case "dog":
        this.tone(380, 0.09, "square", 0.06, 240, o);
        setTimeout(() => this.tone(360, 0.08, "square", 0.05, 230, o), 110);
        break;
      case "cat":
        this.tone(520, 0.18, "sine", 0.05, 700, o);
        break;
      case "horse":
        this.tone(300, 0.16, "sawtooth", 0.05, 520, o);
        setTimeout(() => this.tone(520, 0.18, "sawtooth", 0.045, 260, o), 150);
        this.noise(0.12, 700, 0.03, o);
        break;
      case "bird":
        this.tone(2200, 0.05, "sine", 0.04, 2600, o);
        setTimeout(() => this.tone(1800, 0.06, "sine", 0.035, 2300, o), 90);
        break;
      case "wolf":
        this.tone(320, 0.6, "sine", 0.05, 480, o);
        break;
      case "drake":
        this.tone(900, 0.28, "sawtooth", 0.06, 400, o);
        this.noise(0.18, 1500, 0.03, o);
        break;
      case "serpent":
        this.noise(0.4, 2400, 0.04, o);
        break;
      default: // mythic — a soft otherworldly triad
        this.tone(392, 0.5, "sine", 0.035, 392, o);
        this.tone(494, 0.5, "sine", 0.03, 494, o);
        this.tone(587, 0.5, "sine", 0.025, 587, o);
    }
  }

  /** Bond formed — a rising warm triad + chime. */
  tameSuccess(): void {
    this.tone(392, 0.14, "sine", 0.05, 392);
    setTimeout(() => this.tone(494, 0.14, "sine", 0.05, 494), 110);
    setTimeout(() => this.tone(587, 0.22, "sine", 0.05, 587), 220);
    setTimeout(() => this.tone(1175, 0.3, "sine", 0.035, 1175), 330);
  }

  /** The offer is refused — a small falling minor second. */
  tameFail(): void {
    this.tone(440, 0.12, "sine", 0.045, 415);
    setTimeout(() => this.tone(415, 0.18, "sine", 0.04, 392), 120);
  }

  // --- riding (PR-B): saddle, hooves, wings, water ---------------------------

  /** Swing into (or out of) the saddle — leather creak + a low settle. */
  mountUp(): void {
    this.noise(0.09, 900, 0.045);
    this.tone(180, 0.1, "sine", 0.05, 140);
  }

  /** Take-off — a rising whoosh under the first downstroke. */
  mountWhoosh(): void {
    this.noise(0.3, 600, 0.05);
    this.tone(220, 0.28, "sine", 0.04, 540);
  }

  /** One soft wingbeat (the scene paces these while airborne). */
  wingbeat(): void {
    this.noise(0.16, 480, 0.034);
  }

  /** One hoof-fall of a galloping mount. */
  hoofbeat(): void {
    this.noise(0.045, 300, 0.045);
    this.tone(150, 0.05, "triangle", 0.035, 110);
  }

  /** A swimming mount's wake slapping past. */
  waterWake(): void {
    this.noise(0.2, 800, 0.025);
  }
}

export const sfx = new Sfx();
