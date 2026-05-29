// On-screen touch controls so OUTBREAK is playable on phones/tablets (the goal:
// runs on ANY device). A drag joystick (push to the edge to sprint) + Act/Hit
// buttons. Shown only on coarse-pointer (touch) devices; desktop uses the keyboard.

const STYLE_ID = "ob-touch-style";
const RADIUS = 60;
const CSS = `
.ob-touch{position:fixed;inset:0;z-index:40;pointer-events:none;touch-action:none;display:none}
.ob-touch.ob-on{display:block}
.ob-stick{position:absolute;left:22px;bottom:22px;width:130px;height:130px;border-radius:50%;
  background:rgba(18,28,38,.34);border:2px solid rgba(127,211,255,.35);pointer-events:auto;touch-action:none}
.ob-thumb{position:absolute;left:38px;top:38px;width:54px;height:54px;border-radius:50%;
  background:rgba(127,211,255,.55);border:2px solid rgba(255,255,255,.5)}
.ob-tbtns{position:absolute;right:22px;bottom:30px;display:flex;flex-direction:column;gap:14px;align-items:flex-end}
.ob-tbtn{pointer-events:auto;touch-action:none;width:84px;height:84px;border-radius:50%;
  background:rgba(31,111,235,.5);border:2px solid rgba(255,255,255,.45);color:#fff;
  font:600 15px ui-monospace,monospace;display:flex;align-items:center;justify-content:center;user-select:none}
.ob-tbtn.ob-hit{background:rgba(214,70,70,.5);width:72px;height:72px}
`;

export class TouchControls {
  readonly active: boolean;
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private readonly actBtn: HTMLDivElement;
  private readonly hitBtn: HTMLDivElement;
  private readonly vec = { x: 0, y: 0 };
  private mag = 0;
  private stickId: number | null = null;
  private onAct?: () => void;
  private onHit?: () => void;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.active = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

    this.root = div("ob-touch");
    if (this.active) this.root.classList.add("ob-on");
    this.base = div("ob-stick");
    this.thumb = div("ob-thumb");
    this.base.appendChild(this.thumb);
    const btns = div("ob-tbtns");
    this.actBtn = div("ob-tbtn");
    this.actBtn.textContent = "ACT";
    this.hitBtn = div("ob-tbtn ob-hit");
    this.hitBtn.textContent = "HIT";
    btns.append(this.actBtn, this.hitBtn);
    this.root.append(this.base, btns);
    document.body.appendChild(this.root);

    if (this.active) this.bind();
  }

  setHandlers(onAct: () => void, onHit: () => void): void {
    this.onAct = onAct;
    this.onHit = onHit;
  }

  vector(): { x: number; y: number } {
    return this.vec;
  }

  get sprintHeld(): boolean {
    return this.mag > 0.9;
  }

  destroy(): void {
    this.root.remove();
  }

  private bind(): void {
    const move = (cx: number, cy: number): void => {
      const r = this.base.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      const a = Math.atan2(cy - oy, cx - ox);
      const d = Math.min(Math.hypot(cx - ox, cy - oy), RADIUS);
      const tx = Math.cos(a) * d;
      const ty = Math.sin(a) * d;
      this.thumb.style.transform = `translate(${tx}px, ${ty}px)`;
      this.vec.x = tx / RADIUS;
      this.vec.y = ty / RADIUS;
      this.mag = d / RADIUS;
    };
    const reset = (e: PointerEvent): void => {
      if (this.stickId !== e.pointerId) return;
      this.stickId = null;
      this.vec.x = 0;
      this.vec.y = 0;
      this.mag = 0;
      this.thumb.style.transform = "translate(0,0)";
    };
    this.base.addEventListener("pointerdown", (e) => {
      this.stickId = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      move(e.clientX, e.clientY);
    });
    this.base.addEventListener("pointermove", (e) => {
      if (this.stickId === e.pointerId) move(e.clientX, e.clientY);
    });
    this.base.addEventListener("pointerup", reset);
    this.base.addEventListener("pointercancel", reset);

    this.actBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onAct?.();
    });
    this.hitBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onHit?.();
    });
  }
}

function div(className: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = className;
  return e;
}
