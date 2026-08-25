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
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      const d = Math.abs(photo.data[k] - plate.data[k])
        + Math.abs(photo.data[k + 1] - plate.data[k + 1])
        + Math.abs(photo.data[k + 2] - plate.data[k + 2]);
      mask[i] = d > tol * 3 ? 1 : 0;
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
      const d = Math.abs(photo.data[k] - edge[0])
        + Math.abs(photo.data[k + 1] - edge[1])
        + Math.abs(photo.data[k + 2] - edge[2]);
      if (d > tol * 3.4) return;
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
  // `mw`/`mh` are the PICTURE, `x/y/w/h` are the person in it. Two different
  // sizes with the obvious names, and the mask is indexed by the first —
  // spread the box over the picture's own w and h and every projection into
  // the mask reads the wrong row, silently, and the carve returns nothing.
  return { mask, mw: w, mh: h, ...bounds(mask, w, h) };
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

  // ONE scale and ONE crown row for every view, and both are the MEDIAN of
  // what the outlines said rather than each view's own.
  //
  // This is the fix for a carve that comes out as a cloud of chips. The
  // camera did not move and the person did not grow, so they are the same
  // height in every shot — any disagreement is an outline that caught a
  // shadow or lost a foot. Let such a view set its own scale and its whole
  // projection is stretched by a fifth, which slices the volume to ribbons;
  // take the median and one bad outline costs a little accuracy instead of
  // most of the person. Where the head sits ACROSS the frame stays per-view,
  // because that one really can shift a little between shots.
  const medH = median(views.map((v) => v.sil.h));
  const medTop = median(views.map((v) => v.sil.y));
  const scale = medH / ny;

  const cams = views.map((v) => {
    const a = (v.angle || 0) * Math.PI / 180;
    return {
      sil: v.sil,
      photo: v.photo,
      cos: Math.cos(a),
      sin: Math.sin(a),
      scale,
      top: medTop,
      cx: v.sil.headX,
      dir: [Math.sin(a), 0, -Math.cos(a)],   // which way this camera looks from
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
  for (const [x, y, z] of vol.surface()) {
    const n = [
      (vol.at(x + 1, y, z) ? 0 : 1) - (vol.at(x - 1, y, z) ? 0 : 1),
      (vol.at(x, y + 1, z) ? 0 : 1) - (vol.at(x, y - 1, z) ? 0 : 1),
      (vol.at(x, y, z + 1) ? 0 : 1) - (vol.at(x, y, z - 1) ? 0 : 1),
    ];
    let best = cams[0], bestDot = -Infinity;
    for (const c of cams) {
      const dot = n[0] * c.dir[0] + n[2] * c.dir[2];
      if (dot > bestDot) { bestDot = dot; best = c; }
    }
    const dx = x - half, dz = z - halfZ;
    const u = dx * best.cos - dz * best.sin;
    const px = Math.round(best.cx + u * best.scale);
    const py = Math.round(best.top + y * best.scale);
    const c = best.photo.px(px, py);
    const i = vol.idx(x, y, z) * 3;
    vol.colour[i] = c[0]; vol.colour[i + 1] = c[1]; vol.colour[i + 2] = c[2];
  }
}

/**
 * How the carve went, in words a person can act on.
 *
 * A hull built from bad outlines is not obviously wrong to look at — it is
 * just a slightly odd person — so it is worth saying out loud when the
 * numbers were poor.
 */
export function report(views, vol) {
  const notes = [];
  const areas = views.map((v) => v.sil.area);
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
