// Reader overlay (Expansion U2): shows a found note / journal page / stash map
// as a worn paper card. Pure presentation — the scene decides what reading DOES
// (flavour, or pinning a stash) before opening this.

const STYLE_ID = "ob-reader-style";
const CSS = `
.ob-reader{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;
  background:rgba(4,6,9,.6);font-family:ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
.ob-reader.ob-show{display:flex;animation:ob-rfade .15s ease}
@keyframes ob-rfade{from{opacity:0}to{opacity:1}}
.ob-paper{position:relative;width:min(440px,92vw);max-height:80vh;overflow:auto;color:#2b2417;
  background:linear-gradient(173deg,#e9dfc6,#d8cba8 70%,#cdbf9a);border-radius:6px;padding:26px 24px 20px;
  box-shadow:0 18px 60px rgba(0,0,0,.65), inset 0 0 38px rgba(120,95,50,.25);
  transform:rotate(-0.6deg)}
.ob-paper::before{content:"";position:absolute;inset:8px;border:1px dashed rgba(90,70,40,.3);border-radius:4px;pointer-events:none}
.ob-rtitle{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#7a6336;margin-bottom:10px}
.ob-rbody{font-size:14px;line-height:1.65;white-space:pre-wrap}
.ob-rhint{margin-top:14px;font-size:11px;color:#8a7450}
.ob-rx{position:absolute;top:8px;right:12px;background:none;border:none;color:#7a6336;font:inherit;font-size:18px;cursor:pointer}
`;

export class ReaderModal {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private opened = false;
  private onCloseCb?: () => void;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement("div");
    this.root.className = "ob-reader";
    const paper = document.createElement("div");
    paper.className = "ob-paper";
    const x = document.createElement("button");
    x.className = "ob-rx";
    x.textContent = "×";
    x.addEventListener("click", () => this.close());
    this.titleEl = document.createElement("div");
    this.titleEl.className = "ob-rtitle";
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "ob-rbody";
    const hint = document.createElement("div");
    hint.className = "ob-rhint";
    hint.textContent = "ESC to put it away";
    paper.append(x, this.titleEl, this.bodyEl, hint);
    this.root.append(paper);
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
    document.body.appendChild(this.root);
    // Capture phase so ESC closes ONLY the reader, not the bag underneath it.
    window.addEventListener("keydown", this.onKey, true);
  }

  isOpen(): boolean {
    return this.opened;
  }

  setOnClose(fn: () => void): void {
    this.onCloseCb = fn;
  }

  open(title: string, body: string): void {
    this.titleEl.textContent = title;
    this.bodyEl.textContent = body;
    this.opened = true;
    this.root.classList.add("ob-show");
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove("ob-show");
    this.onCloseCb?.();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey, true);
    this.root.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.close();
    }
  };
}
