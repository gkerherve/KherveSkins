// A person, out of four photographs.
//
// This is real three-dimensional reconstruction, by the one method that works
// without a machine-learning model, without a build step and without knowing
// anything about lenses: **shape from silhouette**, also called the visual
// hull. It is worth saying plainly how it works, because it sounds like magic
// and is arithmetic:
//
//   Stand still. Photograph the person from the front, the right, the back
//   and the left. In each photograph, work out which pixels are PERSON and
//   which are room. Now take a block of space where the person stood, chop it
//   into little cubes, and ask of every cube: in each of the four pictures,
//   does this cube land on the person or on the room? Land on the room even
//   once, and the cube was never there — carve it away. What is left is the
//   person.
//
// It cannot see into a dimple and it cannot see between an arm and a ribcage
// — a hull is the tightest shape the outlines allow, never tighter. For a
// photorealistic bust that is a fatal limitation. For a man made of cubes it
// is not a limitation at all, which is why this is the right method HERE and
// the wrong one nearly everywhere else.
//
// Two things the guidance leans on, both consequences of the above:
//   - the camera must not move between shots, and the person must turn on
//     the spot, because the whole method assumes one axis of rotation;
//   - arms held slightly away from the body, or the hull fuses arm to torso
//     and the Minecraft man comes out as a barrel.

// ---------------------------------------------------------------------------
// telling a person from a room
// ---------------------------------------------------------------------------

/**
 * Which pixels are the person.
 *
 * Two ways, and the first is far better: if there is a photograph of the
 * empty room — the plate — then anything that differs from it is the thing
 * that was not there before, and that is the person. No colour rule, no
 * assumptions about complexion or clothing, works against a bookcase.
 *
 * Without a plate it falls back to flooding in from the edges of the frame,
 * which needs a plain wall and is the reason the guidance asks for one.
 */
export function silhouette(photo, plate, opts = {}) {
  const w = photo.w, h = photo.h;
  const mask = new Uint8Array(w * h);
  const tol = opts.tol === undefined ? 34 : opts.tol;

  if (plate && plate.w === w && plate.h === h) {
    // The phone re-metered between the shots, so the plate and this frame do
    // not agree about how bright the room is. Corrected first, or nothing
    // below means anything.
    const g = exposureGain(photo, plate);
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      const pr = plate.data[k] * g[0], pg = plate.data[k + 1] * g[1], pb = plate.data[k + 2] * g[2];
      const cr = photo.data[k], cg = photo.data[k + 1], cb = photo.data[k + 2];
      mask[i] = isRoom(cr, cg, cb, pr, pg, pb, tol) ? 0 : 1;
    }
  } else {
    // no plate: the room is whatever the edge of the frame is, and whatever
    // is joined to it
    const edge = [0, 0, 0];
    let n = 0;
    const sampleEdge = (x, y) => {
      const k = (y * w + x) * 4;
      edge[0] += photo.data[k]; edge[1] += photo.data[k + 1]; edge[2] += photo.data[k + 2];
      n++;
    };
    for (let x = 0; x < w; x += 3) { sampleEdge(x, 0); sampleEdge(x, h - 1); }
    for (let y = 0; y < h; y += 3) { sampleEdge(0, y); sampleEdge(w - 1, y); }
    for (let k = 0; k < 3; k++) edge[k] /= n;
    mask.fill(1);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (!mask[i]) return;
      const k = i * 4;
      if (!isRoom(photo.data[k], photo.data[k + 1], photo.data[k + 2],
        edge[0], edge[1], edge[2], tol)) return;
      mask[i] = 0;
      stack.push(i);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
  }

  clean(mask, w, h);
  keepLargest(mask, w, h);
  fillHoles(mask, w, h);
  // `mw`/`mh` are the PICTURE, `x/y/w/h` are the person in it. Two different
  // sizes with the obvious names, and the mask is indexed by the first —
  // spread the box over the picture's own w and h and every projection into
  // the mask reads the wrong row, silently, and the carve returns nothing.
  return { mask, mw: w, mh: h, ...bounds(mask, w, h) };
}

/**
 * How much brighter this frame is than the plate.
 *
 * A phone re-meters between shots. It is not a small effect and it is not
 * optional to handle: a wall at 220 coming back at 190 differs by ninety
 * across three channels, which IS the whole threshold — so on the darker
 * shots the entire room registers as the person, the outline becomes the
 * frame, and the carve is left with a handful of chips. On a real capture,
 * measured, one shot in eight came back with eighty-seven per cent of the
 * picture marked as somebody standing in it.
 *
 * Measured on a ring round the edge of the frame, which is room in both
 * pictures, and taken as a MEDIAN so that a foot or an elbow poking into the
 * ring does not set the exposure for the whole photograph.
 */
function exposureGain(photo, plate) {
  const w = photo.w, h = photo.h;
  const band = Math.max(4, Math.round(Math.min(w, h) * 0.07));
  const step = Math.max(1, Math.round(Math.min(w, h) / 90));
  const r = [[], [], []];
  const take = (x, y) => {
    const k = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const p = plate.data[k + c];
      if (p < 18) continue;                 // a ratio off near-black is noise
      r[c].push(photo.data[k + c] / p);
    }
  };
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < band; x += step) { take(x, y); take(w - 1 - x, y); }
  }
  for (let x = 0; x < w; x += step) {
    for (let y = 0; y < band; y += step) { take(x, y); take(x, h - 1 - y); }
  }
  return r.map((list) => {
    if (list.length < 20) return 1;
    list.sort((a, b) => a - b);
    const m = list[list.length >> 1];
    return m > 0.4 && m < 2.5 ? m : 1;      // that is not exposure, that is a bug
  });
}

/**
 * Is this pixel the room rather than the person?
 *
 * Two ways of being the room, and the second one is what stops a person
 * standing in a puddle of their own shadow:
 *
 *   the same        it matches the plate, once the exposure is corrected
 *   the same, DIMMER  a shadow does not change what colour a wall is, it
 *                   changes how much light comes off it. So a pixel that is
 *                   the plate's colour MULTIPLIED DOWN — same ratios between
 *                   the channels, lower overall — is a shadow on the room,
 *                   not a person. Without this the outline grows a foot of
 *                   floor at the feet, and since every view is scaled on the
 *                   height of the outline, that foot of floor mis-scales
 *                   everything.
 *
 * A person fails both because clothes and skin are a different HUE from the
 * wall, not merely a different brightness. Which is exactly why the guidance
 * asks you not to wear the colour of the wall: against it, this cannot work
 * and nothing else can either.
 */
function isRoom(cr, cg, cb, pr, pg, pb, tol) {
  const d = Math.abs(cr - pr) + Math.abs(cg - pg) + Math.abs(cb - pb);
  if (d < tol * 1.4) return true;                       // plainly the same
  // Compared as CHROMATICITY — the colour with the brightness divided out —
  // because that is the quantity a shadow leaves alone and a person does not.
  // Measured on the test room: a shadow moves it by about five thousandths, a
  // pale green shirt against a white door by fifty, bare skin by ninety. The
  // line goes in the gap, and it is a wide gap.
  const cs = cr + cg + cb + 3, ps = pr + pg + pb + 3;
  const bright = cs / ps;
  if (bright > 1.10 || bright < 0.26) return false;      // too far to be shading
  const dx = cr / cs - pr / ps, dy = cg / cs - pg / ps;
  return Math.hypot(dx, dy) < 0.024;
}

/** Rub out speckle: a pixel with almost no company was noise, not a person. */
function clean(mask, w, h) {
  const out = new Uint8Array(mask);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        let n = 0;
        for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) n += mask[i + j * w + k];
        out[i] = n >= 5 ? 1 : 0;
      }
    }
    mask.set(out);
  }
}

/**
 * A person is opaque, so a hole INSIDE their outline is always a mistake —
 * a shiny forehead that matched the wall, glasses, a dark eye against a dark
 * doorway. Left in, each one is a tunnel bored straight through the volume:
 * the carve trusts every view, so one bad patch in one photograph gouges the
 * whole head. Flood the empty pixels in from the frame's edge; whatever the
 * flood cannot reach is enclosed, and enclosed means person.
 */
function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!mask[i] && !seen[i]) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
}

/** One person, not a person and a shadow and a coat on a hook. */
function keepLargest(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    stack.length = 0;
    stack.push(s);
    lab[s] = id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      n++;
      const ns = [p - 1, p + 1, p - w, p + w];
      for (let k = 0; k < 4; k++) {
        const q = ns[k];
        if (q < 0 || q >= mask.length || !mask[q] || lab[q] >= 0) continue;
        if (k < 2 && Math.abs((q % w) - x) !== 1) continue;
        lab[q] = id;
        stack.push(q);
      }
    }
    sizes.push(n);
  }
  if (sizes.length < 2) return;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < mask.length; i++) if (mask[i] && lab[i] !== best) mask[i] = 0;
}

function bounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0, area: 0, headX: 0 };
  // Where the head is, across the frame — and that is the number the whole
  // carve is lined up on. A person turning on the spot keeps their HEAD over
  // the axis; the middle of their outline does not, because a shoulder is
  // wider than a chest and an arm swings. Line four views up on their
  // silhouette centres and the hull comes out lopsided; line them up on the
  // head and it does not.
  const headTo = y0 + Math.round((y1 - y0) * 0.15);
  let sum = 0, count = 0;
  for (let y = y0; y <= headTo; y++) {
    for (let x = x0; x <= x1; x++) if (mask[y * w + x]) { sum += x; count++; }
  }
  return {
    x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1,
    area: n / (w * h),
    headX: count ? sum / count : (x0 + x1) / 2,
  };
}

/**
 * How WIDE the outline is on each row — left edge to right edge, not the count
 * of pixels between them.
 *
 * The distinction is the difference between finding a neck and finding an eye.
 * A mask is never solid: a dark eye against a dark doorway, a shadow under a
 * chin, a pair of glasses — any of them can come out as room, and each leaves
 * a hole. Counting pixels, a row with two eyes punched out of it is "narrow",
 * and narrow is exactly what a neck looks like. Measured edge to edge a hole
 * changes nothing, because a face with holes in it is still as wide as a face.
 *
 * This cost an afternoon: three views of a test figure reported a head thirty
 * pixels tall and the other five reported a hundred and twenty, and the three
 * were precisely the ones with eyes in them.
 */
function rowWidths(sil) {
  const rows = new Int32Array(sil.h);
  const xa = Math.max(0, sil.x), xb = Math.min(sil.mw, sil.x + sil.w);
  for (let j = 0; j < sil.h; j++) {
    const y = sil.y + j;
    if (y < 0 || y >= sil.mh) continue;
    let lo = -1, hi = -1;
    for (let x = xa; x < xb; x++) {
      if (!sil.mask[y * sil.mw + x]) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    rows[j] = lo < 0 ? 0 : hi - lo + 1;
  }
  return rows;
}

/**
 * Where the neck is, as a row of the outline — found as a PINCH, at whatever
 * depth it happens to sit.
 *
 * Walking down from the crown, the neck is the first row that is much
 * narrower than the widest thing above it and widens again just below. Both
 * halves of that are needed. Without "narrower than above", the taper at the
 * very top of the skull qualifies and the band is a cap. Without "widens
 * below", a head photographed with no shoulders in the frame at all has its
 * chin taken for a neck.
 *
 * Measuring against the widest row ABOVE rather than against a fixed number
 * is what makes it work at any framing and any distance: it is a ratio, so a
 * head sixty pixels tall and a head six hundred pixels tall pinch by the same
 * amount.
 */
function neckRow(rows, h) {
  const top = Math.max(2, Math.round(h * 0.06));
  const bottom = Math.round(h * 0.80);
  const reach = Math.max(3, Math.round(h * 0.16));
  let above = 0;
  for (let j = 0; j < top; j++) above = Math.max(above, rows[j]);

  for (let j = top; j < bottom; j++) {
    above = Math.max(above, rows[j - 1]);
    if (above < 4 || !rows[j]) continue;
    if (rows[j] > above * 0.62) continue;
    let below = 0;
    for (let k = j + 1; k <= Math.min(h - 1, j + reach); k++) below = Math.max(below, rows[k]);
    if (below < rows[j] * 1.25) continue;
    // the bottom of the pinch, not its first row — a neck is several rows
    // deep and the narrowest of them is the join
    let best = j;
    for (let k = j; k <= Math.min(bottom - 1, j + Math.max(2, Math.round(h * 0.06))); k++) {
      if (rows[k] && rows[k] < rows[best]) best = k;
    }
    return best;
  }

  // No pinch anywhere: either the shoulders are out of frame or the outline
  // is a mess. A seventh of the way down is where a standing figure's neck
  // is, and it is a better guess than the whole picture.
  return Math.max(4, Math.round(h * 0.14));
}

/**
 * The head, cut out of a whole-body outline.
 *
 * Everything downstream — the scale, the centring, the volume — is driven by
 * the silhouette's `y`, `h` and `headX`, so restricting the carve to a head
 * is a matter of handing it a silhouette that SAYS it is a head. The mask is
 * untouched: the volume simply never reaches down as far as the shoulders.
 *
 * The neck is a PINCH and it is found by looking for a pinch, not by looking
 * a fixed distance down. That distinction is the whole of this function's
 * history: written as "the narrowest row in the top third" it assumed a
 * standing figure photographed head to foot, where the neck is about an
 * eighth of the way down. Somebody who photographs their HEAD — which is what
 * people actually do when they want a face — hands it a picture whose neck is
 * halfway down, and the search never reaches it. The band came back as a slice
 * of scalp and the head-only carve was nonsense.
 *
 * So: walk down, and take the first row that is much narrower than the widest
 * thing above it and widens again below. In a full-length photograph that
 * lands at an eighth; in a head-and-shoulders one it lands at a half; and it
 * cannot run on to the waist or the gap between the ankles, which are pinches
 * too, because the neck is the first one.
 *
 * Worth doing because a head is nearly CONVEX, and a visual hull is exact for
 * convex things. A body is not: arms and legs stand off it, and the hull can
 * only ever be the tightest box the outlines allow round all of them. So the
 * same photographs describe a head far better than they describe a person —
 * and the head is the half anybody recognises.
 */
export function headOf(sil) {
  if (!sil || sil.h < 12) return sil;
  const rows = rowWidths(sil);
  const neck = neckRow(rows, sil.h);
  const h = Math.max(6, neck + 1);
  let x0 = sil.mw, x1 = -1, n = 0, sum = 0, count = 0;
  const crown = Math.round(h * 0.35);
  for (let j = 0; j < h; j++) {
    const y = sil.y + j;
    if (y < 0 || y >= sil.mh) continue;
    for (let x = Math.max(0, sil.x); x < Math.min(sil.mw, sil.x + sil.w); x++) {
      if (!sil.mask[y * sil.mw + x]) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (j <= crown) { sum += x; count++; }
    }
  }
  if (x1 < 0) return sil;
  return {
    ...sil,
    x: x0,
    y: sil.y,
    w: x1 - x0 + 1,
    h,
    area: n / (sil.mw * sil.mh),
    headX: count ? sum / count : (x0 + x1) / 2,
  };
}

// ---------------------------------------------------------------------------
// the carve
// ---------------------------------------------------------------------------

/** A block of space, chopped into cubes. */
export class Volume {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.solid = new Uint8Array(nx * ny * nz);
    this.colour = new Uint8Array(nx * ny * nz * 3);
  }

  at(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    return this.solid[(y * this.nz + z) * this.nx + x];
  }

  idx(x, y, z) { return (y * this.nz + z) * this.nx + x; }

  colourAt(x, y, z) {
    const i = this.idx(x, y, z) * 3;
    return [this.colour[i], this.colour[i + 1], this.colour[i + 2]];
  }

  /** Every solid cube with at least one empty neighbour: the skin of it. */
  surface() {
    const out = [];
    for (let y = 0; y < this.ny; y++) {
      for (let z = 0; z < this.nz; z++) {
        for (let x = 0; x < this.nx; x++) {
          if (!this.at(x, y, z)) continue;
          if (this.at(x + 1, y, z) && this.at(x - 1, y, z) && this.at(x, y + 1, z)
            && this.at(x, y - 1, z) && this.at(x, y, z + 1) && this.at(x, y, z - 1)) continue;
          out.push([x, y, z]);
        }
      }
    }
    return out;
  }

  count() {
    let n = 0;
    for (const v of this.solid) n += v;
    return n;
  }
}

/**
 * Carve the person out of a block of space.
 *
 * @param {Array} views  [{ photo, sil, angle }] — angle in degrees, 0 is
 *                       facing the camera, going the way the person turned
 * @param {object} o     grid size
 */
const median = (list) => {
  const v = [...list].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

export function carve(views, o = {}) {
  const ny = o.ny || 72;
  const nx = o.nx || 40;
  const nz = o.nz || 40;
  const vol = new Volume(nx, ny, nz);

  // ONE scale for every view — the MEDIAN of what the outlines said, never
  // each view's own.
  //
  // This is the fix for a carve that comes out as a cloud of chips. The
  // camera did not move and the person did not grow, so they are the same
  // height in every shot — any disagreement is an outline that caught a
  // shadow or lost a foot. Let such a view set its own scale and its whole
  // projection is stretched by a fifth, which slices the volume to ribbons;
  // take the median and one bad outline costs a little accuracy instead of
  // most of the person.
  //
  // WHERE the person sits in the frame, though, is per-view, in BOTH axes.
  // Across was always per-view (headX); the crown row used to be the median
  // too, and that assumption is simply false of real photographs: a handheld
  // phone bobs a little between shots, so the head is at a different height
  // in every frame. Anchor every view to one shared row and each one carves
  // its own copy of the person a few cubes above or below the others' — the
  // intersection loses the crown in steps and the chin in slivers. Measured
  // on a portrait set bobbing by ±18px: 959 cubes of head gone. Each view's
  // own crown row is the anchor, clamped to the median ± a sixth of the
  // height so one outline that caught something above the head cannot drag
  // its whole projection off the person.
  const medH = median(views.map((v) => v.sil.h));
  const medTop = median(views.map((v) => v.sil.y));
  const scale = medH / ny;
  const slack = medH * 0.16;

  const cams = views.map((v) => {
    const a = (v.angle || 0) * Math.PI / 180;
    return {
      sil: v.sil,
      photo: v.photo,
      cos: Math.cos(a),
      sin: Math.sin(a),
      scale,
      top: Math.max(medTop - slack, Math.min(medTop + slack, v.sil.y)),
      cx: v.sil.headX,
      // Which way this camera looks FROM — the outward normal of the surface
      // it can see. Both signs are negative and the x one was wrong for a
      // long time, so it is worth writing down how it is settled rather than
      // argued: the projection above is px = cx + (dx·cos − dz·sin)·scale,
      // and the depth orthogonal to it is dx·sin + dz·cos, growing AWAY from
      // the camera. So the camera stands at minus that, (−sin a, 0, −cos a).
      //
      // The measurement that agrees: `tools/make_test_room9.py --mark` paints
      // his right arm red and his left arm blue, and in the front photograph
      // the red one lands on the LEFT of the frame — which is what "his
      // right" MEANS and needs no convention to state. At 90° only the red
      // arm is visible. So 90° sees his right side, which is the low end of
      // x, which is (−1, 0, 0). Written +sin, `paint` handed every cube on
      // his left the colour of the camera looking at his right: a figure
      // whose two sides had swapped, and nothing symmetrical could show it.
      dir: [-Math.sin(a), 0, -Math.cos(a)],
    };
  });

  // With enough angles a cube may miss ONE of them and still be kept. Four
  // views have no votes to spare, but by seven the outlines outnumber the
  // mistakes, and one blown edge should not punch a hole through a shoulder.
  const allowMiss = o.allowMiss === undefined
    ? (views.length >= 7 ? 1 : 0) : o.allowMiss;

  const half = (nx - 1) / 2, halfZ = (nz - 1) / 2;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const dx = x - half, dz = z - halfZ;
        let missed = 0;
        for (const c of cams) {
          // turn the cube into the camera's frame, then look straight at it
          const u = dx * c.cos - dz * c.sin;
          const px = Math.round(c.cx + u * c.scale);
          const py = Math.round(c.top + y * c.scale);
          const out = px < 0 || py < 0 || px >= c.sil.mw || py >= c.sil.mh
            || !c.sil.mask[py * c.sil.mw + px];
          if (out && ++missed > allowMiss) break;
        }
        if (missed <= allowMiss) vol.solid[vol.idx(x, y, z)] = 1;
      }
    }
  }

  tidy(vol);
  paint(vol, cams);
  vol.info = { scale, medH, medTop, allowMiss, views: views.length };
  return vol;
}

/**
 * Close the pinholes and rub out the chips.
 *
 * A hull carved from photographs is never quite solid: a stray pixel in one
 * outline pokes a hole through a chest, and a stray pixel the other way
 * leaves a cube hanging in the air beside an ear. Both read as the carve
 * having failed even when it mostly worked.
 *
 * Fill first, then drop. Anything with company on five of its six sides was
 * a hole; anything with company on fewer than two was never part of a
 * person.
 */
function tidy(vol) {
  const { nx, ny, nz } = vol;
  const around = (x, y, z) => (
    vol.at(x + 1, y, z) + vol.at(x - 1, y, z) + vol.at(x, y + 1, z)
    + vol.at(x, y - 1, z) + vol.at(x, y, z + 1) + vol.at(x, y, z - 1)
  );
  const fill = [];
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!vol.at(x, y, z) && around(x, y, z) >= 5) fill.push(vol.idx(x, y, z));
      }
    }
  }
  for (const i of fill) vol.solid[i] = 1;

  const drop = [];
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (vol.at(x, y, z) && around(x, y, z) < 2) drop.push(vol.idx(x, y, z));
      }
    }
  }
  for (const i of drop) vol.solid[i] = 0;
}

/**
 * Give every cube on the surface a colour.
 *
 * From whichever camera is most nearly looking AT it — worked out from the
 * direction the cube faces, which is worked out from where its empty
 * neighbours are. Take the colour from a camera looking along the surface
 * instead and you get the smear at the edge of the person, which draws a
 * bright rim round the whole figure.
 */
function paint(vol, cams) {
  const { nx, ny, nz } = vol;
  const half = (nx - 1) / 2, halfZ = (nz - 1) / 2;
  for (const c of cams) c.midY = c.top + (ny * c.scale) / 2;

  const inside = (c, px, py) => px >= 0 && py >= 0 && px < c.sil.mw && py < c.sil.mh
    && c.sil.mask[py * c.sil.mw + px];

  // A projected sample point is allowed to be a pixel or two OFF the person —
  // the hull is a cube-sized approximation of them, so a cube's centre can
  // overhang the outline — and near the crown it usually is. Sampled where it
  // lands, that pixel is the WALL, and the head comes back with a scattering
  // of wall-coloured chips across the top and a pale rim down every edge:
  // 167 chips on the bobbing test set, five per cent of the whole surface.
  // So walk the point toward the middle of the person until it lands on
  // them, then two steps more — the blurred pixel where hair meets wall
  // belongs to neither.
  const seat = (c, px, py, reach) => {
    const dx = Math.sign(c.cx - px) || 1;
    const dy = Math.sign(c.midY - py) || 1;
    let x = px, y = py;
    for (let i = 0; i <= reach; i++) {
      if (inside(c, Math.round(x), Math.round(y))) {
        const ix = Math.round(x + dx * 2), iy = Math.round(y + dy * 2);
        return inside(c, ix, iy) ? [ix, iy] : [Math.round(x), Math.round(y)];
      }
      x += dx * 0.9; y += dy * 0.9;
    }
    return null;
  };

  // One cube covers scale-by-scale pixels of photograph, so one pixel of
  // photograph is the wrong amount to ask: it carries that pixel's noise, and
  // neighbouring cubes land on unrelated pixels, which is what gave the whole
  // surface a static of vertical stripes. Average the patch the cube actually
  // covers — person pixels only.
  const patch = (c, px, py) => {
    const r = Math.max(1, Math.round(c.scale * 0.45));
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (!inside(c, px + i, py + j)) continue;
        const col = c.photo.px(px + i, py + j);
        sr += col[0]; sg += col[1]; sb += col[2]; n++;
      }
    }
    if (!n) { const col = c.photo.px(px, py); return [col[0], col[1], col[2]]; }
    return [sr / n, sg / n, sb / n];
  };

  const project = (c, x, y, z) => {
    const u = (x - half) * c.cos - (z - halfZ) * c.sin;
    return [Math.round(c.cx + u * c.scale), Math.round(c.top + y * c.scale)];
  };

  for (const [x, y, z] of vol.surface()) {
    const n = [
      (vol.at(x + 1, y, z) ? 0 : 1) - (vol.at(x - 1, y, z) ? 0 : 1),
      (vol.at(x, y + 1, z) ? 0 : 1) - (vol.at(x, y - 1, z) ? 0 : 1),
      (vol.at(x, y, z + 1) ? 0 : 1) - (vol.at(x, y, z - 1) ? 0 : 1),
    ];
    // every camera, most nearly facing this cube first — so when the best
    // one's sample point cannot be seated on the person, the second one gets
    // asked rather than the wall
    const ranked = [...cams].sort((a, b) => (n[0] * b.dir[0] + n[2] * b.dir[2])
      - (n[0] * a.dir[0] + n[2] * a.dir[2]));
    let colour = null;
    for (const c of ranked) {
      const [px, py] = project(c, x, y, z);
      const at = seat(c, px, py, Math.ceil(c.scale) + 3);
      if (at) { colour = patch(c, at[0], at[1]); break; }
    }
    if (!colour) {
      // nothing close: take the best-facing view and march as far as it needs
      const c = ranked[0];
      const [px, py] = project(c, x, y, z);
      const at = seat(c, px, py, Math.round(ny * c.scale));
      colour = at ? patch(c, at[0], at[1])
        : c.photo.px(Math.max(0, Math.min(c.sil.mw - 1, px)),
                     Math.max(0, Math.min(c.sil.mh - 1, py)));
    }
    const i = vol.idx(x, y, z) * 3;
    vol.colour[i] = colour[0]; vol.colour[i + 1] = colour[1]; vol.colour[i + 2] = colour[2];
  }
}

/**
 * How the carve went, in words a person can act on.
 *
 * A hull built from bad outlines is not obviously wrong to look at — it is
 * just a slightly odd person — so it is worth saying out loud when the
 * numbers were poor.
 */
export function report(views, vol, wholeViews) {
  const notes = [];
  // The area checks judge the WHOLE outline, even when the carve was cut down
  // to the head: a head band is a fiftieth of the frame on any good capture,
  // and judged on its own it trips "almost nothing in it" every time.
  const areas = (wholeViews || views).map((v) => v.sil.area);
  const medH = median(views.map((v) => v.sil.h));
  if (Math.min(...areas) < 0.02) {
    notes.push('one shot has almost nothing in it — take the empty room, or find a plainer wall');
  }
  if (Math.max(...areas) > 0.55) {
    notes.push('one shot is mostly foreground — the camera may have moved');
  }
  // NAMED, because "one of them is wrong" is something a person can act on
  // and "they disagree" is not
  const odd = views
    .map((v, i) => ({ i, name: v.name, off: Math.abs(v.sil.h - medH) / medH }))
    .filter((v) => v.off > 0.14);
  if (odd.length) {
    notes.push(`a different size in ${odd.map((v) => v.name || 'one turn').join(' and ')}`
      + ' — retake from the same spot, and it will be ignored meanwhile');
  }
  const filled = vol.count() / (vol.nx * vol.ny * vol.nz);
  if (filled < 0.006) notes.push('very little survived — the outlines disagree badly');
  if (views.length < 6) notes.push(`${views.length} turns works, but more fills it out`);
  return { notes, filled, views: views.length, odd: odd.map((v) => v.i) };
}
