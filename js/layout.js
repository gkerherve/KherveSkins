// The shape of a Minecraft skin.
//
// A skin is a square PNG and nothing else. Everything in this file is the
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
//
// SIZE. The layout is written once, in sixty-fourths, and multiplied. 64 is
// the only size vanilla Java will take. 128 and 256 are the HD sizes — four
// and sixteen times the pixels, which for a FACE is the difference between
// eight across and thirty-two, and therefore the difference between a
// suggestion of somebody and a likeness. Everything downstream takes a size
// and nothing downstream hard-codes 64.

export const BASE = 64;
export const SIZES = [64, 128, 256];

/** How many image pixels to one sixty-fourth, at this size. */
export const scaleOf = (size) => (size || BASE) / BASE;

/** The six faces of one box, as [x, y, w, h] rectangles at a given size. */
export function boxRects(x0, y0, w, h, d, s = 1) {
  const m = (v) => Math.round(v * s);
  return {
    top:    [m(x0 + d),         m(y0),     m(w), m(d)],
    bottom: [m(x0 + d + w),     m(y0),     m(w), m(d)],
    right:  [m(x0),             m(y0 + d), m(d), m(h)],
    front:  [m(x0 + d),         m(y0 + d), m(w), m(h)],
    left:   [m(x0 + d + w),     m(y0 + d), m(d), m(h)],
    back:   [m(x0 + d + w + d), m(y0 + d), m(w), m(h)],
  };
}

export const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];

// The model, in sixty-fourths, with the ground at y = 0 and the figure facing
// -Z — the same way PlanetCraft's own avatar faces, so a camera at -Z is a
// portrait. His RIGHT hand is therefore at +X, which is why the arm called
// `armR` is the one on the left of the screen.
//
//   legs   0..12      body  12..24      head  24..32
//
// `arm` is the classic 4-wide arm; the slim build narrows it to 3 and moves
// the shoulder in by half, which is the entire difference between Steve and
// Alex.
const PART_DEFS = [
  { key: 'head', name: 'head',      base: [0, 0],   over: [32, 0],  size: [8, 8, 8],   at: [0, 28, 0],  pivot: [0, 24, 0] },
  { key: 'body', name: 'body',      base: [16, 16], over: [16, 32], size: [8, 12, 4],  at: [0, 18, 0],  pivot: [0, 24, 0] },
  { key: 'armR', name: 'right arm', base: [40, 16], over: [40, 32], size: [4, 12, 4],  at: [6, 18, 0],  pivot: [4, 24, 0], arm: 'R' },
  { key: 'armL', name: 'left arm',  base: [32, 48], over: [48, 48], size: [4, 12, 4],  at: [-6, 18, 0], pivot: [-4, 24, 0], arm: 'L' },
  { key: 'legR', name: 'right leg', base: [0, 16],  over: [0, 32],  size: [4, 12, 4],  at: [2, 6, 0],   pivot: [2, 12, 0] },
  { key: 'legL', name: 'left leg',  base: [16, 48], over: [0, 48],  size: [4, 12, 4],  at: [-2, 6, 0],  pivot: [-2, 12, 0] },
];

const partCache = new Map();

/**
 * Every part of the model, base and overlay rectangles resolved.
 *
 * `size`, `at` and `pivot` stay in sixty-fourths — they are the SHAPE of the
 * man, and he is the same man however finely he is painted. Only the
 * rectangles scale.
 *
 * @param {boolean} slim three-wide arms (Alex) rather than four (Steve)
 * @param {number} size the skin's edge in pixels: 64, 128 or 256
 */
export function parts(slim = false, size = BASE) {
  const key = `${slim ? 1 : 0}:${size}`;
  const had = partCache.get(key);
  if (had) return had;
  const s = scaleOf(size);
  const made = PART_DEFS.map((p) => {
    const [w, h, d] = p.size;
    const aw = p.arm && slim ? 3 : w;
    const at = p.arm ? [(p.arm === 'R' ? 1 : -1) * (4 + aw / 2), p.at[1], p.at[2]] : p.at;
    return {
      ...p,
      size: [aw, h, d],
      at,
      rects: boxRects(p.base[0], p.base[1], aw, h, d, s),
      overRects: boxRects(p.over[0], p.over[1], aw, h, d, s),
    };
  });
  partCache.set(key, made);
  return made;
}

/** Everything about one part by name, e.g. `part('head')`. */
export function part(key, slim = false, size = BASE) {
  return parts(slim, size).find((p) => p.key === key);
}

// The overlay is a second skin worn a shade larger than the first. Half a
// sixty-fourth of air on every side is enough to stop it fighting with the
// layer underneath, except on the head, where a whole one is the convention
// and is what makes a hat read as a hat. In sixty-fourths, like the rest of
// the model, so it does not change with the size of the image.
export const OVER_GROW = { head: 1.0, body: 0.5, armR: 0.5, armL: 0.5, legR: 0.5, legL: 0.5 };

// Which rectangles of the image belong to what, for the painter's guides and
// for "clear this part". Kept as a flat list because that is how the painter
// wants it: a texel is in exactly one of these, or it is in the dead space
// the format never reads.
const regionCache = new Map();

export function regions(slim = false, size = BASE) {
  const key = `${slim ? 1 : 0}:${size}`;
  const had = regionCache.get(key);
  if (had) return had;
  const out = [];
  for (const p of parts(slim, size)) {
    for (const f of FACES) {
      out.push({ part: p.key, name: p.name, face: f, layer: 'base', rect: p.rects[f] });
      out.push({ part: p.key, name: p.name, face: f, layer: 'over', rect: p.overRects[f] });
    }
  }
  regionCache.set(key, out);
  return out;
}

// A texel-by-texel index of the above.
//
// Not a nicety: the painter asks "what is this texel" for every texel of the
// image every time it redraws, and at 256 that is sixty-five thousand
// questions against seventy-two rectangles — three million comparisons for
// one frame of a canvas. Answered from a table it is sixty-five thousand
// array reads.
const mapCache = new Map();

export function regionMap(slim = false, size = BASE) {
  const key = `${slim ? 1 : 0}:${size}`;
  const had = mapCache.get(key);
  if (had) return had;
  const list = regions(slim, size);
  const map = new Int16Array(size * size).fill(-1);
  list.forEach((r, i) => {
    const [rx, ry, rw, rh] = r.rect;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) map[y * size + x] = i;
    }
  });
  mapCache.set(key, map);
  return map;
}

/** Which part/face/layer a texel belongs to, or null for dead space. */
export function regionAt(x, y, slim = false, size = BASE) {
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  const i = regionMap(slim, size)[y * size + x];
  return i < 0 ? null : regions(slim, size)[i];
}
