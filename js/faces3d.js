// A head from every side, put straight onto the cube.
//
// This is the answer to "is a carve the best way to do a face", and it is no.
// A carve is the right tool for a BODY, where the whole question is where the
// arms and legs are. A Minecraft head is a fixed cube; its shape is not in
// question and never was. What lands on the skin is the COLOUR of six flat
// squares — so the sharpest possible answer is to take, for each square, the
// photograph shot most nearly from that direction and sample it straight in.
//
// Going through a hull instead costs two resamplings: the photographs are
// averaged into cubes, and the cubes are then averaged into texels. Every one
// of those steps is a blur, and a face at sixteen pixels across cannot spare
// any. The hull is still worth building — it is the thing you spin, and it is
// how the app knows the head's own proportions — but it should not be in the
// path between the photograph and the face.
//
// The one refinement worth keeping from the single-photograph path is the
// WARP: on the front square, the eye line, the mouth line and both eye
// columns are pinned to whole texels before anything is averaged. It is the
// single biggest thing separating a face from a smear, and it applies here
// exactly as it does there.

import { part } from './layout.js';
import { shade, mix, clamp255 } from './pixels.js';
import { autoFace, sampleFace, sampleRect } from './photo.js';
import { headOf } from './carve.js';

// Which way each square of the head looks, as a camera angle. A camera at
// angle t sees the surface whose outward normal is (sin t, 0, -cos t), so the
// front square — normal -Z — is the photograph taken at nought.
const FACE_ANGLE = { front: 0, right: 90, back: 180, left: 270 };

const median = (list) => {
  const v = [...list].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/** How far apart two angles are, the short way round. Nought means the same. */
const apart = (a, b) => {
  const d = ((a - b) % 360 + 360) % 360;
  return Math.min(d, 360 - d);
};

/**
 * Put a head on the skin, one square at a time.
 *
 * @param {Skin} skin
 * @param {Array} views  [{ photo, sil, angle }] — whole-body outlines are fine
 * @param {object} o     tone controls, and `slim`
 * @returns {object} which photograph went on which square, and how square-on
 */
export function facesFromViews(skin, views, o = {}) {
  const size = skin.size;
  const head = part('head', o.slim, size);
  const N = head.rects.front[2];              // the face, in texels across
  const bands = views.map((v) => ({ ...v, band: headOf(v.sil) })).filter((v) => v.band);
  if (!bands.length) return null;

  // One height for every square, because a hairline that steps up half a
  // texel between the front of the head and its side reads as a crack.
  const medH = median(bands.map((b) => b.band.h));
  const used = {};

  for (const face of ['front', 'right', 'back', 'left']) {
    const want = FACE_ANGLE[face];
    let best = null, bestOff = Infinity;
    for (const b of bands) {
      const off = apart(b.angle, want);
      if (off < bestOff) { bestOff = off; best = b; }
    }
    if (!best) continue;
    used[face] = { name: best.name, angle: best.angle, off: Math.round(bestOff) };

    const band = best.band;
    // The same head HEIGHT everywhere, hung off this view's own crown — but
    // each view's own WIDTH, because a head is wider seen from the front than
    // in profile and that is the whole point of taking both. Sized by a ratio
    // instead, the box reaches past the ears and the squares come back with a
    // stripe of wall down each side.
    const top = band.y;
    const h = medH;
    // a hair's inset all round: an outline is a pixel or two generous at its
    // edge — the blur where hair meets wall belongs to neither — and those
    // two pixels land on a whole texel of a sixteen-wide face
    const bleed = Math.max(1, band.w * 0.035);
    const w = Math.max(4, band.w - bleed * 2);
    const x = band.x + bleed;

    let grid = null;
    if (face === 'front' && bestOff < 32) {
      // the front is worth the warp: eyes and mouth pinned to whole texels
      const f = frameFor(best.photo, { x, y: top, w, h });
      if (f) grid = sampleFace(best.photo, f, N, N, o);
    }
    if (!grid) grid = sampleRect(best.photo, x, top, w, h, N, N);

    grid = grid.map((c) => tone(c, o));
    skin.mapRect(head.rects[face], (u, v) => grid[v * N + u]);
  }

  // The top and the underneath, which nobody photographs. Taken from the
  // colours the other squares already found — the crown from the top row of
  // the back of the head, the jaw from the bottom row of the front — so they
  // belong to the same person in the same light.
  const rowOf = (face, v) => {
    const r = head.rects[face];
    const out = [];
    for (let u = 0; u < r[2]; u++) out.push(skin.get(r[0] + u, r[1] + v));
    return out;
  };
  const crown = rowOf('back', 0);
  const front0 = rowOf('front', 0);
  const jaw = rowOf('front', head.rects.front[3] - 1);
  const meanOf = (rows) => {
    const acc = [0, 0, 0];
    let n = 0;
    for (const row of rows) for (const c of row) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
    return n ? [acc[0] / n, acc[1] / n, acc[2] / n] : [128, 128, 128];
  };
  const hair = meanOf([crown, front0]);
  const under = meanOf([jaw]);
  skin.mapRect(head.rects.top, (u, v, cur, w, h) => (
    shade(hair, 1.06 - (v / h) * 0.10)
  ));
  skin.mapRect(head.rects.bottom, (u, v, cur, w, h) => {
    const neck = u >= w * 0.25 && u < w * 0.75 && v >= h * 0.25 && v < h * 0.75;
    return shade(under, neck ? 0.86 : 0.72);
  });

  // nothing wears a hat straight out of a photograph
  for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
    skin.fillRect(head.overRects[face], [0, 0, 0, 0]);
  }
  return used;
}

/**
 * The eye and mouth lines, for the one square that has a face on it.
 *
 * `autoFace` looks at the whole photograph and finds a head; here the head is
 * already known, so its answer is only used for the two lines and the two eye
 * columns inside the box we already have. If it disagrees wildly about where
 * the head is — it found somebody else, or a lamp — its lines are no use and
 * the square falls back to a plain sample.
 */
function frameFor(photo, box) {
  let f = null;
  try {
    f = autoFaceSync(photo);
  } catch { f = null; }
  if (!f) return null;
  const drift = Math.abs(f.y - box.y) / Math.max(1, box.h);
  if (drift > 0.45) return null;
  const k = box.h / Math.max(1, f.h);
  return {
    ...box,
    tilt: f.tilt,
    eye: box.y + (f.eye - f.y) * k,
    mouth: box.y + (f.mouth - f.y) * k,
    eyeL: f.eyeL === null ? null : box.x + (f.eyeL - f.x) * (box.w / Math.max(1, f.w)),
    eyeR: f.eyeR === null ? null : box.x + (f.eyeR - f.x) * (box.w / Math.max(1, f.w)),
  };
}

// `autoFace` is async only because a browser's own face detector is; the
// fallback that does the work is not, and this path wants an answer now.
let heuristic = null;
export function primeHeuristic(fn) { heuristic = fn; }
function autoFaceSync(photo) {
  if (!heuristic) return null;
  return heuristic(photo);
}

/** The same tone controls the rest of the program uses. */
function tone(c, o) {
  let [r, g, b] = c;
  const k = 1 + (o.bright || 0);
  r *= k; g *= k; b *= k;
  const ct = 1 + (o.contrast === undefined ? 0.12 : o.contrast);
  r = (r - 128) * ct + 128;
  g = (g - 128) * ct + 128;
  b = (b - 128) * ct + 128;
  if (o.warmth) { r += o.warmth * 26; b -= o.warmth * 26; }
  const sat = 1 + (o.satur === undefined ? 0.16 : o.satur);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  return [clamp255(r), clamp255(g), clamp255(b), 255];
}

export { autoFace, mix };
