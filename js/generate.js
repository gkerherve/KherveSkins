// The photograph, made into a man.
//
// This is the whole trick, and it is worth saying what the difficulty is: at
// the only size vanilla Minecraft accepts, a face is EIGHT PIXELS ACROSS.
// Squeeze a photograph into that with an ordinary resize and you get a smear
// of skin tone with two grey smudges in it, which is why most photo-to-skin
// tools look like nothing in particular. Four things stop it:
//
//   the warp    — the eye line, the mouth line and both eyes are pinned to
//                 whole texels before anything is averaged, so features land
//                 ON a pixel rather than across the join between two
//   the detail  — local contrast is pushed back up after the shrink, because
//                 averaging is exactly the operation that removes it
//   the nudge   — the darkest texel in the eye row IS an eye, and is treated
//                 as one; a face that reads at eight pixels is a drawing of
//                 a face, not a photograph of one
//   the wall    — a head box is a rectangle and a head is not, so what was
//                 behind the person is found and painted out before it can
//                 leak down the side of his head
//
// And a fifth, which is not a trick at all: MORE PIXELS. At 128 the face is
// sixteen across and at 256 it is thirty-two, and the first three matter
// less at every step because the photograph starts carrying the likeness by
// itself. Everything here is written in sixty-fourths and multiplied by `s`,
// so the same code draws all three.
//
// Everything the photograph cannot answer — the back of the head, the soles
// of the shoes — is built from colours it CAN answer, so the man is all one
// person from every side.

import { parts, BASE, scaleOf } from './layout.js';
import { clamp, clamp255, mix, shade, luma, dist, rng, hexToRgb } from './pixels.js';
import { sampleFace, sampleRect, probe, bodyFrame } from './photo.js';
import { dressUp } from './wardrobe.js';

export const DEFAULTS = {
  slim: false,
  size: BASE,
  // the frame
  eyeRow: 4.5,
  mouthRow: 6.5,
  zoomX: 1,
  shiftX: 0,
  shiftY: 0,
  // the tone of the photograph
  bright: 0,
  contrast: 0.12,
  satur: 0.16,
  warmth: 0,
  detail: 0.45,
  levels: 0,
  // the drawing on top of it
  features: 0.60,
  shading: 0.55,
  grain: 0.30,
  hairLayer: false,
  ears: true,
  photoBody: true,     // take the clothes off the photograph, not off a swatch
  wear: {},            // the wardrobe: one chosen item per category
  // the clothes
  sleeve: 8,
  boot: 3,
  colours: {},        // hair / skin / shirt / trousers / shoes, '' means: from the photo
  seed: 1234,
};

// How much light each face of a box gets. A skin with no shading at all is
// the flat, plasticky look that says "made by a machine" from across a
// server lobby; this is most of the difference.
const LIGHT = { top: 1.10, front: 1.0, right: 0.93, left: 0.93, back: 0.88, bottom: 0.74 };

/** The tone controls, applied to one sampled colour. */
function tone(c, o) {
  let [r, g, b] = c;
  const k = 1 + (o.bright || 0);
  r *= k; g *= k; b *= k;
  const ct = 1 + (o.contrast || 0);
  r = (r - 128) * ct + 128;
  g = (g - 128) * ct + 128;
  b = (b - 128) * ct + 128;
  if (o.warmth) {
    r += o.warmth * 26;
    b -= o.warmth * 26;
  }
  if (o.satur) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = 1 + o.satur;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  }
  return [clamp255(r), clamp255(g), clamp255(b), 255];
}

/** Flatten to N steps a channel, which is what makes it read as pixel art. */
function posterize(c, levels) {
  if (!levels || levels < 2) return c;
  const q = (v) => Math.round(Math.round(v / 255 * (levels - 1)) / (levels - 1) * 255);
  return [q(c[0]), q(c[1]), q(c[2]), c[3] === undefined ? 255 : c[3]];
}

/**
 * Put back the local contrast the shrink took out.
 *
 * An unsharp mask over the face grid itself rather than over the photograph:
 * it is the SMALL picture that has gone soft, and sharpening the big one
 * first just makes the averaging throw away sharper pixels.
 */
function crisp(grid, cols, rows, amount) {
  if (!amount) return grid;
  const out = grid.map((c) => c.slice());
  for (let v = 0; v < rows; v++) {
    for (let u = 0; u < cols; u++) {
      const acc = [0, 0, 0];
      const lo = [255, 255, 255], hi = [0, 0, 0];
      let n = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const x = u + i, y = v + j;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const c = grid[y * cols + x];
          for (let k = 0; k < 3; k++) {
            acc[k] += c[k];
            if (c[k] < lo[k]) lo[k] = c[k];
            if (c[k] > hi[k]) hi[k] = c[k];
          }
          n++;
        }
      }
      const c = grid[v * cols + u];
      for (let k = 0; k < 3; k++) {
        // held inside the range of what was actually THERE. An unsharp mask
        // that may overshoot turns the one dark texel beside a lit cheek
        // into pure black, and a black square on a face reads as a hole in
        // the man rather than as his hair.
        const sharp = c[k] + amount * (c[k] - acc[k] / n);
        out[v * cols + u][k] = clamp255(Math.max(lo[k], Math.min(hi[k], sharp)));
      }
    }
  }
  return out;
}

/**
 * Take the wall out of the face.
 *
 * The head box is a rectangle and a head is not, so its corners are whatever
 * was behind the person — and at eight pixels across, four corners is a
 * QUARTER of the face. Left alone it shows up as pale chips at the jaw, and
 * worse, it leaks: the sides of the head are built from the front's edge
 * column and the top from its first row, so one bad corner turns into a
 * stripe down the ear and a patch on the crown.
 *
 * Found the way a person would find it — flood in from the edge of the
 * frame, because background is the stuff that TOUCHES the outside — and
 * filled from whatever neighbours it, which is hair at the top of the head
 * and jaw at the bottom, without either being named anywhere.
 *
 * The test is COMPARATIVE, and that is the part that took two goes to get
 * right. "Far from the complexion" fails on a pale kitchen wall, which is
 * nearer to a pale forehead than a shadowed cheek is. "Nearer to the wall we
 * measured than to his face" is the question actually being asked.
 */
function dropBackground(grid, cols, rows, bg, pal) {
  if (!bg) return grid;
  const near = (c) => {
    const db = dist(c, bg);
    if (db > 150) return false;
    return db * 1.15 < dist(c, pal.skin) && db * 1.15 < dist(c, pal.hair);
  };
  const inset = Math.max(2, Math.round(cols * 0.25));
  const mark = new Uint8Array(cols * rows);
  const stack = [];
  const push = (u, v) => {
    if (u < 0 || v < 0 || u >= cols || v >= rows) return;
    // The middle of a head box is a FACE. Whatever else has gone wrong, the
    // texels the eyes and nose live in are not the wall behind him — and
    // without this rule they can be, because a grey-green eye against a grey
    // wall is a closer colour match than an eye is to a cheek.
    if (u >= inset && u < cols - inset && v >= inset && v < rows - inset) return;
    const i = v * cols + u;
    if (mark[i] || !near(grid[i])) return;
    mark[i] = 1;
    stack.push(i);
  };
  for (let u = 0; u < cols; u++) { push(u, 0); push(u, rows - 1); }
  for (let v = 0; v < rows; v++) { push(0, v); push(cols - 1, v); }
  while (stack.length) {
    const i = stack.pop();
    const u = i % cols, v = (i / cols) | 0;
    push(u + 1, v); push(u - 1, v); push(u, v + 1); push(u, v - 1);
  }
  let n = 0;
  for (const m of mark) n += m;
  // most of the box is background: that is a badly placed box, not a fringe
  // of wall, and quietly repainting the whole face would hide it
  if (!n || n > cols * rows * 0.55) return grid;

  for (let pass = 0; pass < cols; pass++) {
    let moved = 0;
    for (let v = 0; v < rows; v++) {
      for (let u = 0; u < cols; u++) {
        const i = v * cols + u;
        if (!mark[i]) continue;
        const acc = [0, 0, 0];
        let k = 0;
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const x = u + du, y = v + dv;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const j = y * cols + x;
          if (mark[j]) continue;
          acc[0] += grid[j][0]; acc[1] += grid[j][1]; acc[2] += grid[j][2]; k++;
        }
        if (!k) continue;
        grid[i] = [acc[0] / k, acc[1] / k, acc[2] / k, 255];
        mark[i] = 0;
        moved++;
      }
    }
    if (!moved) break;
  }
  // anything still standing had no face next to it at all: hair up top,
  // complexion below, which is what is behind a head from those heights
  for (let v = 0; v < rows; v++) {
    for (let u = 0; u < cols; u++) {
      const i = v * cols + u;
      if (mark[i]) grid[i] = v < rows * 0.45 ? shade(pal.hair, 0.9) : shade(pal.skin, 0.82);
    }
  }
  return grid;
}

/** Which texels of the face are hair rather than skin, 0..1 each. */
function hairness(grid, cols, rows, hair, skinTone) {
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < grid.length; i++) {
    const dh = dist(grid[i], hair) + 1;
    const ds = dist(grid[i], skinTone) + 1;
    out[i] = clamp(ds / (ds + dh), 0, 1);
  }
  return out;
}

/**
 * The nudge: eyes, brows and a mouth, drawn ON TOP of what was sampled.
 *
 * Nothing here invents a feature that was not in the photograph — every
 * colour used is one that was found in that row of it. What it does is
 * decide that the darkest texel in the eye row is an EYE, and stop it being
 * a slightly darker beige.
 *
 * It works in eighths and paints blocks, so it means the same thing at every
 * size — and it eases OFF as the size goes up. At thirty-two pixels across,
 * the photograph has the eyes already; drawing over them with a flat lozenge
 * would be putting a cartoon on top of a portrait.
 */
function emphasize(grid, cols, rows, o, pal, s) {
  // Straight division, not something gentler: at thirty-two pixels a drawn
  // lip is a flat pink rectangle four texels deep, and the photograph
  // underneath it was better. The nudge is for when there is nothing there
  // to nudge.
  const f = o.features / s;
  if (!f) return grid;
  const at = (u, v) => grid[clamp(v, 0, rows - 1) * cols + clamp(u, 0, cols - 1)];
  // one "cell" is one eighth of the face, whatever the size
  const put = (cu, cv, c, t, wide = 1, tall = 1) => {
    for (let j = 0; j < Math.round(tall * s); j++) {
      for (let i = 0; i < Math.round(wide * s); i++) {
        const u = Math.round(cu * s) + i, v = Math.round(cv * s) + j;
        if (u < 0 || v < 0 || u >= cols || v >= rows) continue;
        grid[v * cols + u] = mix(grid[v * cols + u], c, t);
      }
    }
  };
  const eyeC = clamp(Math.floor(o.eyeRow), 1, 6);
  const mouthC = clamp(Math.floor(o.mouthRow), eyeC + 1, 7);
  const midRow = Math.round((eyeC + 0.5) * s);

  // --- the eyes ----------------------------------------------------------
  const darkestCell = (a, b) => {
    let best = a, bl = Infinity;
    for (let cu = a; cu <= b; cu++) {
      let sum = 0, n = 0;
      for (let i = 0; i < s; i++) {
        const c = at(Math.round(cu * s) + i, midRow);
        sum += luma(c); n++;
      }
      const l = sum / n;
      if (l < bl) { bl = l; best = cu; }
    }
    return best;
  };
  const lu = darkestCell(1, 3);
  const ru = darkestCell(4, 6);
  const iris = shade(mix(at(Math.round(lu * s), midRow), at(Math.round(ru * s), midRow), 0.5), 0.62);
  const white = mix(pal.skin, [246, 244, 240], 0.72);
  for (const [cu, dir] of [[lu, -1], [ru, 1]]) {
    put(cu, eyeC, iris, f);
    put(cu + dir, eyeC, white, f * 0.55);
    put(cu, eyeC - 1, shade(pal.hair, 0.85), f * 0.35);   // a lid line above
  }

  // --- the mouth ---------------------------------------------------------
  const mid = 4;
  const mouthDark = shade(at(Math.round(mid * s), Math.round((mouthC + 0.5) * s)), 0.82);
  const lip = [clamp255(mouthDark[0] * 1.06), mouthDark[1], mouthDark[2]];
  put(mid - 1, mouthC, lip, f * 0.85, 2);
  put(mid - 2, mouthC, lip, f * 0.35);
  put(mid + 1, mouthC, lip, f * 0.35);

  // --- the nose ----------------------------------------------------------
  const noseC = Math.min(mouthC - 1, eyeC + 1);
  if (noseC > eyeC) {
    put(mid - 1, noseC, shade(pal.skin, 0.86), f * 0.35);
    put(mid, noseC, shade(pal.skin, 0.90), f * 0.20);
  }
  return grid;
}

/**
 * The rest of him, off the photograph.
 *
 * Reading a shirt as one flat colour throws away everything that made it
 * that person's shirt — the print on it, the stripes, the way the light
 * falls off the shoulder. This samples the torso, the arms and the legs the
 * same way the face is sampled, and lays them over the plain clothes that
 * were drawn first.
 *
 * OVER, not instead of. Whatever falls outside the photograph keeps the
 * plain version underneath, so a head-and-shoulders shot gets a real shirt
 * and invented trousers rather than a shirt and a grey smear. `covered` is
 * how much of each rectangle was actually in the picture, and anything under
 * four fifths is left alone.
 */
function photoClothes(skin, photo, f, o, P, pal, ink, s) {
  const b = f.body || bodyFrame(f);
  const armW = b.w * 0.30;
  const legH = f.h * 2.30;

  const lay = (rect, grid, cols, rows, face, k = 1) => {
    skin.mapRect(rect, (u, v, cur, w, h) => {
      const gu = Math.min(cols - 1, Math.floor(u * cols / w));
      const gv = Math.min(rows - 1, Math.floor(v * rows / h));
      return ink.grain(ink.lit(shade(grid[gv * cols + gu], k), face), 0.35);
    });
  };

  const take = (x, y, w, h, cols, rows) => {
    const g = sampleRect(photo, x, y, w, h, cols, rows);
    if (g.covered < 0.80) return null;
    const toned = g.map((c) => tone(c, o));
    return crisp(toned, cols, rows, o.detail * 0.7);
  };

  // --- the torso ---------------------------------------------------------
  const bodyR = P.body.rects;
  const bw = bodyR.front[2], bh = bodyR.front[3];
  const torso = take(b.x, b.y, b.w, b.h, bw, bh);
  if (torso) {
    lay(bodyR.front, torso, bw, bh, 'front');
    // the back is the front, mirrored and a shade darker: nobody photographs
    // both, and a plain panel back there is worse than a plausible one
    skin.mapRect(bodyR.back, (u, v, cur, w, h) => {
      const gu = Math.min(bw - 1, Math.floor((w - 1 - u) * bw / w));
      const gv = Math.min(bh - 1, Math.floor(v * bh / h));
      return ink.grain(ink.lit(shade(torso[gv * bw + gu], 0.94), 'back'), 0.35);
    });
    for (const [face, edge] of [['right', 0], ['left', bw - 1]]) {
      skin.mapRect(bodyR[face], (u, v, cur, w, h) => {
        const gv = Math.min(bh - 1, Math.floor(v * bh / h));
        return ink.grain(ink.lit(torso[gv * bw + edge], face), 0.35);
      });
    }
    const topRow = torso.slice(0, bw);
    const mean = topRow.reduce((a, c) => [a[0] + c[0] / bw, a[1] + c[1] / bw, a[2] + c[2] / bw], [0, 0, 0]);
    skin.mapRect(bodyR.top, (u, v, cur, w, h) => (
      u >= w * 0.25 && u < w * 0.75 && v >= h * 0.25 && v < h * 0.75
        ? ink.lit(shade(pal.skin, 0.88), 'top')
        : ink.lit(shade(mean, 1.04), 'top')));
  }

  // --- the arms ----------------------------------------------------------
  for (const [key, dir] of [['armR', -1], ['armL', +1]]) {
    const R = P[key].rects;
    const aw = R.front[2], ah = R.front[3];
    const x = dir < 0 ? b.x - armW : b.x + b.w;
    const arm = take(x, b.y, armW, b.h, aw, ah);
    if (!arm) continue;
    for (const face of ['front', 'back', 'right', 'left']) {
      const k = face === 'back' ? 0.94 : 1;
      const mirror = face === 'back';
      skin.mapRect(R[face], (u, v, cur, w, h) => {
        const gu = Math.min(aw - 1, Math.floor((mirror ? w - 1 - u : u) * aw / w));
        const gv = Math.min(ah - 1, Math.floor(v * ah / h));
        return ink.grain(ink.lit(shade(arm[gv * aw + gu], k), face), 0.35);
      });
    }
    skin.mapRect(R.top, () => ink.lit(shade(arm[0], 1.04), 'top'));
    skin.mapRect(R.bottom, () => ink.lit(shade(arm[(ah - 1) * aw], 0.9), 'bottom'));
  }

  // --- the legs ----------------------------------------------------------
  const hip = b.y + b.h;
  for (const [key, dir] of [['legR', -1], ['legL', +1]]) {
    const R = P[key].rects;
    const lw = R.front[2], lh = R.front[3];
    const legW = b.w * 0.48;
    const x = b.x + b.w / 2 + dir * (b.w * 0.02) - (dir < 0 ? legW : 0);
    const leg = take(x, hip, legW, legH, lw, lh);
    if (!leg) continue;
    for (const face of ['front', 'back', 'right', 'left']) {
      const k = face === 'back' ? 0.94 : 1;
      const mirror = face === 'back';
      skin.mapRect(R[face], (u, v, cur, w, h) => {
        const gu = Math.min(lw - 1, Math.floor((mirror ? w - 1 - u : u) * lw / w));
        const gv = Math.min(lh - 1, Math.floor(v * lh / h));
        return ink.grain(ink.lit(shade(leg[gv * lw + gu], k), face), 0.35);
      });
    }
    skin.mapRect(R.top, () => ink.lit(shade(leg[0], 1.02), 'top'));
    skin.mapRect(R.bottom, () => ink.lit(shade(leg[(lh - 1) * lw], 0.7), 'bottom'));
  }
}

/**
 * Build the whole man.
 *
 * @param {Skin}  skin   the image written into
 * @param {Photo} photo  the picture
 * @param {object} f     the frame: head box, eye line, mouth line, tilt
 * @param {object} opts  everything the sliders say
 * @returns {object} the palette it settled on, for the swatches
 */
export function generate(skin, photo, f, opts) {
  const o = { ...DEFAULTS, ...opts };
  const size = skin.size || o.size || BASE;
  const s = scaleOf(size);
  const N = Math.round(8 * s);          // the face, in texels across
  const found = probe(photo, f);
  // Where each colour came FROM, kept apart from the colour itself. The card
  // says so, because "it guessed your trousers" is worth knowing and "it read
  // your trousers off the photograph" is worth trusting.
  const src = {};
  const pick = (key, fallback) => {
    const chosen = (o.colours || {})[key];
    if (chosen) { src[key] = 'yours'; return hexToRgb(chosen); }
    if (found[key]) { src[key] = 'photo'; return found[key].map(Math.round); }
    src[key] = 'made';
    return fallback;
  };
  const pal = {
    hair: pick('hair', [64, 44, 32]),
    skin: pick('skin', [226, 180, 146]),
    shirt: pick('shirt', [58, 106, 160]),
    trousers: pick('trousers', [50, 62, 92]),
    shoes: pick('shoes', [42, 36, 30]),
    bg: found.bg,
    src,
  };

  // --- the face ----------------------------------------------------------
  let grid = sampleFace(photo, f, N, N, o);
  grid = grid.map((c) => tone(c, o));
  // the palette follows the picture through the same tone controls, or the
  // clothes end up from a different photograph than the face
  const pt = (c) => tone(c, { contrast: o.contrast * 0.6, satur: o.satur, warmth: o.warmth, bright: o.bright * 0.6 });
  for (const k of ['hair', 'skin', 'shirt', 'trousers', 'shoes']) {
    if (src[k] === 'photo') pal[k] = pt(pal[k]);
  }
  const bgToned = found.bg ? tone(found.bg, o) : null;
  grid = dropBackground(grid, N, N, bgToned, pal);
  grid = crisp(grid, N, N, o.detail * 1.4);
  grid = emphasize(grid, N, N, o, pal, s);
  if (o.levels) grid = grid.map((c) => posterize(c, o.levels));

  const hairMap = hairness(grid, N, N, pal.hair, pal.skin);
  const noise = rng(o.seed);
  const grain = (c, k = 1) => {
    if (!o.grain) return c;
    const n = (noise() - 0.5) * o.grain * 26 * k;
    return [clamp255(c[0] + n), clamp255(c[1] + n), clamp255(c[2] + n), 255];
  };
  const lit = (c, face) => shade(c, 1 + (LIGHT[face] - 1) * o.shading * 1.6);

  const P = {};
  for (const p of parts(o.slim, size)) P[p.key] = p;
  const head = P.head;

  // front of the head: the photograph, and the only part of him that is
  skin.mapRect(head.rects.front, (u, v) => grain(grid[v * N + u], 0.5));

  // --- the rest of the head ----------------------------------------------
  //
  // A photograph of a face is a photograph of a face. Everything round the
  // back is BUILT, from the two colours the front established, and its only
  // job is to be the same person seen from behind.
  const edge = (u, v) => grid[v * N + u];
  const hairAt = (v) => Math.max(hairMap[v * N], hairMap[v * N + N - 1]);
  const hairShade = (t) => shade(pal.hair, 1 - t * 0.16);
  const last = N - 1;

  // top: hair, darkening toward the crown at the back
  skin.mapRect(head.rects.top, (u, v) => {
    // image-up on a top face is the BACK of the head; the front row of it
    // carries on from the fringe the photograph actually shows
    const toBack = 1 - v / last;
    const fringe = mix(edge(u, 0), pal.hair, 0.35);
    return grain(lit(mix(fringe, hairShade(toBack), toBack * 0.85), 'top'), 0.6);
  });

  // sides: the face's own edge at the front, hair behind it, an ear between
  const side = (isRight) => (u, v) => {
    const t = isRight ? (last - u) / last : u / last;   // 0 at the front, 1 at the back
    const front = edge(isRight ? 0 : last, v);
    const isHair = hairAt(v);
    let c;
    if (isHair > 0.55) {
      c = mix(front, hairShade(t), clamp(t * 1.5, 0, 1));
    } else {
      const cheek = mix(front, pal.skin, 0.45);
      c = mix(cheek, hairShade(t), clamp((t - 0.42) * 2.2, 0, 1));
    }
    // an ear: a small darker shell where an ear is, and never in the hair
    const eighth = v / N * 8;
    if (o.ears && isHair < 0.55 && eighth >= 3 && eighth < 6 && t > 0.34 && t < 0.66) {
      const rim = eighth >= 4 && eighth < 5 && t > 0.44 && t < 0.58;
      c = mix(c, shade(pal.skin, rim ? 0.74 : 0.90), 0.8);
    }
    return grain(lit(c, isRight ? 'right' : 'left'), 0.5);
  };
  skin.mapRect(head.rects.right, side(true));
  skin.mapRect(head.rects.left, side(false));

  // back: hair, with the nape showing under the hairline
  skin.mapRect(head.rects.back, (u, v) => {
    const isHair = hairAt(v);
    const napeSkin = mix(pal.skin, [0, 0, 0], 0.10);
    const c = isHair > 0.5
      ? hairShade(0.75 + (u === 0 || u === last ? 0.1 : 0))
      : mix(napeSkin, hairShade(0.8), 0.35);
    return grain(lit(c, 'back'), 0.6);
  });

  // bottom: under the jaw, and the neck in the middle of it
  skin.mapRect(head.rects.bottom, (u, v, _c, w, h) => {
    const neck = u >= w * 0.25 && u < w * 0.75 && v >= h * 0.25 && v < h * 0.75;
    const c = neck ? shade(pal.skin, 0.86) : shade(pal.skin, 0.70);
    return grain(lit(c, 'bottom'), 0.4);
  });

  // --- the hair as a layer of its own ------------------------------------
  //
  // Optional, and off by default for a reason: it looks better when the hair
  // was read correctly and looks like a bald man wearing a doily when it was
  // not. What it buys is depth — hair that stands a pixel proud of the skull.
  const wornHair = o.wear && o.wear.hair && o.wear.hair !== 'auto';
  if (wornHair) {
    // A haircut chosen from the wardrobe replaces the one in the photograph,
    // and "Shaved" has to mean shaved: without this the built-in hair stays
    // underneath and every style in the grid looks the same, because it is.
    bareHead(skin, head, hairMap, pal, lit, grain, N);
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
      skin.fillRect(head.overRects[face], [0, 0, 0, 0]);
    }
  } else if (o.hairLayer) {
    liftHair(skin, head, hairMap, pal, lit, grain, N);
  } else {
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
      skin.fillRect(head.overRects[face], [0, 0, 0, 0]);
    }
  }

  const ink = { lit, grain };
  dress(skin, P, pal, o, ink, s);
  if (o.photoBody) photoClothes(skin, photo, f, o, P, pal, ink, s);
  dressUp(skin, o.wear, {
    parts: P, pal, ink, s, size, colours: o.colours || {}, slim: o.slim,
  });
  return pal;
}

/** Paint the hair out, leaving a scalp for the wardrobe to draw on. */
function bareHead(skin, head, hairMap, pal, lit, grain, N) {
  const scalp = mix(pal.skin, [0, 0, 0], 0.10);
  for (const face of ['top', 'right', 'front', 'left', 'back']) {
    const r = head.rects[face];
    for (let v = 0; v < r[3]; v++) {
      for (let u = 0; u < r[2]; u++) {
        const c = skin.get(r[0] + u, r[1] + v);
        const isHair = face === 'front'
          ? hairMap[v * N + u] > 0.5
          : dist(c, pal.hair) < dist(c, pal.skin);
        if (isHair) skin.set(r[0] + u, r[1] + v, grain(lit(scalp, face), 0.4));
      }
    }
  }
}

/** Move the hair off the skull and onto the hat layer, a pixel proud of it. */
function liftHair(skin, head, hairMap, pal, lit, grain, N) {
  const scalp = mix(pal.skin, [0, 0, 0], 0.12);
  for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
    const src = head.rects[face], dst = head.overRects[face];
    for (let v = 0; v < src[3]; v++) {
      for (let u = 0; u < src[2]; u++) {
        const c = skin.get(src[0] + u, src[1] + v);
        const isHair = face === 'front'
          ? hairMap[v * N + u] > 0.55
          : dist(c, pal.hair) < dist(c, pal.skin);
        if (isHair && face !== 'bottom') {
          skin.set(dst[0] + u, dst[1] + v, c);
          skin.set(src[0] + u, src[1] + v, grain(lit(scalp, face), 0.4));
        } else {
          skin.set(dst[0] + u, dst[1] + v, [0, 0, 0, 0]);
        }
      }
    }
  }
}

/**
 * Clothes.
 *
 * Flat colour on a body is the tell of a generated skin, so nothing here is
 * flat: every panel has light coming from above, a seam where two pieces of
 * cloth meet, a hem that is darker than what it hangs off, and a grain. A
 * collar, cuffs and a sole are a few texels each and they are the difference
 * between a man in a shirt and a man painted blue.
 *
 * Written in sixty-fourths and multiplied, so a cuff is one line at 64 and
 * four at 256 rather than a hairline nobody can see.
 */
function dress(skin, P, pal, o, ink, s) {
  const { lit, grain } = ink;
  const { shirt, trousers, shoes } = pal;
  const hands = pal.skin;
  const line = Math.max(1, Math.round(s));

  const cloth = (base, face) => (u, v, _c, w, h) => {
    const drop = 1 - (v / h) * 0.14;             // light falls from the shoulder
    let c = shade(base, drop);
    if (face === 'front' || face === 'back') {   // and a torso curves away
      const roll = Math.abs((u + 0.5) / w - 0.5) * 2;
      c = shade(c, 1 - roll * roll * 0.10);
    }
    return grain(lit(c, face), 0.8);
  };

  // --- the body ----------------------------------------------------------
  const body = P.body;
  for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
    skin.mapRect(body.rects[face], cloth(shirt, face));
  }
  // the neck hole, in the top of the shirt
  skin.mapRect(body.rects.top, (u, v, c, w, h) => (
    u >= w * 0.25 && u < w * 0.75 && v >= h * 0.25 && v < h * 0.75 ? shade(hands, 0.88) : c
  ));
  // a collar, and a hem at the waist
  const band = (rect, from, to, k) => skin.mapRect(rect, (u, v, c, w, h) => (
    v >= (from < 0 ? h + from : from) && v < (to <= 0 ? h + to : to) ? shade(c, k) : c
  ));
  for (const face of ['front', 'back', 'right', 'left']) {
    band(body.rects[face], 0, line, 1.08);
    band(body.rects[face], -line, 0, 0.86);
  }
  // a collar opening at the throat
  skin.mapRect(body.rects.front, (u, v, c, w) => (
    v < line && u >= w * 0.375 && u < w * 0.625 ? shade(hands, 0.9) : c
  ));

  // --- the arms ----------------------------------------------------------
  for (const key of ['armR', 'armL']) {
    const arm = P[key];
    const sleeve = Math.round(clamp(o.sleeve, 0, 12) * s);
    for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const isEnd = face === 'bottom';
      const isTop = face === 'top';
      skin.mapRect(arm.rects[face], (u, v, c, w, h) => {
        if (isEnd) return grain(lit(sleeve >= h ? shirt : hands, face), 0.6);
        if (isTop) return grain(lit(sleeve > 0 ? shade(shirt, 1.04) : hands, face), 0.6);
        const inSleeve = v < sleeve;
        let col = cloth(inSleeve ? shirt : hands, face)(u, v, c, w, h);
        if (v >= sleeve - line && v < sleeve) col = shade(col, 0.88);        // the cuff
        if (!inSleeve && v < sleeve + line) col = shade(col, 1.05);          // the wrist
        if (!inSleeve && v >= h - line * 2) col = shade(col, 0.93);          // fingers
        return col;
      });
    }
  }

  // --- the legs ----------------------------------------------------------
  for (const key of ['legR', 'legL']) {
    const leg = P[key];
    const boot = Math.round(clamp(o.boot, 0, 12) * s);
    for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const isSole = face === 'bottom';
      const isHip = face === 'top';
      skin.mapRect(leg.rects[face], (u, v, c, w, h) => {
        if (isSole) return grain(lit(shade(shoes, 0.72), face), 0.5);
        if (isHip) return grain(lit(shade(trousers, 1.02), face), 0.6);
        const hem = h - boot;
        const inBoot = v >= hem;
        let col = cloth(inBoot ? shoes : trousers, face)(u, v, c, w, h);
        if (v >= hem && v < hem + line) col = shade(col, 1.08);              // the shoe's rim
        if (v >= hem - line && v < hem) col = shade(col, 0.86);              // the turn-up
        if (inBoot && v >= h - line) col = shade(col, 0.80);                 // the welt
        return col;
      });
    }
  }

  // the second layer starts empty on everything but the head — an overlay
  // full of black is the commonest way a hand-built skin comes out wrong
  for (const key of ['body', 'armR', 'armL', 'legR', 'legL']) {
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
      skin.fillRect(P[key].overRects[face], [0, 0, 0, 0]);
    }
  }
}

/**
 * A skin with nobody's photograph in it.
 *
 * The starting point when the app is opened cold, and what "start again" goes
 * back to: a plain figure in the chosen colours, so the painter always has
 * something to paint on and the preview is never an empty box.
 */
export function blank(skin, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const size = skin.size || o.size || BASE;
  const s = scaleOf(size);
  const N = Math.round(8 * s);
  const colours = o.colours || {};
  const pal = {
    hair: hexToRgb(colours.hair || '#40342a'),
    skin: hexToRgb(colours.skin || '#e0ac7e'),
    shirt: hexToRgb(colours.shirt || '#3b6ea5'),
    trousers: hexToRgb(colours.trousers || '#33405e'),
    shoes: hexToRgb(colours.shoes || '#2b2521'),
    src: Object.fromEntries(['hair', 'skin', 'shirt', 'trousers', 'shoes']
      .map((k) => [k, colours[k] ? 'yours' : 'made'])),
  };
  const noise = rng(o.seed);
  const grain = (c, k = 1) => {
    if (!o.grain) return c;
    const n = (noise() - 0.5) * o.grain * 22 * k;
    return [clamp255(c[0] + n), clamp255(c[1] + n), clamp255(c[2] + n), 255];
  };
  const lit = (c, face) => shade(c, 1 + (LIGHT[face] - 1) * o.shading * 1.6);
  const P = {};
  for (const p of parts(o.slim, size)) P[p.key] = p;
  const head = P.head;
  const cell = (v) => v / N * 8;
  for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
    skin.mapRect(head.rects[face], (u, v) => {
      const bare = o.wear && o.wear.hair && o.wear.hair !== 'auto';
      if (face === 'top') return grain(lit(bare ? shade(pal.skin, 0.92) : pal.hair, face), 0.6);
      if (face === 'bottom') return grain(lit(shade(pal.skin, 0.78), face), 0.4);
      const worn = o.wear && o.wear.hair && o.wear.hair !== 'auto';
      const hair = worn ? false : (face === 'back' ? cell(v) < 6 : cell(v) < 3);
      let c = hair ? pal.hair : pal.skin;
      if (face === 'front') {
        const cu = cell(u), cv = cell(v);
        if (cv >= 4 && cv < 5 && ((cu >= 2 && cu < 3) || (cu >= 5 && cu < 6))) c = [56, 48, 44];
        if (cv >= 4 && cv < 5 && ((cu >= 1 && cu < 2) || (cu >= 6 && cu < 7))) c = [238, 236, 232];
        if (cv >= 6 && cv < 7 && cu >= 3 && cu < 5) c = shade(pal.skin, 0.72);
      }
      return grain(lit(c, face), 0.5);
    });
    skin.fillRect(head.overRects[face], [0, 0, 0, 0]);
  }
  const ink = { lit, grain };
  dress(skin, P, pal, o, ink, s);
  dressUp(skin, o.wear, {
    parts: P, pal, ink, s, size, colours: o.colours || {}, slim: o.slim,
  });
  return pal;
}
