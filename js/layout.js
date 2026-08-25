// The shape of a Minecraft skin.
//
// A skin is a 64x64 PNG and nothing else. Everything in this file is the
// agreement between that image and the man it wraps: which rectangle is the
// front of his head, which is the back of his left calf, and where the
// second, baggier layer of him lives.
//
// One rule generates the lot. Every box in the model unwraps the same way —
// a top row of [top][bottom] and a row under it of [right][front][left][back]
// — so `boxRects` is the whole layout and a part is four numbers: where its
// unwrap starts, and how big the box is. Get this wrong by a pixel and the
// skin is still a valid PNG that Minecraft will happily wear with somebody's
// ear on their chin.

export const SKIN_W = 64;
export const SKIN_H = 64;

/** The six faces of one box, as [x, y, w, h] rectangles in the 64x64. */
export function boxRects(x0, y0, w, h, d) {
  return {
    top:    [x0 + d,             y0,     w, d],
    bottom: [x0 + d + w,         y0,     w, d],
    right:  [x0,                 y0 + d, d, h],
    front:  [x0 + d,             y0 + d, w, h],
    left:   [x0 + d + w,         y0 + d, d, h],
    back:   [x0 + d + w + d,     y0 + d, w, h],
  };
}

export const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];

// The model, in skin pixels, with the ground at y = 0 and the figure facing
// -Z — the same way PlanetCraft's own avatar faces, so a camera at -Z is a
// portrait. His RIGHT hand is therefore at +X, which is why the arm called
// `armR` is the one on the left of the screen.
//
//   legs   0..12      body  12..24      head  24..32
//
// `arm` is the classic 4-wide arm; the slim build narrows it to 3 and moves
// the shoulder in by half a pixel, which is the entire difference between
// Steve and Alex.
const PART_DEFS = [
  { key: 'head', name: 'head',      base: [0, 0],   over: [32, 0],  size: [8, 8, 8],   at: [0, 28, 0],  pivot: [0, 24, 0] },
  { key: 'body', name: 'body',      base: [16, 16], over: [16, 32], size: [8, 12, 4],  at: [0, 18, 0],  pivot: [0, 24, 0] },
  { key: 'armR', name: 'right arm', base: [40, 16], over: [40, 32], size: [4, 12, 4],  at: [6, 18, 0],  pivot: [4, 24, 0], arm: 'R' },
  { key: 'armL', name: 'left arm',  base: [32, 48], over: [48, 48], size: [4, 12, 4],  at: [-6, 18, 0], pivot: [-4, 24, 0], arm: 'L' },
  { key: 'legR', name: 'right leg', base: [0, 16],  over: [0, 32],  size: [4, 12, 4],  at: [2, 6, 0],   pivot: [2, 12, 0] },
  { key: 'legL', name: 'left leg',  base: [16, 48], over: [0, 48],  size: [4, 12, 4],  at: [-2, 6, 0],  pivot: [-2, 12, 0] },
];

/**
 * Every part of the model, base and overlay rectangles resolved.
 *
 * @param {boolean} slim three-wide arms (Alex) rather than four (Steve)
 */
export function parts(slim = false) {
  return PART_DEFS.map((p) => {
    const [w, h, d] = p.size;
    const aw = p.arm && slim ? 3 : w;
    const at = p.arm ? [(p.arm === 'R' ? 1 : -1) * (4 + aw / 2), p.at[1], p.at[2]] : p.at;
    return {
      ...p,
      size: [aw, h, d],
      at,
      rects: boxRects(p.base[0], p.base[1], aw, h, d),
      overRects: boxRects(p.over[0], p.over[1], aw, h, d),
    };
  });
}

/** Everything about one part by name, e.g. `part('head')`. */
export function part(key, slim = false) {
  return parts(slim).find((p) => p.key === key);
}

// Which rectangles of the image belong to what, for the painter's guides and
// for "clear this part". Kept as a flat list because that is how the painter
// wants it: a texel is in exactly one of these, or it is in the dead space
// the format never reads.
export function regions(slim = false) {
  const out = [];
  for (const p of parts(slim)) {
    for (const f of FACES) {
      out.push({ part: p.key, name: p.name, face: f, layer: 'base', rect: p.rects[f] });
      out.push({ part: p.key, name: p.name, face: f, layer: 'over', rect: p.overRects[f] });
    }
  }
  return out;
}

/** Which part/face/layer a texel belongs to, or null for dead space. */
export function regionAt(x, y, slim = false) {
  for (const r of regions(slim)) {
    const [rx, ry, rw, rh] = r.rect;
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return r;
  }
  return null;
}

// The overlay is a second skin worn a shade larger than the first. Half a
// pixel of air on every side is enough to stop it fighting with the layer
// underneath, except on the head, where a full pixel is the convention and
// is what makes a hat read as a hat.
export const OVER_GROW = { head: 1.0, body: 0.5, armR: 0.5, armL: 0.5, legR: 0.5, legL: 0.5 };

// The parts of the 64x64 that no model ever reads. Handy for the painter,
// which greys them out, and for the generator, which leaves them alone.
export const DEAD_ZONES = [
  [0, 0, 8, 8], [24, 0, 8, 8], [40, 0, 8, 8], [56, 0, 8, 8],
  [0, 16, 0, 0],
];

/** True where the 64x64 is never sampled by the model. */
export function isDead(x, y, slim = false) {
  return regionAt(x, y, slim) === null;
}
