// Where the head is, and where its eyes are: the one thing the machine must
// be told when it guesses wrong.
//
// Everything else in this program is a slider you can ignore. This is not.
// An automatic face-finder is right most of the time and catastrophically
// wrong the rest — a hand read as a chin, a shoulder read as a jaw — and the
// difference between a tool that works and a toy is whether the person using
// it can say "no, THERE" in one drag.
//
// So the box is a handle, not an answer, and the two lines across it matter
// more than the box does: the sampler pins them to whole texel rows, so
// moving the eye line half a centimetre is what turns a beige smudge into a
// face.

const HANDLE = 11;          // grab radius in screen pixels, sized for a thumb

export class Cropper {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.photo = null;
    this.frame = null;
    this.grab = null;
    this.view = { s: 1, ox: 0, oy: 0 };
    this.showGrid = true;

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * canvas.width / r.width,
        y: (e.clientY - r.top) * canvas.height / r.height };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.frame) return;
      canvas.setPointerCapture(e.pointerId);
      this.grab = this.hit(pos(e));
      if (this.grab) e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.grab) {
        canvas.style.cursor = this.frame && this.hit(pos(e)) ? 'grab' : 'default';
        return;
      }
      e.preventDefault();
      this.drag(pos(e));
      this.draw();
      this.onChange(this.frame);
    });
    const stop = () => { this.grab = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  setPhoto(photo) {
    this.photo = photo;
    this.fit();
  }

  setFrame(frame) {
    this.frame = frame ? { ...frame } : null;
    this.draw();
  }

  /** Fit the picture to the canvas; everything else works in photo pixels. */
  fit() {
    const c = this.canvas;
    if (!this.photo) return;
    const s = Math.min(c.width / this.photo.w, c.height / this.photo.h);
    this.view = {
      s,
      ox: (c.width - this.photo.w * s) / 2,
      oy: (c.height - this.photo.h * s) / 2,
    };
  }

  toScreen(x, y) {
    return [this.view.ox + x * this.view.s, this.view.oy + y * this.view.s];
  }

  toPhoto(x, y) {
    return [(x - this.view.ox) / this.view.s, (y - this.view.oy) / this.view.s];
  }

  /** Which part of the frame a press landed on. */
  hit(p) {
    const f = this.frame;
    const r = HANDLE * this.canvas.width / this.canvas.getBoundingClientRect().width;
    const corners = {
      nw: [f.x, f.y], ne: [f.x + f.w, f.y],
      sw: [f.x, f.y + f.h], se: [f.x + f.w, f.y + f.h],
    };
    for (const [k, [cx, cy]] of Object.entries(corners)) {
      const [sx, sy] = this.toScreen(cx, cy);
      if (Math.hypot(p.x - sx, p.y - sy) < r * 1.6) return { kind: k };
    }
    // the two eye pins sit ON the eye line and are grabbed first, or the
    // line itself would swallow every press meant for them
    for (const key of ['eyeL', 'eyeR']) {
      if (f[key] === null || f[key] === undefined) continue;
      const [sx, sy] = this.toScreen(f[key], f.eye);
      if (Math.hypot(p.x - sx, p.y - sy) < r * 1.4) return { kind: key };
    }
    for (const line of ['eye', 'mouth']) {
      const [, sy] = this.toScreen(0, f[line]);
      const [lx] = this.toScreen(f.x + f.w, 0);
      if (Math.abs(p.y - sy) < r && p.x > this.toScreen(f.x, 0)[0] - r * 2 && p.x < lx + r * 2) {
        return { kind: line };
      }
    }
    const [x0, y0] = this.toScreen(f.x, f.y);
    const [x1, y1] = this.toScreen(f.x + f.w, f.y + f.h);
    if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) {
      const [px, py] = this.toPhoto(p.x, p.y);
      return { kind: 'move', dx: px - f.x, dy: py - f.y };
    }
    return null;
  }

  drag(p) {
    const f = this.frame;
    const [px, py] = this.toPhoto(p.x, p.y);
    const min = 24;
    const g = this.grab;
    if (g.kind === 'move') {
      const nx = px - g.dx, ny = py - g.dy;
      // the lines and the pins ride with the box, or moving it re-reads a
      // different face
      f.eye += ny - f.y;
      f.mouth += ny - f.y;
      if (f.eyeL !== null && f.eyeL !== undefined) f.eyeL += nx - f.x;
      if (f.eyeR !== null && f.eyeR !== undefined) f.eyeR += nx - f.x;
      f.x = nx; f.y = ny;
    } else if (g.kind === 'eyeL') {
      f.eyeL = Math.min(Math.max(px, f.x + f.w * 0.06), f.x + f.w * 0.46);
    } else if (g.kind === 'eyeR') {
      f.eyeR = Math.max(Math.min(px, f.x + f.w * 0.94), f.x + f.w * 0.54);
    } else if (g.kind === 'eye') {
      f.eye = Math.min(Math.max(py, f.y + 4), f.mouth - 4);
    } else if (g.kind === 'mouth') {
      f.mouth = Math.min(Math.max(py, f.eye + 4), f.y + f.h - 2);
    } else {
      const right = g.kind.endsWith('e');
      const bottom = g.kind.startsWith('s');
      const x1 = right ? Math.max(px, f.x + min) : f.x + f.w;
      const x0 = right ? f.x : Math.min(px, f.x + f.w - min);
      const y1 = bottom ? Math.max(py, f.y + min) : f.y + f.h;
      const y0 = bottom ? f.y : Math.min(py, f.y + f.h - min);
      // keep the two lines where they sit in the head, proportionally
      const ke = (f.eye - f.y) / f.h, km = (f.mouth - f.y) / f.h;
      const kl = f.eyeL == null ? null : (f.eyeL - f.x) / f.w;
      const kr = f.eyeR == null ? null : (f.eyeR - f.x) / f.w;
      f.x = x0; f.w = x1 - x0; f.y = y0; f.h = y1 - y0;
      f.eye = f.y + ke * f.h;
      f.mouth = f.y + km * f.h;
      if (kl !== null) f.eyeL = f.x + kl * f.w;
      if (kr !== null) f.eyeR = f.x + kr * f.w;
    }
  }

  draw() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    if (!this.photo) {
      c.fillStyle = '#141a2c';
      c.fillRect(0, 0, W, H);
      return;
    }
    c.imageSmoothingEnabled = true;
    const [ox, oy] = [this.view.ox, this.view.oy];
    c.drawImage(this.photo.canvas, ox, oy, this.photo.w * this.view.s, this.photo.h * this.view.s);
    const f = this.frame;
    if (!f) return;
    const [x0, y0] = this.toScreen(f.x, f.y);
    const w = f.w * this.view.s, h = f.h * this.view.s;

    // everything outside the head, dimmed — the eye goes to what is left
    c.save();
    c.fillStyle = 'rgba(6, 10, 22, .62)';
    c.beginPath();
    c.rect(0, 0, W, H);
    c.rect(x0, y0, w, h);
    c.fill('evenodd');
    c.restore();

    // the eight rows the face will actually be cut into
    if (this.showGrid) {
      c.strokeStyle = 'rgba(255,255,255,.16)';
      c.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        c.beginPath();
        c.moveTo(x0 + w * i / 8, y0);
        c.lineTo(x0 + w * i / 8, y0 + h);
        c.stroke();
      }
    }

    c.strokeStyle = '#7fc4ff';
    c.lineWidth = 2;
    c.strokeRect(x0, y0, w, h);

    const line = (y, colour, label) => {
      const [, sy] = this.toScreen(0, y);
      c.strokeStyle = colour;
      c.setLineDash([7, 5]);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x0 - 8, sy);
      c.lineTo(x0 + w + 8, sy);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = colour;
      c.beginPath();
      c.arc(x0 + w + 14, sy, 6, 0, Math.PI * 2);
      c.fill();
      c.font = '600 12px system-ui, sans-serif';
      c.fillText(label, x0 + w + 24, sy + 4);
    };
    line(f.eye, '#ffd166', 'eyes');
    line(f.mouth, '#ff8fa3', 'mouth');

    // the two pins: which column of the eight each eye will land in
    for (const key of ['eyeL', 'eyeR']) {
      if (f[key] === null || f[key] === undefined) continue;
      const [sx, sy] = this.toScreen(f[key], f.eye);
      c.fillStyle = '#0b1020';
      c.strokeStyle = '#ffd166';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(sx, sy, 7, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    c.fillStyle = '#7fc4ff';
    for (const [cx, cy] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]) {
      c.beginPath();
      c.arc(cx, cy, 7, 0, Math.PI * 2);
      c.fill();
    }
  }
}
