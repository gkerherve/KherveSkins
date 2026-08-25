// The photograph, made into a man.
//
// This is the whole trick, and it is worth saying what the difficulty is: a
// Minecraft face is EIGHT PIXELS ACROSS. Squeeze a photograph into that with
// an ordinary resize and you get a smear of skin tone with two grey smudges
// in it, which is why most photo-to-skin tools look like nothing in
// particular. Three things stop that here:
//
//   the warp    — the eye line and the mouth line are pinned to whole texel
//                 rows before anything is averaged, so features land ON a
//                 pixel rather than across the join between two
//   the detail  — local contrast is pushed back up after the shrink, because
//                 averaging is exactly the operation that removes it
//   the nudge   — the darkest texel in the eye row IS an eye, and is treated
//                 as one; a face that reads at eight pixels is a drawing of
//                 a face, not a photograph of one
//
// Everything the photograph cannot answer — the back of the head, the soles
// of the shoes — is built from colours it CAN answer, so the man is all one
// person from every side.

import { parts } from './layout.js';
import { clamp, clamp255, mix, shade, luma, dist, rng, hexToRgb } from './pixels.js';
import { sampleFace, probe } from './photo.js';

export const DEFAULTS = {
  slim: false,
  // the frame
  eyeRow: 4.5,
  mouthRow: 6.5,
  zoomX: 1,
  shiftX: 0,
  shiftY: 0,
  // the tone of the photograph
  bright: 0,
  contrast: 0.20,
  satur: 0.28,
  warmth: 0,
  detail: 0.55,
  levels: 0,
  // the drawing on top of it
  features: 0.60,
  shading: 0.55,
  grain: 0.30,
  hairLayer: false,
  ears: true,
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
    const s = 1 + o.satur;
    r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
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
 * An unsharp mask over the eight-by-eight itself rather than over the
 * photograph: it is the SMALL picture that has gone soft, and sharpening the
 * big one first just makes the averaging throw away sharper pixels.
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
 * QUARTER of the face. Left alone it shows up as pale blue chips at the jaw,
 * and worse, it leaks: the sides of the head are built from the front's edge
 * column and the top from its first row, so one bad corner turns into a
 * stripe down the ear and a patch on the crown.
 *
 * It is found the way a person would find it — flood in from the edge of the
 * frame, because background is the stuff that TOUCHES the outside — and
 * filled from whatever neighbours it, which is hair at the top of the head
 * and jaw at the bottom, without either being named anywhere.
 */
function dropBackground(grid, cols, rows, bg, pal) {
  if (!bg) return grid;
  // Two ways of being background, because one is never enough: it matches
  // what was measured behind the head, OR it is a long way from both the
  // complexion and the hair — which is what a bright window or a shadowed
  // corner of the same wall looks like. Either way it only counts if it is
  // connected to the edge of the box, and that is what keeps an eye white,
  // which fails both tests, from being scrubbed out.
  const near = (c) => (
    dist(c, pal.skin) > 78
    && (dist(c, bg) < 130 || (dist(c, pal.skin) > 130 && dist(c, pal.hair) > 130))
  );
  const mark = new Uint8Array(cols * rows);
  const stack = [];
  const push = (u, v) => {
    if (u < 0 || v < 0 || u >= cols || v >= rows) return;
    // The middle of a head box is a FACE. Whatever else has gone wrong, the
    // four texels the eyes and nose live in are not the wall behind him —
    // and without this rule they can be, because a grey-green eye against a
    // grey wall is a closer colour match than an eye is to a cheek.
    if (u >= 2 && u <= cols - 3 && v >= 2 && v <= rows - 3) return;
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

  for (let pass = 0; pass < 6; pass++) {
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
    // a texel darker than both is hair rather than shadowed skin: hair is
    // what is dark at the top of a head
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
 */
function emphasize(grid, cols, rows, o, pal) {
  const f = o.features;
  if (!f) return grid;
  const at = (u, v) => grid[v * cols + u];
  const put = (u, v, c, t) => {
    if (u < 0 || v < 0 || u >= cols || v >= rows) return;
    grid[v * cols + u] = mix(at(u, v), c, t);
  };
  const eyeR = clamp(Math.floor(o.eyeRow), 1, rows - 2);
  const mouthR = clamp(Math.floor(o.mouthRow), eyeR + 1, rows - 1);

  // --- the eyes ----------------------------------------------------------
  const darkestIn = (v, a, b) => {
    let best = a, bl = Infinity;
    for (let u = a; u <= b; u++) {
      const l = luma(at(u, v));
      if (l < bl) { bl = l; best = u; }
    }
    return best;
  };
  const half = cols / 2;
  const lu = darkestIn(eyeR, 1, Math.max(1, Math.floor(half) - 1));
  const ru = darkestIn(eyeR, Math.min(cols - 2, Math.ceil(half)), cols - 2);
  // an iris is the darkest thing on that row, pushed further
  const iris = shade(mix(at(lu, eyeR), at(ru, eyeR), 0.5), 0.62);
  const white = mix(pal.skin, [246, 244, 240], 0.72);
  for (const [u, dir] of [[lu, -1], [ru, 1]]) {
    put(u, eyeR, iris, f);
    put(u + dir, eyeR, white, f * 0.55);
    // a lid line above sells an eye more than the eye does
    put(u, eyeR - 1, shade(pal.hair, 0.85), f * 0.35);
  }

  // --- the mouth ---------------------------------------------------------
  const mid = Math.floor(half);
  const mouthDark = shade(at(darkestIn(mouthR, mid - 2, mid + 1), mouthR), 0.82);
  const lip = [clamp255(mouthDark[0] * 1.06), mouthDark[1], mouthDark[2]];
  put(mid - 1, mouthR, lip, f * 0.85);
  put(mid, mouthR, lip, f * 0.85);
  put(mid - 2, mouthR, lip, f * 0.35);
  put(mid + 1, mouthR, lip, f * 0.35);

  // --- the nose ----------------------------------------------------------
  const noseR = Math.min(mouthR - 1, eyeR + 1);
  if (noseR > eyeR) {
    put(mid - 1, noseR, shade(pal.skin, 0.86), f * 0.35);
    put(mid, noseR, shade(pal.skin, 0.90), f * 0.20);
  }
  return grid;
}

/**
 * Build the whole man.
 *
 * @param {Skin}  skin   the 64x64 written into
 * @param {Photo} photo  the picture
 * @param {object} f     the frame: head box, eye line, mouth line, tilt
 * @param {object} opts  everything the sliders say
 * @returns {object} the palette it settled on, for the swatches
 */
export function generate(skin, photo, f, opts) {
  const o = { ...DEFAULTS, ...opts };
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
  let grid = sampleFace(photo, f, 8, 8, o);
  grid = grid.map((c) => tone(c, o));
  // the palette follows the picture through the same tone controls, or the
  // clothes end up from a different photograph than the face
  const pt = (c) => tone(c, { contrast: o.contrast * 0.6, satur: o.satur, warmth: o.warmth, bright: o.bright * 0.6 });
  for (const k of ['hair', 'skin', 'shirt', 'trousers', 'shoes']) {
    if (src[k] === 'photo') pal[k] = pt(pal[k]);
  }
  const bgToned = found.bg ? tone(found.bg, o) : null;
  grid = dropBackground(grid, 8, 8, bgToned, pal);
  grid = crisp(grid, 8, 8, o.detail * 1.4);
  grid = emphasize(grid, 8, 8, o, pal);
  if (o.levels) grid = grid.map((c) => posterize(c, o.levels));

  const hairMap = hairness(grid, 8, 8, pal.hair, pal.skin);
  const noise = rng(o.seed);
  const grain = (c, k = 1) => {
    if (!o.grain) return c;
    const n = (noise() - 0.5) * o.grain * 26 * k;
    return [clamp255(c[0] + n), clamp255(c[1] + n), clamp255(c[2] + n), 255];
  };
  const lit = (c, face) => {
    const k = 1 + (LIGHT[face] - 1) * o.shading * 1.6;
    return shade(c, k);
  };

  const P = {};
  for (const p of parts(o.slim)) P[p.key] = p;
  const head = P.head;

  // front of the head: the photograph, and the only part of him that is
  skin.mapRect(head.rects.front, (u, v) => grain(grid[v * 8 + u], 0.5));

  // --- the rest of the head ----------------------------------------------
  //
  // A photograph of a face is a photograph of a face. Everything round the
  // back is BUILT, from the two colours the front established, and its only
  // job is to be the same person seen from behind.
  const edge = (u, v) => grid[v * 8 + u];
  const hairAt = (v) => {
    // how much of that row, at the sides, is hair
    return Math.max(hairMap[v * 8], hairMap[v * 8 + 7]);
  };
  const hairShade = (t) => shade(pal.hair, 1 - t * 0.16);

  // top: hair, darkening toward the crown at the back
  skin.mapRect(head.rects.top, (u, v) => {
    // image-up on a top face is the BACK of the head; the front row of it
    // carries on from the fringe the photograph actually shows
    const toBack = 1 - v / 7;
    const fringe = mix(edge(u, 0), pal.hair, 0.35);
    return grain(lit(mix(fringe, hairShade(toBack), toBack * 0.85), 'top'), 0.6);
  });

  // sides: the face's own edge at the front, hair behind it, an ear between
  const side = (isRight) => (u, v) => {
    const t = isRight ? (7 - u) / 7 : u / 7;   // 0 at the front, 1 at the back
    const front = edge(isRight ? 0 : 7, v);
    const isHair = hairAt(v);
    let c;
    if (isHair > 0.55) {
      c = mix(front, hairShade(t), clamp(t * 1.5, 0, 1));
    } else {
      const cheek = mix(front, pal.skin, 0.45);
      c = mix(cheek, hairShade(t), clamp((t - 0.42) * 2.2, 0, 1));
    }
    // an ear: a small darker shell where an ear is, and never in the hair
    if (o.ears && isHair < 0.55 && v >= 3 && v <= 5 && t > 0.34 && t < 0.66) {
      const rim = v === 4 && t > 0.44 && t < 0.58;
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
      ? hairShade(0.75 + (u === 0 || u === 7 ? 0.1 : 0))
      : mix(napeSkin, hairShade(0.8), 0.35);
    return grain(lit(c, 'back'), 0.6);
  });

  // bottom: under the jaw, and the neck in the middle of it
  skin.mapRect(head.rects.bottom, (u, v) => {
    const neck = u >= 2 && u <= 5 && v >= 2 && v <= 5;
    const c = neck ? shade(pal.skin, 0.86) : shade(pal.skin, 0.70);
    return grain(lit(c, 'bottom'), 0.4);
  });

  // --- the hair as a layer of its own ------------------------------------
  //
  // Optional, and off by default for a reason: it looks better when the hair
  // was read correctly and looks like a bald man wearing a doily when it was
  // not. What it buys is depth — hair that stands a pixel proud of the skull.
  if (o.hairLayer) {
    liftHair(skin, head, hairMap, pal, lit, grain);
  } else {
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
      skin.fillRect(head.overRects[face], [0, 0, 0, 0]);
    }
  }

  dress(skin, P, pal, o, { lit, grain });
  return pal;
}

/** Move the hair off the skull and onto the hat layer, a pixel proud of it. */
function liftHair(skin, head, hairMap, pal, lit, grain) {
  const scalp = mix(pal.skin, [0, 0, 0], 0.12);
  for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
    const src = head.rects[face], dst = head.overRects[face];
    for (let v = 0; v < src[3]; v++) {
      for (let u = 0; u < src[2]; u++) {
        const c = skin.get(src[0] + u, src[1] + v);
        const isHair = face === 'front'
          ? hairMap[v * 8 + u] > 0.55
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
 * collar, cuffs and a sole are four texels each and they are the difference
 * between a man in a shirt and a man painted blue.
 */
function dress(skin, P, pal, o, ink) {
  const { lit, grain } = ink;
  const shirt = pal.shirt;
  const trousers = pal.trousers;
  const shoes = pal.shoes;
  const hands = pal.skin;

  const cloth = (base, face) => (u, v, _c, w, h) => {
    // light falls from the shoulder down
    const drop = 1 - (v / h) * 0.14;
    let c = shade(base, drop);
    // the sides of a torso curve away
    if (face === 'front' || face === 'back') {
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
  skin.mapRect(body.rects.top, (u, v, c) => (
    u >= 2 && u <= 5 && v >= 1 && v <= 2 ? shade(hands, 0.88) : c
  ));
  // a collar, and a hem at the waist
  const band = (rect, row, k) => skin.mapRect(rect, (u, v, c) => (v === row ? shade(c, k) : c));
  for (const face of ['front', 'back', 'right', 'left']) {
    band(body.rects[face], 0, 1.08);
    band(body.rects[face], 11, 0.86);
  }
  // a collar opening at the throat
  skin.mapRect(body.rects.front, (u, v, c) => (
    v === 0 && u >= 3 && u <= 4 ? shade(hands, 0.9) : c
  ));

  // --- the arms ----------------------------------------------------------
  for (const key of ['armR', 'armL']) {
    const arm = P[key];
    const sleeve = clamp(Math.round(o.sleeve), 0, 12);
    for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const isEnd = face === 'bottom';
      const isTop = face === 'top';
      skin.mapRect(arm.rects[face], (u, v, c, w, h) => {
        if (isEnd) return grain(lit(sleeve >= 12 ? shirt : hands, face), 0.6);
        if (isTop) return grain(lit(sleeve > 0 ? shade(shirt, 1.04) : hands, face), 0.6);
        const inSleeve = v < sleeve;
        const base = inSleeve ? shirt : hands;
        let col = cloth(base, face)(u, v, c, w, h);
        if (v === sleeve - 1) col = shade(col, 0.88);          // the cuff
        if (!inSleeve && v === sleeve) col = shade(col, 1.05);  // the wrist
        if (!inSleeve && v >= 10) col = shade(col, 0.93);       // fingers
        return col;
      });
    }
  }

  // --- the legs ----------------------------------------------------------
  for (const key of ['legR', 'legL']) {
    const leg = P[key];
    const boot = clamp(Math.round(o.boot), 0, 12);
    const hem = 12 - boot;
    for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const isSole = face === 'bottom';
      const isHip = face === 'top';
      skin.mapRect(leg.rects[face], (u, v, c, w, h) => {
        if (isSole) return grain(lit(shade(shoes, 0.72), face), 0.5);
        if (isHip) return grain(lit(shade(trousers, 1.02), face), 0.6);
        const inBoot = v >= hem;
        const base = inBoot ? shoes : trousers;
        let col = cloth(base, face)(u, v, c, w, h);
        if (v === hem) col = shade(col, 1.08);                 // the shoe's rim
        if (v === hem - 1) col = shade(col, 0.86);             // the turn-up
        if (inBoot && v === 11) col = shade(col, 0.80);        // the welt
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
 * The starting point when the app is opened cold, and what "clear" goes back
 * to: a plain figure in the chosen colours, so the painter always has
 * something to paint on and the preview is never an empty box.
 */
export function blank(skin, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const pal = {
    hair: hexToRgb(o.colours.hair || '#40342a'),
    skin: hexToRgb(o.colours.skin || '#e0ac7e'),
    shirt: hexToRgb(o.colours.shirt || '#3b6ea5'),
    trousers: hexToRgb(o.colours.trousers || '#33405e'),
    shoes: hexToRgb(o.colours.shoes || '#2b2521'),
    src: Object.fromEntries(['hair', 'skin', 'shirt', 'trousers', 'shoes']
      .map((k) => [k, o.colours[k] ? 'yours' : 'made'])),
  };
  const noise = rng(o.seed);
  const grain = (c, k = 1) => {
    if (!o.grain) return c;
    const n = (noise() - 0.5) * o.grain * 22 * k;
    return [clamp255(c[0] + n), clamp255(c[1] + n), clamp255(c[2] + n), 255];
  };
  const lit = (c, face) => shade(c, 1 + (LIGHT[face] - 1) * o.shading * 1.6);
  const P = {};
  for (const p of parts(o.slim)) P[p.key] = p;
  const head = P.head;
  const hairRow = (v) => v <= 2;
  for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
    skin.mapRect(head.rects[face], (u, v) => {
      if (face === 'top') return grain(lit(pal.hair, face), 0.6);
      if (face === 'bottom') return grain(lit(shade(pal.skin, 0.78), face), 0.4);
      const hair = face === 'back' ? v <= 5 : hairRow(v);
      let c = hair ? pal.hair : pal.skin;
      if (face === 'front' && v === 4 && (u === 2 || u === 5)) c = [56, 48, 44];
      if (face === 'front' && v === 4 && (u === 1 || u === 6)) c = [238, 236, 232];
      if (face === 'front' && v === 6 && u >= 3 && u <= 4) c = shade(pal.skin, 0.72);
      return grain(lit(c, face), 0.5);
    });
    skin.fillRect(head.overRects[face], [0, 0, 0, 0]);
  }
  dress(skin, P, pal, o, { lit, grain });
  return pal;
}
