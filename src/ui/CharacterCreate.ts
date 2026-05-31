import type { CharacterCreation } from "../shared/contracts";
import { BACKGROUNDS, randomBackground, type BackgroundDef } from "../game/backgrounds";
import { getPerk } from "../game/perks";
import { createRng, randomSeed } from "../game/rng";

// Character creation screen (DOM overlay, same pattern/guards as LootModal): name,
// a grid of background/class cards (loadout + perks), an appearance colour, and a
// difficulty. Returns { name, creation } to the menu, which starts the run.

export interface CreationResult {
  name: string;
  creation: CharacterCreation;
}

const STYLE_ID = "ob-cc-style";
const DIFFICULTIES: { label: string; mult: number }[] = [
  { label: "Easy", mult: 0.8 },
  { label: "Normal", mult: 1.0 },
  { label: "Hard", mult: 1.25 },
  { label: "Nightmare", mult: 1.5 },
];
const SWATCHES = [0x2ec4ff, 0xff5a6e, 0x5ed66e, 0x4aa3ff, 0xffd23f, 0xb368ff, 0xffa23f, 0x9aa3ad, 0xe8eef4, 0x6b8e23, 0xd13a2a, 0x23303f];
const NAMES = ["Mara", "Dev", "Ruiz", "Cole", "Imani", "Yuki", "Sasha", "Bishop", "Lena", "Tariq", "Nadia", "Reed", "Kade", "Iris", "Bex"];

const CSS = `
.ob-cc{position:fixed;inset:0;z-index:62;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.78);font-family:ui-monospace,Menlo,Consolas,monospace;padding:14px;box-sizing:border-box}
.ob-cc.ob-show{display:flex}
.ob-cccard{width:min(760px,96vw);max-height:92vh;overflow:auto;background:#0e1318;border:1px solid #2a3a4a;border-radius:12px;
  padding:18px;display:flex;flex-direction:column;gap:12px;color:#e8eef4;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.ob-cctitle{font-size:18px;color:#7fd3ff;letter-spacing:.04em}
.ob-cclabel{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7f93a8;margin-top:4px}
.ob-ccname{background:#0a0f14;border:1px solid #34506a;border-radius:8px;color:#e8eef4;padding:11px;font:inherit;font-size:16px}
.ob-ccname:focus{outline:none;border-color:#7fd3ff}
.ob-ccgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.ob-ccbg{text-align:left;background:#0c1620;border:2px solid #24384a;border-radius:8px;padding:10px;cursor:pointer;font:inherit;color:#e8eef4;display:flex;flex-direction:column;gap:4px}
.ob-ccbg:hover{border-color:#3a5a78}
.ob-ccbg.sel{border-color:#7fd3ff;background:#10202c}
.ob-ccbg b{font-size:13px}
.ob-ccblurb{font-size:11px;color:#9fb3c8;line-height:1.35}
.ob-ccperks{font-size:11px;color:#bfe9ff}
.ob-ccrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ob-ccsw{width:26px;height:26px;border-radius:50%;border:2px solid #34506a;cursor:pointer;padding:0}
.ob-ccsw.sel{border-color:#fff;box-shadow:0 0 0 2px #7fd3ff}
.ob-ccavatar{width:34px;height:34px;border-radius:50%;border:2px solid #0a0f14}
.ob-ccdiff{flex:1;min-width:70px;background:#16212c;border:1px solid #34506a;border-radius:8px;color:#e8eef4;padding:9px;font:inherit;font-size:13px;cursor:pointer}
.ob-ccdiff.sel{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}
.ob-ccload{font-size:11px;color:#9fb3c8;line-height:1.4}
.ob-ccfoot{display:flex;gap:10px;margin-top:6px}
.ob-ccrand{background:#2a3a4a;border:none;color:#cdd9e5;border-radius:8px;padding:11px 14px;font:inherit;font-weight:600;cursor:pointer}
.ob-ccbegin{flex:1;background:#1f6feb;border:none;color:#fff;border-radius:8px;padding:11px;font:inherit;font-weight:600;font-size:15px;cursor:pointer}
.ob-ccbegin:hover{background:#2a7bff}
`;

export class CharacterCreate {
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly bgGrid: HTMLDivElement;
  private readonly swatchRow: HTMLDivElement;
  private readonly avatar: HTMLDivElement;
  private readonly diffRow: HTMLDivElement;
  private readonly loadEl: HTMLDivElement;
  private readonly beginBtn: HTMLButtonElement;

  private onBegin?: (r: CreationResult) => void;
  private bg: BackgroundDef = BACKGROUNDS[0];
  private color = BACKGROUNDS[0].color;
  private diff = 1.0;
  private opened = false;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = el("div", "ob-cc");
    const card = el("div", "ob-cccard");

    card.append(text("ob-cctitle", "Create your survivor"));

    card.append(text("ob-cclabel", "Name"));
    this.nameInput = document.createElement("input");
    this.nameInput.className = "ob-ccname";
    this.nameInput.maxLength = 24;
    this.nameInput.placeholder = "Your name";
    this.nameInput.autocomplete = "off";
    this.nameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.begin();
    });
    card.append(this.nameInput);

    card.append(text("ob-cclabel", "Background"));
    this.bgGrid = el("div", "ob-ccgrid");
    card.append(this.bgGrid);
    this.loadEl = el("div", "ob-ccload");
    card.append(this.loadEl);

    card.append(text("ob-cclabel", "Appearance"));
    this.swatchRow = el("div", "ob-ccrow");
    this.avatar = el("div", "ob-ccavatar");
    const swWrap = el("div", "ob-ccrow");
    swWrap.append(this.avatar, this.swatchRow);
    card.append(swWrap);

    card.append(text("ob-cclabel", "Difficulty"));
    this.diffRow = el("div", "ob-ccrow");
    card.append(this.diffRow);

    const foot = el("div", "ob-ccfoot");
    const rand = document.createElement("button");
    rand.className = "ob-ccrand";
    rand.textContent = "Random";
    rand.addEventListener("click", () => this.randomize());
    this.beginBtn = document.createElement("button");
    this.beginBtn.className = "ob-ccbegin";
    this.beginBtn.textContent = "Begin";
    this.beginBtn.addEventListener("click", () => this.begin());
    foot.append(rand, this.beginBtn);
    card.append(foot);

    this.root.append(card);
    document.body.appendChild(this.root);
    this.buildStatic();
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(onBegin: (r: CreationResult) => void): void {
    this.onBegin = onBegin;
    this.opened = true;
    this.beginBtn.textContent = "Begin";
    this.beginBtn.disabled = false;
    this.root.classList.add("ob-show");
    this.render();
    this.nameInput.focus();
  }

  close(): void {
    this.opened = false;
    this.root.classList.remove("ob-show");
  }

  destroy(): void {
    this.root.remove();
  }

  // Build the static swatches + difficulty + background cards once.
  private buildStatic(): void {
    for (const c of SWATCHES) {
      const b = document.createElement("button");
      b.className = "ob-ccsw";
      b.style.background = css(c);
      b.dataset.color = String(c);
      b.addEventListener("click", () => {
        this.color = c;
        this.render();
      });
      this.swatchRow.append(b);
    }
    DIFFICULTIES.forEach((d) => {
      const b = document.createElement("button");
      b.className = "ob-ccdiff";
      b.textContent = d.label;
      b.dataset.mult = String(d.mult);
      b.addEventListener("click", () => {
        this.diff = d.mult;
        this.render();
      });
      this.diffRow.append(b);
    });
    for (const bg of BACKGROUNDS) {
      const card = document.createElement("button");
      card.className = "ob-ccbg";
      card.dataset.id = bg.id;
      const perks = bg.perks.map((p) => getPerk(p)?.name ?? p).join(" · ");
      const b = document.createElement("b");
      b.textContent = bg.name;
      const blurb = el("div", "ob-ccblurb");
      blurb.textContent = bg.blurb;
      const pk = el("div", "ob-ccperks");
      pk.textContent = "★ " + perks;
      card.append(b, blurb, pk);
      card.addEventListener("click", () => {
        this.bg = bg;
        this.color = bg.color;
        this.render();
      });
      this.bgGrid.append(card);
    }
  }

  private render(): void {
    for (const c of Array.from(this.bgGrid.children) as HTMLElement[]) {
      c.classList.toggle("sel", c.dataset.id === this.bg.id);
    }
    for (const s of Array.from(this.swatchRow.children) as HTMLElement[]) {
      s.classList.toggle("sel", Number(s.dataset.color) === this.color);
    }
    for (const d of Array.from(this.diffRow.children) as HTMLElement[]) {
      d.classList.toggle("sel", Number(d.dataset.mult) === this.diff);
    }
    this.avatar.style.background = css(this.color);
    const load = this.bg.items.map((it) => `${it.item}${it.qty > 1 ? ` ×${it.qty}` : ""}`).join(" · ");
    this.loadEl.textContent = `Loadout: ${load}`;
  }

  private randomize(): void {
    const rng = createRng(randomSeed());
    this.bg = randomBackground(rng);
    this.color = rng.chance(0.5) ? this.bg.color : (rng.pick(SWATCHES) as number);
    this.diff = 1.0;
    if (!this.nameInput.value.trim()) this.nameInput.value = rng.pick(NAMES);
    this.render();
  }

  private begin(): void {
    if (!this.opened) return;
    this.opened = false;
    this.beginBtn.textContent = "Entering the outbreak…";
    this.beginBtn.disabled = true;
    this.onBegin?.({
      name: this.nameInput.value.trim(),
      creation: { background: this.bg.id, color: this.color, difficulty: this.diff },
    });
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = className;
  return e;
}
function text(className: string, t: string): HTMLDivElement {
  const e = el("div", className);
  e.textContent = t;
  return e;
}
function css(c: number): string {
  return "#" + (c & 0xffffff).toString(16).padStart(6, "0");
}
