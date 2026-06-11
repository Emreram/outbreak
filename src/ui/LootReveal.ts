import type { Rarity } from "../game/items/types";
import { RARITY_META } from "../game/items/rarity";
import { sfx } from "../engine/audio";

// Loot-reveal ceremony (Companions & Spectacle PR-C) — the tiered "loot box"
// opening: buildup (shake + glow ramp + riser) → burst (flash + particle ring) →
// staggered card flips with rarity stingers (epic+ confetti, mythic beam) →
// linger → close. PRESENTATION ONLY: every item is already in the bag before
// open() is called, so a crash can never eat loot. One ceremony at a time; any
// input skips instantly to the summary (ui rules: all animations skippable);
// an 8s failsafe can never soft-lock the run.

export interface RevealCard {
  img: string; // icon/portrait dataURL
  name: string;
  qty?: number;
  rarity: Rarity;
  sub?: string; // extra line (pets: species blurb)
}

export interface RevealRequest {
  title: string; // "SUPPLY CACHE", "GUN CABINET", "SPOTTED EGG"…
  icon: string; // container icon dataURL (the thing being opened)
  cards: RevealCard[];
  egg?: boolean; // egg variant: wobble + crack stages instead of shake
}

const STYLE_ID = "ob-reveal-style";
const CSS = `
.ob-rv{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;flex-direction:column;
  background:radial-gradient(ellipse at center, rgba(8,10,14,.55), rgba(2,3,5,.9));
  font-family:ui-monospace,Menlo,Consolas,monospace;color:#e9e0cd;cursor:pointer;user-select:none}
.ob-rv.ob-show{display:flex;animation:ob-rvfade .14s ease}
@keyframes ob-rvfade{from{opacity:0}to{opacity:1}}

.ob-rv-title{font-size:14px;letter-spacing:.34em;color:#9a8e6f;text-transform:uppercase;margin-bottom:26px;text-shadow:0 1px 0 #000}

.ob-rv-stage{position:relative;width:160px;height:160px;display:flex;align-items:center;justify-content:center}
.ob-rv-glow{position:absolute;inset:18px;border-radius:50%;transition:box-shadow .55s ease, opacity .3s;opacity:.9}
.ob-rv-box{width:96px;height:96px;image-rendering:pixelated;position:relative;z-index:1;filter:drop-shadow(0 6px 14px rgba(0,0,0,.6))}
.ob-rv-box.ob-shake{animation:ob-rvshake .12s linear infinite}
@keyframes ob-rvshake{0%{transform:translate(2px,1px) rotate(.6deg)}25%{transform:translate(-2px,-1px) rotate(-.8deg)}
  50%{transform:translate(2px,-2px) rotate(.5deg)}75%{transform:translate(-1px,2px) rotate(-.5deg)}100%{transform:translate(1px,-1px) rotate(.7deg)}}
.ob-rv-box.ob-wobble{animation:ob-rvwobble .5s ease-in-out infinite}
@keyframes ob-rvwobble{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
.ob-rv-box.ob-jolt{animation:ob-rvjolt .14s ease}
@keyframes ob-rvjolt{0%{transform:scale(1)}40%{transform:scale(1.14) rotate(3deg)}100%{transform:scale(1)}}

.ob-rv-flash{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3}
.ob-rv-flash.ob-on{animation:ob-rvflash .22s ease-out}
@keyframes ob-rvflash{from{opacity:.85}to{opacity:0}}
.ob-rv-dot{position:absolute;left:50%;top:50%;width:7px;height:7px;border-radius:50%;pointer-events:none;
  transition:transform .5s cubic-bezier(.2,.8,.3,1), opacity .5s;z-index:2}

.ob-rv-cards{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;max-width:min(860px,94vw);perspective:700px;min-height:150px}
.ob-rv-card{position:relative;width:112px;min-height:148px;border-radius:11px;padding:10px 8px;box-sizing:border-box;
  display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;
  background:linear-gradient(165deg,#1c2118,#0e110a);border:2px solid #3a4a2f;
  transition:transform .22s cubic-bezier(.2,.85,.3,1.1), opacity .22s;transform-style:preserve-3d}
.ob-rv-card.ob-hid{transform:rotateY(88deg) scale(.86);opacity:0}
.ob-rv-card img{width:58px;height:58px;image-rendering:pixelated;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55))}
.ob-rv-name{font-size:12px;font-weight:700;line-height:1.25}
.ob-rv-qty{font-size:11px;color:#cdd2b8}
.ob-rv-sub{font-size:9.5px;color:#9a8e6f;line-height:1.3}
.ob-rv-tier{font-size:8.5px;letter-spacing:.22em;text-transform:uppercase;opacity:.85}
.ob-rv-beam{position:absolute;left:50%;top:-46vh;width:54px;height:46vh;transform:translateX(-50%);pointer-events:none;
  background:linear-gradient(180deg, transparent, currentColor);opacity:0;transition:opacity .6s}
.ob-rv-beam.ob-on{opacity:.28}
.ob-rv-conf{position:absolute;left:50%;top:40%;width:6px;height:6px;pointer-events:none;
  transition:transform .8s cubic-bezier(.15,.7,.3,1), opacity .8s}

.ob-rv-foot{margin-top:30px;font-size:11px;color:#7a6f54;letter-spacing:.12em}
`;

type Phase = "idle" | "buildup" | "cards" | "linger";

export class LootReveal {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly stageEl: HTMLDivElement;
  private readonly glowEl: HTMLDivElement;
  private readonly boxEl: HTMLImageElement;
  private readonly flashEl: HTMLDivElement;
  private readonly cardsEl: HTMLDivElement;
  private readonly footEl: HTMLDivElement;
  private readonly onCloseCb: () => void;

  private phase: Phase = "idle";
  private timers: number[] = [];
  private cardEls: HTMLDivElement[] = [];
  private bestRank = 0;
  private openedTs = 0;

  constructor(onClose: () => void) {
    this.onCloseCb = onClose;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = div("ob-rv");
    this.titleEl = div("ob-rv-title");
    this.stageEl = div("ob-rv-stage");
    this.glowEl = div("ob-rv-glow");
    this.boxEl = document.createElement("img");
    this.boxEl.className = "ob-rv-box";
    this.stageEl.append(this.glowEl, this.boxEl);
    this.cardsEl = div("ob-rv-cards");
    this.footEl = div("ob-rv-foot");
    this.flashEl = div("ob-rv-flash");
    this.root.append(this.titleEl, this.stageEl, this.cardsEl, this.footEl, this.flashEl);
    document.body.appendChild(this.root);
    this.root.addEventListener("pointerdown", () => this.onInput());
    window.addEventListener("keydown", this.onKey);
  }

  isOpen(): boolean {
    return this.phase !== "idle";
  }

  destroy(): void {
    this.clearTimers();
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }

  /** Start the ceremony. Items are ALREADY granted — this only presents them. */
  open(req: RevealRequest): void {
    if (this.phase !== "idle") return; // reentrancy guard — caller falls back to quick-pop
    this.phase = "buildup";
    this.openedTs = performance.now();
    this.bestRank = req.cards.reduce((a, c) => Math.max(a, RARITY_META[c.rarity].rank), 0);

    this.titleEl.textContent = req.title;
    this.boxEl.src = req.icon;
    this.boxEl.className = "ob-rv-box " + (req.egg ? "ob-wobble" : "ob-shake");
    this.stageEl.style.display = "flex";
    const best = RARITY_META[reqBestRarity(req)];
    this.glowEl.style.boxShadow = `0 0 14px 4px ${best.css}22`;
    this.footEl.textContent = "any key / click to skip";
    this.buildCards(req.cards);
    this.root.classList.add("ob-show");

    // glow ramps toward the best rarity while the container strains
    this.after(60, () => {
      this.glowEl.style.boxShadow = `0 0 ${36 + this.bestRank * 16}px ${10 + this.bestRank * 6}px ${best.css}66`;
    });

    if (req.egg) {
      // three escalating cracks, then the shell gives way
      [180, 460, 760].forEach((t, i) => this.after(t, () => {
        sfx.eggCrack(i);
        this.boxEl.classList.remove("ob-jolt");
        void this.boxEl.offsetWidth; // restart the jolt animation
        this.boxEl.classList.add("ob-jolt");
      }));
      this.after(980, () => this.burst());
    } else {
      sfx.riser();
      this.after(650, () => this.burst());
    }
    // failsafe: whatever happens, the ceremony can never hold the game hostage
    this.after(8000, () => this.close());
  }

  // --- phases -----------------------------------------------------------------

  private burst(): void {
    if (this.phase !== "buildup") return;
    this.phase = "cards";
    sfx.revealBurst();
    this.flashEl.classList.remove("ob-on");
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add("ob-on");
    this.particleRing();
    this.stageEl.style.display = "none";
    // flip the cards in, one heartbeat apart
    this.cardEls.forEach((el, i) => {
      this.after(120 + i * 140, () => this.revealCard(el, i));
    });
    const total = 120 + this.cardEls.length * 140 + 240;
    this.after(total, () => this.linger());
  }

  private revealCard(el: HTMLDivElement, _i: number): void {
    el.classList.remove("ob-hid");
    sfx.cardFlip();
    const rank = Number(el.dataset.rank ?? 0);
    if (rank > 0) sfx.rarityStinger(rank);
    if (rank >= 3) {
      this.confetti(el, rank);
      sfx.jackpot();
      this.flashEl.classList.remove("ob-on");
      void this.flashEl.offsetWidth;
      this.flashEl.classList.add("ob-on");
    }
    if (rank >= 5) el.querySelector(".ob-rv-beam")?.classList.add("ob-on");
  }

  private linger(): void {
    if (this.phase === "idle") return;
    this.phase = "linger";
    this.footEl.textContent = "click to close";
    this.after(2600, () => this.close());
  }

  private close(): void {
    if (this.phase === "idle") return;
    this.phase = "idle";
    this.clearTimers();
    this.root.classList.remove("ob-show");
    this.cardsEl.innerHTML = "";
    this.cardEls = [];
    this.onCloseCb();
  }

  // --- input ---------------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (this.phase === "idle") return;
    if (e.timeStamp <= this.openedTs) return; // the keystroke that opened us
    if (e.key === " " || e.key === "Escape" || e.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      this.onInput();
    }
  };

  /** Any input: skip straight to the full summary; a second input closes. */
  private onInput(): void {
    if (this.phase === "buildup" || this.phase === "cards") {
      this.clearTimers();
      this.stageEl.style.display = "none";
      for (const el of this.cardEls) el.classList.remove("ob-hid");
      if (this.bestRank > 0) sfx.rarityStinger(this.bestRank); // one composite sting
      this.phase = "cards"; // settle through linger below
      this.linger();
      this.after(8000, () => this.close()); // re-arm the failsafe
      return;
    }
    if (this.phase === "linger") this.close();
  }

  // --- builders --------------------------------------------------------------------

  private buildCards(cards: RevealCard[]): void {
    this.cardsEl.innerHTML = "";
    this.cardEls = [];
    for (const c of cards.slice(0, 12)) {
      const meta = RARITY_META[c.rarity];
      const el = div("ob-rv-card ob-hid");
      el.dataset.rank = String(meta.rank);
      el.style.borderColor = meta.css;
      const a = ["22", "30", "40", "5c", "80", "aa"][meta.rank];
      el.style.boxShadow = `inset 0 0 ${10 + meta.rank * 5}px ${meta.css}${a}${meta.rank >= 3 ? `, 0 0 ${8 + meta.rank * 5}px ${meta.css}${a}` : ""}`;
      if (meta.rank >= 5) {
        const beam = div("ob-rv-beam");
        beam.style.color = meta.css;
        el.append(beam);
      }
      const img = document.createElement("img");
      img.src = c.img;
      const name = div("ob-rv-name");
      name.style.color = meta.css;
      name.textContent = c.name;
      const tier = div("ob-rv-tier");
      tier.style.color = meta.css;
      tier.textContent = meta.label;
      el.append(img, name, tier);
      if (c.qty && c.qty > 1) {
        const q = div("ob-rv-qty");
        q.textContent = "×" + c.qty;
        el.append(q);
      }
      if (c.sub) {
        const s = div("ob-rv-sub");
        s.textContent = c.sub;
        el.append(s);
      }
      this.cardsEl.append(el);
      this.cardEls.push(el);
    }
  }

  /** A ring of sparks thrown from the container at the moment it gives. */
  private particleRing(): void {
    const best = this.bestRank;
    for (let i = 0; i < 12; i++) {
      const d = div("ob-rv-dot");
      const hue = ["#b8c0c8", "#5ed66e", "#4aa3ff", "#b368ff", "#ffa23f", "#ff5a6e"][Math.min(5, best)];
      d.style.background = hue;
      this.stageEl.parentElement?.append(d);
      d.style.position = "fixed";
      d.style.left = "50%";
      d.style.top = "42%";
      const a = (i / 12) * Math.PI * 2;
      requestAnimationFrame(() => {
        d.style.transform = `translate(${Math.cos(a) * 130}px, ${Math.sin(a) * 130}px)`;
        d.style.opacity = "0";
      });
      window.setTimeout(() => d.remove(), 700);
    }
  }

  /** Confetti burst pinned to an epic+ card. */
  private confetti(card: HTMLDivElement, rank: number): void {
    const palette = rank >= 5 ? ["#ff5a6e", "#ffd23f", "#fff"] : rank >= 4 ? ["#ffa23f", "#ffd23f", "#fff"] : ["#b368ff", "#9be7ff", "#fff"];
    for (let i = 0; i < 16; i++) {
      const c = div("ob-rv-conf");
      c.style.background = palette[i % palette.length];
      if (i % 3 === 0) c.style.borderRadius = "50%";
      card.append(c);
      const a = Math.random() * Math.PI * 2;
      const r = 50 + Math.random() * 70;
      requestAnimationFrame(() => {
        c.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r + 30}px) rotate(${Math.random() * 540 - 270}deg)`;
        c.style.opacity = "0";
      });
      window.setTimeout(() => c.remove(), 950);
    }
  }

  // --- timer plumbing -----------------------------------------------------------------

  private after(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
  private clearTimers(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }
}

/** Best rarity present in the request (drives the buildup glow colour). */
function reqBestRarity(req: RevealRequest): RevealCard["rarity"] {
  let best: RevealCard["rarity"] = "common";
  for (const c of req.cards) if (RARITY_META[c.rarity].rank > RARITY_META[best].rank) best = c.rarity;
  return best;
}

function div(className: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = className;
  return e;
}
