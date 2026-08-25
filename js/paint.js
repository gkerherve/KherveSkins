// The flat 64x64, and painting on it.
//
// The generator gets you ninety per cent of a person in one go and is
// hopeless at the last ten: an earring, a logo, the exact eye somebody
// recognises. So this is not a fallback for when the machine fails — it is
// the half of the tool that makes a skin yours, and it has to be usable with
// a thumb on a bus.
//
// One idea does most of the work: MIRROR. A body is symmetrical and a skin is
// not — the left arm lives at the bottom of the image, twenty-eight rows from
// the right one, facing the other way. Painting a sleeve stripe by hand on
// both is the sort of job that makes people give up halfway. Painting it once
// is the job.

import { regionAt, regions, regionMap, BASE } from './layout.js';
import { hexToRgb, rgbToHex, shade } from './pixels.js';

const TWIN = { armR: 'armL', armL: 'armR', legR: 'legL', legL: 'legR', head: 'head', body: 'body' };
const FLIP = { right: 'left', left: 'right', front: 'front', back: 'back', top: 'top', bottom: 'bottom' };

/** The texel on the other side of the body, or null if there is not one. */
export function mirrorOf(x, y, slim = false, size = BASE) {
  const r = regionAt(x, y, slim, size);
  if (!r) return null;
  const twin = TWIN[r.part];
  const face = FLIP[r.face];
  const other = regions(slim, size).find(
    (q) => q.part === twin && q.face === face && q.layer === r.layer,
  );
  if (!other) return null;
  const [sx, sy, sw] = r.rect;
  const [dx, dy, dw] = other.rect;
  const u = x - sx, v = y - sy;
  if (dw !== sw) return null;
  return { x: dx + (dw - 1 - u), y: dy + v };
}

export class Painter {
  constructor(canvas, skin, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.skin = skin;
    this.slim = !!opts.slim;
    // `size` is the IMAGE's edge; the brush has its own name, because the two
    // being called the same thing is how a two-pixel brush ends up painting
    // a two-hundred-and-fifty-six-pixel square
    this.size = skin.size || BASE;
    this.tool = 'brush';
    this.colour = '#c23a2e';
    this.brush = 1;
    this.mirror = true;
    this.layer = 'both';
    this.grid = true;
    this.zoom = 8;
    this.pan = { x: 0, y: 0 };
    this.undoStack = [];
    this.redoStack = [];
    this.onEdit = opts.onEdit || (() => {});
    this.onPick = opts.onPick || (() => {});
    // Painting has to OUTLIVE the generator. Every texel laid by hand is
    // reported here so the app can keep its own record of it and lay it back
    // down after the next slider move rebuilds the face underneath.
    this.onWrite = opts.onWrite || (() => {});
    this.getExtra = opts.getExtra || (() => null);
    this.setExtra = opts.setExtra || (() => {});
    this.hover = null;
    this.painting = false;
    this.dragging = false;
    this.pointers = new Map();
    this.pinch = 0;
    this.wire(canvas);
    this.fit();
  }

  wire(canvas) {
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * canvas.width / r.width,
        y: (e.clientY - r.top) * canvas.height / r.height,
      };
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const at = pos(e);
      this.pointers.set(e.pointerId, at);
      // Middle button, right button or the Move tool all mean the same thing:
      // this drag moves the picture rather than marking it. Decided once, on
      // the way down, so a stroke never turns into a pan half way through.
      this.dragging = e.button === 1 || e.button === 2 || this.tool === 'pan';
      if (this.pointers.size === 1 && !this.dragging) {
        this.begin();
        this.stroke(at, e);
      }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      const prev = this.pointers.get(e.pointerId);
      if (prev) this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        // two fingers: shove the picture about and pinch it
        this.painting = false;
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinch) {
          const k = d / this.pinch;
          const before = this.toTexel(mid);
          this.zoom = Math.max(0.4, Math.min(40, this.zoom * k));
          const after = this.toTexel(mid);
          this.pan.x += (after.fx - before.fx) * this.zoom;
          this.pan.y += (after.fy - before.fy) * this.zoom;
        }
        this.pinch = d;
        if (this.lastMid) {
          this.pan.x += mid.x - this.lastMid.x;
          this.pan.y += mid.y - this.lastMid.y;
        }
        this.lastMid = mid;
        this.redraw();
        return;
      }
      this.hover = this.toTexel(p);
      if (this.dragging && prev) {
        this.pan.x += p.x - prev.x;
        this.pan.y += p.y - prev.y;
        this.redraw();
        return;
      }
      if (this.painting && prev) this.stroke(p, e);
      else this.redraw();
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) { this.pinch = 0; this.lastMid = null; }
      if (!this.pointers.size) { this.painting = false; this.dragging = false; }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.redraw(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const before = this.toTexel(p);
      this.zoom = Math.max(0.4, Math.min(40, this.zoom * (1 - Math.sign(e.deltaY) * 0.14)));
      const after = this.toTexel(p);
      this.pan.x += (after.fx - before.fx) * this.zoom;
      this.pan.y += (after.fy - before.fy) * this.zoom;
      this.redraw();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  fit() {
    const c = this.canvas;
    this.size = this.skin.size || BASE;
    const n = this.size;
    this.zoom = Math.max(0.5, Math.min(c.width, c.height) / (n + 2));
    this.pan.x = (c.width - n * this.zoom) / 2;
    this.pan.y = (c.height - n * this.zoom) / 2;
    this.redraw();
  }

  /** Zoom about the middle of the view, for the + and − buttons. */
  zoomBy(k) {
    const c = this.canvas;
    const mid = { x: c.width / 2, y: c.height / 2 };
    const before = this.toTexel(mid);
    this.zoom = Math.max(0.4, Math.min(48, this.zoom * k));
    const after = this.toTexel(mid);
    this.pan.x += (after.fx - before.fx) * this.zoom;
    this.pan.y += (after.fy - before.fy) * this.zoom;
    this.redraw();
  }

  /**
   * Put one rectangle of the image in the middle of the view, big.
   *
   * The single most useful way to get about a skin: nobody hunts for the back
   * of the left calf by dragging, they pick it off a list. A little margin
   * round it so the neighbouring faces stay visible — an ear is easier to
   * paint when you can see where the cheek stops.
   */
  focus(rect) {
    const c = this.canvas;
    const [x, y, w, h] = rect;
    const pad = 1.9;
    this.zoom = Math.max(0.4, Math.min(48, Math.min(c.width / (w * pad), c.height / (h * pad))));
    this.pan.x = c.width / 2 - (x + w / 2) * this.zoom;
    this.pan.y = c.height / 2 - (y + h / 2) * this.zoom;
    this.redraw();
  }

  toTexel(p) {
    const fx = (p.x - this.pan.x) / this.zoom;
    const fy = (p.y - this.pan.y) / this.zoom;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  }

  begin() {
    this.painting = true;
    this.undoStack.push({ bytes: this.skin.snapshot(), extra: this.getExtra() });
    if (this.undoStack.length > 48) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push({ bytes: this.skin.snapshot(), extra: this.getExtra() });
    const was = this.undoStack.pop();
    this.skin.restore(was.bytes);
    this.setExtra(was.extra);
    this.redraw();
    this.onEdit();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push({ bytes: this.skin.snapshot(), extra: this.getExtra() });
    const was = this.redoStack.pop();
    this.skin.restore(was.bytes);
    this.setExtra(was.extra);
    this.redraw();
    this.onEdit();
    return true;
  }

  /** Whether a texel may be touched, given the layer filter. */
  allowed(x, y) {
    const r = regionAt(x, y, this.slim, this.size);
    if (!r) return false;
    if (this.layer === 'both') return true;
    return r.layer === this.layer;
  }

  stroke(p, e) {
    if (this.tool === 'pan') return;
    const t = this.toTexel(p);
    if (this.tool === 'pick') {
      const c = this.skin.get(t.x, t.y);
      if (c[3] > 0) {
        this.colour = rgbToHex(c);
        this.onPick(this.colour);
      }
      this.painting = false;
      this.redraw();
      return;
    }
    if (this.tool === 'fill') {
      this.flood(t.x, t.y);
      this.painting = false;
      this.redraw();
      this.onEdit();
      return;
    }
    const erase = this.tool === 'erase' || e.buttons === 2 || e.shiftKey;
    const r = this.brush - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        this.put(t.x + dx, t.y + dy, erase);
      }
    }
    this.redraw();
    this.onEdit();
  }

  put(x, y, erase) {
    if (!this.allowed(x, y)) return;
    let c;
    if (erase) c = [0, 0, 0, 0];
    else if (this.tool === 'light') c = shade(this.skin.get(x, y), 1.14);
    else if (this.tool === 'dark') c = shade(this.skin.get(x, y), 0.86);
    else c = hexToRgb(this.colour);
    if ((this.tool === 'light' || this.tool === 'dark') && this.skin.get(x, y)[3] === 0) return;
    this.skin.set(x, y, c);
    this.onWrite(x, y, c);
    if (this.mirror) {
      const m = mirrorOf(x, y, this.slim, this.size);
      if (m) { this.skin.set(m.x, m.y, c); this.onWrite(m.x, m.y, c); }
    }
  }

  /** Flood, stopped by the edge of the face it started in. */
  flood(x, y) {
    const start = regionAt(x, y, this.slim, this.size);
    if (!start || !this.allowed(x, y)) return;
    const target = this.skin.get(x, y);
    const paint = hexToRgb(this.colour);
    const same = (c) => Math.abs(c[0] - target[0]) < 10 && Math.abs(c[1] - target[1]) < 10
      && Math.abs(c[2] - target[2]) < 10 && Math.abs(c[3] - target[3]) < 10;
    if (same(paint)) return;
    const [rx, ry, rw, rh] = start.rect;
    const stack = [[x, y]];
    const done = new Set();
    while (stack.length) {
      const [px, py] = stack.pop();
      if (px < rx || py < ry || px >= rx + rw || py >= ry + rh) continue;
      const key = py * this.size + px;
      if (done.has(key)) continue;
      done.add(key);
      if (!same(this.skin.get(px, py))) continue;
      this.skin.set(px, py, paint);
      this.onWrite(px, py, paint);
      if (this.mirror) {
        const m = mirrorOf(px, py, this.slim, this.size);
        if (m) { this.skin.set(m.x, m.y, paint); this.onWrite(m.x, m.y, paint); }
      }
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  }

  /** Wipe one part back to nothing, both layers. */
  clearPart(key) {
    this.begin();
    for (const r of regions(this.slim, this.size)) {
      if (r.part !== key) continue;
      this.skin.fillRect(r.rect, [0, 0, 0, 0]);
      for (let v = 0; v < r.rect[3]; v++) {
        for (let u = 0; u < r.rect[2]; u++) this.onWrite(r.rect[0] + u, r.rect[1] + v, [0, 0, 0, 0]);
      }
    }
    this.painting = false;
    this.redraw();
    this.onEdit();
  }

  /** The chequerboard, as a repeating pattern rather than ten thousand squares. */
  chequer(ctx) {
    if (!this._chequer) {
      const t = document.createElement('canvas');
      t.width = 16; t.height = 16;
      const tc = t.getContext('2d');
      tc.fillStyle = '#141b2d';
      tc.fillRect(0, 0, 16, 16);
      tc.fillStyle = '#1b2338';
      tc.fillRect(0, 0, 8, 8);
      tc.fillRect(8, 8, 8, 8);
      this._chequer = ctx.createPattern(t, 'repeat');
    }
    return this._chequer;
  }

  /** The parts of the image no model ever reads, as one stampable picture. */
  deadMask() {
    const key = `${this.slim ? 1 : 0}:${this.size}`;
    if (this._deadKey === key) return this._dead;
    const n = this.size;
    const map = regionMap(this.slim, n);
    const cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      if (map[i] >= 0) continue;
      const k = i * 4;
      img.data[k] = 8; img.data[k + 1] = 12; img.data[k + 2] = 22; img.data[k + 3] = 184;
    }
    cx.putImageData(img, 0, 0);
    this._deadKey = key;
    this._dead = cv;
    return cv;
  }

  redraw() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const z = this.zoom;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0d1424';
    c.fillRect(0, 0, W, H);

    // the chequer, so a transparent texel reads as transparent and not black
    const n = this.size;
    c.save();
    c.beginPath();
    c.rect(this.pan.x, this.pan.y, n * z, n * z);
    c.clip();
    c.fillStyle = this.chequer(c);
    c.fillRect(this.pan.x, this.pan.y, n * z, n * z);
    c.restore();

    c.imageSmoothingEnabled = false;
    c.drawImage(this.skin.flush(), this.pan.x, this.pan.y, n * z, n * z);

    // the parts of the image no model ever reads, struck out
    // Painted once into an image of its own and stamped, rather than drawn
    // texel by texel. At 256 that loop was sixty-five thousand canvas calls
    // EVERY redraw, which is a redraw that takes seconds, which is a brush
    // that does not follow your finger.
    c.imageSmoothingEnabled = false;
    c.drawImage(this.deadMask(), this.pan.x, this.pan.y, n * z, n * z);
    // and the layer that is not being worked on, dimmed
    if (this.layer !== 'both') {
      c.fillStyle = 'rgba(10,14,26,.55)';
      for (const r of regions(this.slim, n)) {
        if (r.layer === this.layer) continue;
        c.fillRect(this.pan.x + r.rect[0] * z, this.pan.y + r.rect[1] * z, r.rect[2] * z, r.rect[3] * z);
      }
    }

    if (this.grid && z >= 5) {
      c.strokeStyle = 'rgba(255,255,255,.07)';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        c.moveTo(this.pan.x + i * z, this.pan.y);
        c.lineTo(this.pan.x + i * z, this.pan.y + n * z);
      }
      for (let j = 0; j <= n; j++) {
        c.moveTo(this.pan.x, this.pan.y + j * z);
        c.lineTo(this.pan.x + n * z, this.pan.y + j * z);
      }
      c.stroke();
    }

    // every face outlined: without this the image is a puzzle
    c.strokeStyle = 'rgba(127,196,255,.42)';
    c.lineWidth = 1.5;
    for (const r of regions(this.slim, n)) {
      c.strokeRect(this.pan.x + r.rect[0] * z + 0.5, this.pan.y + r.rect[1] * z + 0.5,
        r.rect[2] * z - 1, r.rect[3] * z - 1);
    }

    if (this.hover && this.allowed(this.hover.x, this.hover.y)) {
      const r = this.brush - 1;
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.strokeRect(this.pan.x + (this.hover.x - r) * z, this.pan.y + (this.hover.y - r) * z,
        z * (r * 2 + 1), z * (r * 2 + 1));
      if (this.mirror) {
        const m = mirrorOf(this.hover.x, this.hover.y, this.slim, n);
        if (m) {
          c.strokeStyle = 'rgba(255,209,102,.8)';
          c.strokeRect(this.pan.x + m.x * z, this.pan.y + m.y * z, z, z);
        }
      }
    }
  }

  /** What is under the pointer, in words, for the status line. */
  describe() {
    if (!this.hover) return '';
    const r = regionAt(this.hover.x, this.hover.y, this.slim, this.size);
    if (!r) return `${this.hover.x}, ${this.hover.y} — unused`;
    return `${this.hover.x}, ${this.hover.y} — ${r.name} ${r.face}${r.layer === 'over' ? ' (outer)' : ''}`;
  }
}
