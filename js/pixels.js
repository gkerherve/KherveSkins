// The 64x64 itself: a buffer of texels, and everything that writes to it.
//
// One object owns the image. The generator fills it from a photograph, the
// painter pokes single texels into it, the model reads it as a texture and
// the exporter turns it into a PNG — and all four go through here, so there
// is exactly one place that knows whether the picture on screen is current.

import { SKIN_W, SKIN_H, boxRects, FACES } from './layout.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** #rrggbb (or #rgb) to [r,g,b,a]. */
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** [r,g,b] to #rrggbb. */
export function rgbToHex(c) {
  const h = (v) => clamp255(v).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

/** Perceived brightness, 0..255. Green carries most of it, as the eye does. */
export function luma(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** A colour multiplied toward black, or lifted toward white above 1. */
export function shade(c, k) {
  if (k >= 1) {
    const t = Math.min(k - 1, 1);
    return [
      clamp255(c[0] + (255 - c[0]) * t * 0.75),
      clamp255(c[1] + (255 - c[1]) * t * 0.75),
      clamp255(c[2] + (255 - c[2]) * t * 0.75),
      c[3] === undefined ? 255 : c[3],
    ];
  }
  return [clamp255(c[0] * k), clamp255(c[1] * k), clamp255(c[2] * k),
    c[3] === undefined ? 255 : c[3]];
}

/** Straight blend; `t` of 0 is all `a`. */
export function mix(a, b, t) {
  const u = clamp(t, 0, 1);
  const aa = a[3] === undefined ? 255 : a[3];
  const ba = b[3] === undefined ? 255 : b[3];
  return [
    clamp255(a[0] + (b[0] - a[0]) * u),
    clamp255(a[1] + (b[1] - a[1]) * u),
    clamp255(a[2] + (b[2] - a[2]) * u),
    clamp255(aa + (ba - aa) * u),
  ];
}

/** How far apart two colours are, roughly as the eye sees it. */
export function dist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** rgb to hsl, all 0..1. */
export function toHsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/** hsl back to rgb. */
export function fromHsl(h, s, l, a = 255) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const m = s * Math.min(l, 1 - l);
    return clamp255(255 * (l - m * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4), a];
}

/**
 * A skin: 64x64 RGBA, plus the canvas everything else reads it through.
 *
 * Nothing here knows what a face or a sleeve is — that is `layout.js`. This
 * is the paper.
 */
export class Skin {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SKIN_W;
    this.canvas.height = SKIN_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.img = this.ctx.createImageData(SKIN_W, SKIN_H);
    this.dirty = true;
    this.version = 0;
  }

  clear() {
    this.img.data.fill(0);
    this.touch();
  }

  touch() {
    this.dirty = true;
    this.version++;
  }

  /** Push the buffer onto its canvas. Called by whoever is about to look. */
  flush() {
    if (this.dirty) {
      this.ctx.putImageData(this.img, 0, 0);
      this.dirty = false;
    }
    return this.canvas;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= SKIN_W || y >= SKIN_H) return [0, 0, 0, 0];
    const i = (y * SKIN_W + x) * 4;
    const d = this.img.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  set(x, y, c) {
    if (!c || x < 0 || y < 0 || x >= SKIN_W || y >= SKIN_H) return;
    const i = (y * SKIN_W + x) * 4;
    const d = this.img.data;
    d[i] = clamp255(c[0]);
    d[i + 1] = clamp255(c[1]);
    d[i + 2] = clamp255(c[2]);
    d[i + 3] = c[3] === undefined ? 255 : clamp255(c[3]);
    this.touch();
  }

  fillRect(rect, c) {
    const [x, y, w, h] = rect;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Run `fn(u, v, current, w, h)` over a rectangle; a returned colour lands. */
  mapRect(rect, fn) {
    const [x, y, w, h] = rect;
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const c = fn(u, v, this.get(x + u, y + v), w, h);
        if (c) this.set(x + u, y + v, c);
      }
    }
  }

  /** Copy one rectangle onto another, optionally mirrored left to right. */
  copyRect(from, to, flip = false) {
    const [sx, sy, w, h] = from;
    const [dx, dy] = to;
    const buf = [];
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) buf.push(this.get(sx + u, sy + v));
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        this.set(dx + u, dy + v, buf[v * w + (flip ? w - 1 - u : u)]);
      }
    }
  }

  clone() {
    const s = new Skin();
    s.img.data.set(this.img.data);
    s.touch();
    return s;
  }

  copyFrom(other) {
    this.img.data.set(other.img ? other.img.data : other);
    this.touch();
  }

  /** The bytes, for undo. */
  snapshot() {
    return new Uint8ClampedArray(this.img.data);
  }

  restore(bytes) {
    this.img.data.set(bytes);
    this.touch();
  }

  toDataURL() {
    return this.flush().toDataURL('image/png');
  }

  toBlob() {
    return new Promise((res) => this.flush().toBlob(res, 'image/png'));
  }

  /**
   * Read an image in as a skin.
   *
   * A 64x32 is the old format — head, body, and one arm and one leg the game
   * used for both sides. Widened here rather than at render time, so
   * everything downstream only ever sees one layout.
   */
  fromImage(image) {
    const c = document.createElement('canvas');
    c.width = SKIN_W; c.height = SKIN_H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = false;
    const legacy = image.height * 2 === image.width;
    const rows = legacy ? 32 : Math.min(64, Math.round(image.height * 64 / image.width));
    cx.drawImage(image, 0, 0, image.width, image.height, 0, 0, 64, rows);
    this.img = cx.getImageData(0, 0, SKIN_W, SKIN_H);
    this.touch();
    if (legacy) this.widenLegacy();
    return this;
  }

  /** 64x32's single arm and leg, mirrored onto the sides that format lacked. */
  widenLegacy() {
    const pairs = [
      [boxRects(40, 16, 4, 12, 4), boxRects(32, 48, 4, 12, 4)],
      [boxRects(0, 16, 4, 12, 4), boxRects(16, 48, 4, 12, 4)],
    ];
    // a mirrored limb swaps its own left and right as well as flipping
    const map = { top: 'top', bottom: 'bottom', front: 'front', back: 'back', right: 'left', left: 'right' };
    for (const [src, dst] of pairs) {
      for (const f of FACES) this.copyRect(src[f], dst[map[f]], true);
    }
    this.touch();
  }
}

/** Load a File, Blob or URL into an image that is ready to draw. */
export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('that file is not an image this browser can read'));
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

/**
 * A repeatable little noise source.
 *
 * The grain on a sleeve has to be the SAME grain every time the same photo is
 * built with the same settings, or a slider you nudge and put back leaves you
 * with a different skin than the one you started with.
 */
export function rng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}
