// What makes a garment look like a garment.
//
// The first wardrobe painted every top as a rectangle of one colour with a
// neckline cut out of it, and at forty pixels that reads as a colour swatch
// with a person behind it. Minecraft's own clothes do not look like that, and
// the difference is not detail for its own sake — it is four specific things,
// and every one of them is one line of arithmetic:
//
//   the weave    cloth is not flat. Denim has vertical streaks, knit has a
//                two-by-two blocky grain, leather has dark speckle with a
//                sheen on it, metal has a bright band down the middle.
//   the light    it comes from above. Every panel is a shade darker at the
//                hem than at the shoulder, and a torso curves away at its
//                sides.
//   the print    stripes, hoops, plaid, camouflage — a SECOND colour, not a
//                shade of the first, because that is what dye does.
//   the edges    a hem, a cuff, a collar and a seam are each one line of
//                pixels in a darker tone, and they are most of what tells a
//                jumper from a t-shirt at this size.
//
// Everything here works in FRACTIONS of the panel it is drawn on, so one
// wardrobe fits a 64 and a 256, and every random number is hashed off the
// position so a garment is the same garment every time it is drawn — the
// thumbnail in the grid has to be the thing that lands on the figure.

import { shade, mix, clamp255 } from './pixels.js';

/** A repeatable scatter, by position. */
export function jitter(u, v, salt = 0) {
  let n = (u * 374761393 + v * 668265263 + salt * 2246822519) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

export const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];

// ---------------------------------------------------------------------------
// weaves — a multiplier on the colour, by where you are on the panel
// ---------------------------------------------------------------------------

export const WEAVE = {
  flat: () => 1,
  cotton: (x, y, s) => 1 + (jitter(Math.round(x * 30), Math.round(y * 40), s) - 0.5) * 0.055,
  linen: (x, y, s) => 1 + (jitter(Math.round(x * 40), Math.round(y * 12), s) - 0.5) * 0.09,
  knit: (x, y, s) => (
    ((Math.floor(x * 12) + Math.floor(y * 16)) % 2 ? 0.955 : 1.035)
    + (jitter(Math.round(x * 12), Math.round(y * 16), s) - 0.5) * 0.04
  ),
  cable: (x, y, s) => (
    (Math.floor(x * 8) % 2 ? 1.05 : 0.94)
    + Math.sin(y * 34) * 0.03 + (jitter(Math.round(x * 8), Math.round(y * 20), s) - 0.5) * 0.03
  ),
  denim: (x, y, s) => (
    0.97 + (jitter(Math.round(x * 26), 0, s) - 0.5) * 0.14
    + (jitter(Math.round(x * 26), Math.round(y * 30), s + 1) - 0.5) * 0.05
  ),
  cord: (x) => (Math.floor(x * 14) % 2 ? 0.90 : 1.06),
  leather: (x, y, s) => (
    (jitter(Math.round(x * 24), Math.round(y * 28), s) > 0.80 ? 0.86 : 1)
    * (1 + (jitter(Math.round(x * 24), Math.round(y * 28), s + 3) - 0.5) * 0.07)
  ),
  metal: (x, y) => {
    // a bright band a third of the way across, the way a curved plate catches
    // the light, and a dull one at each edge
    const d = Math.abs(x - 0.36);
    return d < 0.07 ? 1.35 : d < 0.14 ? 1.14 : (x > 0.86 || x < 0.06 ? 0.82 : 0.98);
  },
  fur: (x, y, s) => (
    1 + (jitter(Math.round(x * 20), Math.round(y * 26), s) - 0.5) * 0.26
  ),
  satin: (x, y) => {
    const d = Math.abs(x - 0.4);
    return d < 0.10 ? 1.22 : d < 0.20 ? 1.08 : 0.96;
  },
  quilt: (x, y) => {
    const gx = (x * 6) % 1, gy = (y * 8) % 1;
    const seam = gx < 0.14 || gy < 0.12;
    return seam ? 0.86 : 1.04;
  },
  scale: (x, y, s) => {
    const row = Math.floor(y * 18);
    const off = row % 2 ? 0.5 : 0;
    const gx = ((x * 9) + off) % 1;
    return gx < 0.16 ? 0.84 : gx > 0.8 ? 1.12 : 1;
  },
  towel: (x, y, s) => (jitter(Math.round(x * 34), Math.round(y * 44), s) > 0.55 ? 1.07 : 0.95),
};

// ---------------------------------------------------------------------------
// prints — a different COLOUR, which is what dye does
// ---------------------------------------------------------------------------

const dark = (c, k) => shade(c, k);

export const PRINT = {
  none: () => null,
  hoops: (x, y, c) => (Math.floor(y * 7) % 2 ? dark(c, 0.72) : null),
  fine: (x, y, c) => (Math.floor(y * 14) % 2 ? dark(c, 0.84) : null),
  stripes: (x, y, c) => (Math.floor(x * 8) % 2 ? dark(c, 0.76) : null),
  pin: (x, y, c) => (Math.floor(x * 16) % 4 === 0 ? shade(c, 1.35) : null),
  wide: (x, y, c) => (Math.floor(y * 4) % 2 ? dark(c, 0.68) : null),
  plaid: (x, y, c) => {
    const a = Math.floor(x * 6) % 3 === 0;
    const b = Math.floor(y * 8) % 3 === 0;
    if (a && b) return shade(c, 1.28);
    if (a || b) return dark(c, 0.78);
    return dark(c, 0.94);
  },
  tartan: (x, y, c) => {
    const a = (Math.floor(x * 10) % 5) < 2;
    const b = (Math.floor(y * 12) % 5) < 2;
    if (a && b) return shade(c, 1.4);
    if (a !== b) return dark(c, 0.72);
    return dark(c, 0.9);
  },
  camo: (x, y, c, s) => {
    const n = jitter(Math.round(x * 7), Math.round(y * 9), s);
    if (n > 0.72) return dark(c, 0.66);
    if (n > 0.44) return dark(c, 0.84);
    if (n > 0.22) return shade(c, 1.14);
    return null;
  },
  checker: (x, y, c) => ((Math.floor(x * 6) + Math.floor(y * 8)) % 2 ? dark(c, 0.7) : null),
  argyle: (x, y, c) => {
    const gx = (x * 4) % 1, gy = (y * 5) % 1;
    const d = Math.abs(gx - 0.5) + Math.abs(gy - 0.5);
    if (d < 0.28) return shade(c, 1.3);
    if (d < 0.36) return dark(c, 0.72);
    return null;
  },
  speckle: (x, y, c, s) => (jitter(Math.round(x * 30), Math.round(y * 40), s) > 0.78 ? shade(c, 1.2) : null),
  panel: (x, y, c) => (x > 0.30 && x < 0.70 ? shade(c, 1.16) : null),
  sides: (x, y, c) => (x < 0.16 || x > 0.84 ? shade(c, 1.3) : null),
  chevron: (x, y, c) => (Math.abs(((x + y * 1.6) * 6) % 1 - 0.5) < 0.2 ? dark(c, 0.76) : null),
  spots: (x, y, c, s) => (jitter(Math.round(x * 8), Math.round(y * 10), s) > 0.74 ? dark(c, 0.6) : null),
  hazard: (x, y, c) => (Math.abs(((x - y) * 7) % 1 - 0.5) < 0.25 ? shade(c, 1.5) : null),
};

// ---------------------------------------------------------------------------
// a panel of cloth
// ---------------------------------------------------------------------------

/**
 * One face of one garment.
 *
 * `o` carries the weave, the print, how hard the light falls off and how much
 * the panel curves away at its sides. What comes back is a function of the
 * shape `mapRect` wants, so a whole garment is six of these.
 */
export function panel(base, face, o = {}, ink, salt = 0) {
  const weave = WEAVE[o.weave || 'cotton'] || WEAVE.cotton;
  const print = PRINT[o.print || 'none'] || PRINT.none;
  const fall = o.fall === undefined ? 0.13 : o.fall;
  const roll = o.roll === undefined ? 0.11 : o.roll;
  return (u, v, cur, w, h) => {
    const x = (u + 0.5) / w, y = (v + 0.5) / h;
    let c = base;
    const p = print(x, y, base, salt);
    if (p) c = p;
    let k = 1 - y * fall;
    if (face === 'front' || face === 'back') {
      const r = Math.abs(x - 0.5) * 2;
      k *= 1 - r * r * roll;
    }
    if (face === 'back') k *= 0.95;
    k *= weave(x, y, salt);
    // the last row of a panel is where the cloth ends, and a garment with no
    // hem reads as paint
    if (o.hem !== false && v === h - 1) k *= 0.84;
    return ink.grain(ink.lit(shade(c, k), face), 0.35);
  };
}

/** Paint a band of rows across a face, in fractions of its height. */
export function rows(skin, rect, from, to, fn) {
  skin.mapRect(rect, (u, v, cur, w, h) => {
    const y = (v + 0.5) / h;
    if (y < from || y >= to) return null;
    return fn(u, v, cur, w, h, (u + 0.5) / w, y);
  });
}

/** A sub-rectangle of a face, in fractions of it. */
export function sub(rect, a, b, c, d) {
  const [x, y, w, h] = rect;
  const x0 = x + Math.round(w * a), y0 = y + Math.round(h * b);
  const x1 = x + Math.round(w * c), y1 = y + Math.round(h * d);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/** One texel row, whatever the resolution. */
export const line = (h) => Math.max(1, Math.round(h / 12));

export { shade, mix, clamp255 };
