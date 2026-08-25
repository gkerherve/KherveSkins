// A carved person, made into a Minecraft man.
//
// The awkward fact this file exists to deal with: **a person is seven and a
// half heads tall and a Minecraft man is four.** Scale a real body straight
// onto the model and the head comes out as a pea on a lamp-post. So the
// mapping is not a scale, it is anatomical — find the neck, the shoulders,
// the hips and the floor in the carved volume, and stretch each stretch of
// body onto the box that stands for it.
//
// That is the same trick as the face sampler one ring out. There, the eye
// line and the mouth line are pinned to whole texel rows before anything is
// averaged. Here the neck and the hips are pinned to the joins between the
// model's boxes. Both are the same idea: a picture squeezed into very few
// pixels keeps its meaning only if the LANDMARKS land where they belong.
//
// The landmarks are found by the shape of the body itself, not by a ratio:
//   the neck    the narrowest slice in the top third
//   the hips    the highest slice that is two separate legs rather than one
//               trunk — a person is a Y and the fork of the Y is the hip
//   the arms    whatever is outside the torso between shoulder and hip

import { parts } from './layout.js';
import { clamp255, shade, mix } from './pixels.js';

/**
 * Where the body's joins are, in cubes.
 *
 * Everything is measured from the top of the head down, because that is the
 * one edge every silhouette agrees about.
 */
export function landmarks(vol) {
  const { nx, ny, nz } = vol;
  const widthAt = new Int32Array(ny);
  const countAt = new Int32Array(ny);
  const leftAt = new Int32Array(ny).fill(nx);
  const rightAt = new Int32Array(ny).fill(-1);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let any = 0;
      for (let z = 0; z < nz; z++) if (vol.at(x, y, z)) { any = 1; countAt[y]++; }
      if (!any) continue;
      if (x < leftAt[y]) leftAt[y] = x;
      if (x > rightAt[y]) rightAt[y] = x;
    }
    widthAt[y] = rightAt[y] < 0 ? 0 : rightAt[y] - leftAt[y] + 1;
  }

  let top = 0, floor = ny - 1;
  while (top < ny && !widthAt[top]) top++;
  while (floor > top && !widthAt[floor]) floor--;
  const H = Math.max(4, floor - top + 1);

  // the neck: the narrowest slice between the crown and the shoulders
  let neck = top + Math.round(H * 0.13), narrow = Infinity;
  for (let y = top + Math.round(H * 0.06); y < top + Math.round(H * 0.30); y++) {
    if (widthAt[y] && widthAt[y] < narrow) { narrow = widthAt[y]; neck = y; }
  }

  // the shoulders: the widest slice in the chest
  let shoulder = neck + 1, widest = 0;
  for (let y = neck; y < top + Math.round(H * 0.40); y++) {
    if (widthAt[y] > widest) { widest = widthAt[y]; shoulder = y; }
  }

  // The torso's own width, taken from the run that CONTAINS THE MIDDLE at
  // chest height. Measured off the whole silhouette instead, a pair of arms
  // held clear of the ribs — which the guidance asks for — becomes part of
  // the ribcage, and the Minecraft man comes out three feet wide.
  let tl = nx, tr = -1;
  for (let y = top + Math.round(H * 0.32); y < top + Math.round(H * 0.50); y++) {
    const [l, r] = trunkAt(vol, y);
    if (r < 0) continue;
    if (l < tl) tl = l;
    if (r > tr) tr = r;
  }
  if (tr < 0) { tl = Math.round(nx * 0.35); tr = Math.round(nx * 0.65); }

  // ARMS DOWN, which is what people actually do.
  //
  // An arm touching a ribcage cannot be told from a ribcage by any outline,
  // so the hull fuses them and the trunk comes out as wide as the whole
  // person. Left alone, the body box then stretches over the arms as well
  // and the Minecraft man is a barrel with no arms on it.
  //
  // The shoulders are still measurable even when the arms are not, so the
  // split is put in by proportion: on the model a figure is sixteen wide with
  // an eight-wide chest and a four-wide arm on each side, and a real person
  // with their arms down is close enough to the same halves-and-quarters.
  // Guessed arms in the right place beat a barrel, and the app says it
  // guessed.
  const chestY = Math.min(floor - 1, top + Math.round(H * 0.34));
  const fullL = leftAt[chestY], fullR = rightAt[chestY];
  const fullW = fullR < 0 ? 0 : fullR - fullL + 1;
  let fusedArms = false;
  if (fullW > 3 && (tr - tl + 1) >= fullW * 0.88) {
    fusedArms = true;
    const cut = Math.max(1, Math.round(fullW * 0.22));
    tl = fullL + cut;
    tr = fullR - cut;
  }

  // The hips: the highest slice where the body forks into two legs.
  //
  // Counted only within the trunk's own columns, and that restriction is the
  // whole of it. A person with their arms clear of their sides is three runs
  // wide from shoulder to wrist — arm, chest, arm — so "how many runs across
  // the whole slice" answers three long before it answers two, and puts the
  // hips up in the ribs.
  let hip = top + Math.round(H * 0.55);
  for (let y = floor - 1; y > top + Math.round(H * 0.35); y--) {
    if (trunkRuns(vol, y, tl, tr) < 2) { hip = y + 1; break; }
  }

  return {
    top, floor, neck, shoulder, hip, height: H, fusedArms,
    widthAt, leftAt, rightAt, countAt,
    torso: [tl, tr],
    armL: [tr + 1, Math.max(tr + 1, ...rightAt.slice(shoulder, hip))],
    armR: [Math.min(tl, ...leftAt.slice(shoulder, hip).filter((v) => v < nx)), tl - 1],
  };
}

/** How many separate runs of body cross one slice, within the trunk's columns. */
function trunkRuns(vol, y, tl, tr) {
  let n = 0, was = 0;
  const a = Math.max(0, tl - 1), b = Math.min(vol.nx - 1, tr + 1);
  for (let x = a; x <= b; x++) {
    let any = 0;
    for (let z = 0; z < vol.nz; z++) if (vol.at(x, y, z)) { any = 1; break; }
    if (any && !was) n++;
    was = any;
  }
  return n;
}

/** The widest single run through the middle of a slice: the trunk, not an arm. */
function trunkAt(vol, y) {
  const mid = Math.round(vol.nx / 2);
  let l = mid, r = mid;
  const solid = (x) => {
    for (let z = 0; z < vol.nz; z++) if (vol.at(x, y, z)) return true;
    return false;
  };
  if (!solid(mid)) return [-1, -1];
  while (l > 0 && solid(l - 1)) l--;
  while (r < vol.nx - 1 && solid(r + 1)) r++;
  return [l, r];
}

/**
 * Which way to march, in CUBES, for each face of a box.
 *
 * The volume's axes and the model's are the same two directions read in
 * opposite orders, and it is worth spelling out once rather than deriving it
 * at four call sites. His right hand is +X on the model and the LOW end of
 * the volume's x, because a camera facing him puts his right hand on the left
 * of the picture. His front is −Z on the model and the low end of the
 * volume's z. And the volume is stored the way a photograph is, crown at row
 * nought, so its y runs DOWNWARD while the model's runs up.
 */
const INWARD = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

/** The cubes one part of the body actually occupies. */
function extent(vol, y0, y1, xlo, xhi) {
  let x0 = vol.nx, x1 = -1, z0 = vol.nz, z1 = -1;
  const a = Math.max(0, Math.min(xlo, xhi)), b = Math.min(vol.nx - 1, Math.max(xlo, xhi));
  for (let y = Math.max(0, y0); y <= Math.min(vol.ny - 1, y1); y++) {
    for (let x = a; x <= b; x++) {
      for (let z = 0; z < vol.nz; z++) {
        if (!vol.at(x, y, z)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, x1, z0, z1 };
}

/**
 * Paint the skin from the volume.
 *
 * Every part gets its OWN box of cubes, and that is the whole of what makes
 * this work. One scale for the whole figure cannot be right: the model's head
 * is as wide as its chest and a real head is half as wide, so a head box
 * sized off the torso reaches out past the ears into thin air and comes back
 * with nothing. Measure the head's own cubes, stretch the head box onto them,
 * and the same for the chest, each arm and each leg.
 *
 * Then for every texel: stand on that face of that box, march inward through
 * the cubes, take the colour of the first one that is there. A texel that
 * finds nothing all the way through — the corner of a head box, outside the
 * skull — takes the nearest colour that WAS found, so the man has no holes.
 */
export function fitToSkin(skin, vol, opts = {}) {
  const size = skin.size;
  const L = landmarks(vol);
  const [tl, tr] = L.torso;
  const mid = Math.round((tl + tr) / 2);
  const armTop = Math.min(L.shoulder + 1, L.hip - 1);

  // The legs are split down the middle of the LEGS, not of the torso. With
  // the arms fused the torso has been narrowed to a guess, and cutting the
  // legs at the middle of a guess puts both of them in one thigh — which
  // renders as a man on a single post.
  const legZone = extent(vol, L.hip, L.floor, 0, vol.nx - 1);
  const legMid = legZone ? Math.round((legZone.x0 + legZone.x1) / 2) : mid;
  const beside = (x0, x1) => ({ x0, x1, z0: 0, z1: vol.nz - 1 });
  const boxes = {
    head: extent(vol, L.top, L.neck, 0, vol.nx - 1),
    body: extent(vol, L.neck, L.hip, tl, tr),
    armR: extent(vol, armTop, L.hip, 0, tl - 1),
    armL: extent(vol, armTop, L.hip, tr + 1, vol.nx - 1),
    legR: legZone ? extent(vol, L.hip, L.floor, legZone.x0, legMid) : null,
    legL: legZone ? extent(vol, L.hip, L.floor, legMid + 1, legZone.x1) : null,
  };
  // an arm the carve could not separate from the ribs: stand it where one
  // would be rather than leaving a hole
  const body = boxes.body || { x0: tl, x1: tr, z0: 0, z1: vol.nz - 1 };
  const armW = Math.max(2, Math.round((tr - tl + 1) * 0.28));
  if (!boxes.armR) boxes.armR = { ...beside(Math.max(0, tl - armW), tl - 1), z0: body.z0, z1: body.z1 };
  if (!boxes.armL) boxes.armL = { ...beside(tr + 1, Math.min(vol.nx - 1, tr + armW)), z0: body.z0, z1: body.z1 };
  if (!boxes.head) boxes.head = { ...body };
  if (!boxes.legR) boxes.legR = { x0: tl, x1: mid, z0: body.z0, z1: body.z1 };
  if (!boxes.legL) boxes.legL = { x0: mid + 1, x1: tr, z0: body.z0, z1: body.z1 };
  void beside;

  // the model's height, stretch by stretch, onto the carved body's own joins
  const anchors = [[32, L.top], [24, L.neck], [12, L.hip], [0, L.floor + 1]];
  const yOf = (modelY) => {
    for (let i = 1; i < anchors.length; i++) {
      const [aY, aV] = anchors[i - 1], [bY, bV] = anchors[i];
      if (modelY >= bY || i === anchors.length - 1) {
        const t = aY === bY ? 0 : (modelY - aY) / (bY - aY);
        return aV + (bV - aV) * t;
      }
    }
    return L.floor;
  };

  const fallback = opts.skinTone || [214, 170, 138];

  for (const p of parts(opts.slim, size)) {
    const [bw, bh, bd] = p.size;
    const box = boxes[p.key];
    const spanX = Math.max(1, box.x1 - box.x0);
    const spanZ = Math.max(1, box.z1 - box.z0);
    const steps = Math.round(Math.max(spanX, spanZ, vol.ny * 0.4)) + 2;

    for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      const rect = p.rects[face];
      const dir = INWARD[face];
      const got = new Map();

      skin.mapRect(rect, (u, v, cur, w, h) => {
        // where this texel is on the box, as a fraction of each edge
        const a = (u + 0.5) / w, b = (v + 0.5) / h;
        let ax, ay, az;                     // 0..1 along the model's x, y, z
        if (face === 'front') { ax = 1 - a; ay = 1 - b; az = 0; }
        else if (face === 'back') { ax = a; ay = 1 - b; az = 1; }
        else if (face === 'right') { ax = 1; ay = 1 - b; az = a; }
        else if (face === 'left') { ax = 0; ay = 1 - b; az = 1 - a; }
        else if (face === 'top') { ax = 1 - a; ay = 1; az = 1 - b; }
        else { ax = 1 - a; ay = 0; az = b; }

        const modelY = (p.at[1] - bh / 2) + ay * bh;
        // his right is +X on the model and the LOW end of the volume
        const vx = box.x1 - ax * spanX;
        const vz = box.z0 + az * spanZ;
        const vy = yOf(modelY);

        let x = vx, y = vy, z = vz;
        for (let i = 0; i < steps; i++) {
          const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
          if (vol.at(xi, yi, zi)) { got.set(v * w + u, vol.colourAt(xi, yi, zi)); break; }
          x += dir[0]; y += dir[1]; z += dir[2];
        }
        return null;
      });

      const list = [...got.entries()];
      skin.mapRect(rect, (u, v, cur, w) => {
        const hit = got.get(v * w + u);
        const k = face === 'front' ? 1 : face === 'back' ? 0.92 : face === 'top' ? 1.06
          : face === 'bottom' ? 0.8 : 0.96;
        if (hit) return shade(hit, k);
        if (!list.length) return fallback;
        // nothing there: the nearest texel that DID find something, so a
        // shoulder is a shoulder rather than a hole in the man
        let best = list[0][1], bd2 = Infinity;
        for (const [key, c] of list) {
          const du = (key % w) - u, dv = ((key / w) | 0) - v;
          const d = du * du + dv * dv;
          if (d < bd2) { bd2 = d; best = c; }
        }
        return shade(mix(best, fallback, 0.2), k * 0.96);
      });
    }
    for (const face of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
      skin.fillRect(p.overRects[face], [0, 0, 0, 0]);
    }
  }
  void clamp255;
  return L;
}
