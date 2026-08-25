// The photograph, and how a face is found in one.
//
// Everything here is about turning "a picture of a person" into numbers the
// generator can use: where the head is, where the eyes and mouth sit inside
// it, what colour the hair and the shirt are, and — the one that actually
// matters — what a rectangle of that photograph averages out to when it is
// squeezed into a texel eight of which have to make a whole face.

const MAX_SIDE = 900;

/** A photograph, at a size worth working at, with its pixels to hand. */
export class Photo {
  constructor(image) {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    this.w = Math.max(1, Math.round(image.width * scale));
    this.h = Math.max(1, Math.round(image.height * scale));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const cx = this.canvas.getContext('2d', { willReadFrequently: true });
    cx.drawImage(image, 0, 0, this.w, this.h);
    this.data = cx.getImageData(0, 0, this.w, this.h).data;
    this.source = image;
  }

  /** Nearest texel, clamped at the edges. */
  px(x, y) {
    const ix = x < 0 ? 0 : x >= this.w ? this.w - 1 : x | 0;
    const iy = y < 0 ? 0 : y >= this.h ? this.h - 1 : y | 0;
    const i = (iy * this.w + ix) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  /** Smooth read, for sampling that lands between pixels. */
  at(x, y) {
    const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
    const a = this.px(x0, y0), b = this.px(x0 + 1, y0);
    const c = this.px(x0, y0 + 1), d = this.px(x0 + 1, y0 + 1);
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const top = a[k] + (b[k] - a[k]) * fx;
      const bot = c[k] + (d[k] - c[k]) * fx;
      out[k] = top + (bot - top) * fy;
    }
    return out;
  }

  /** Whether a point is inside the picture at all. */
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Mean colour of a rectangle, or null if it is off the picture. */
  area(x, y, w, h) {
    if (w <= 0 || h <= 0) return null;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return null;
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const k = (j * this.w + i) * 4;
        r += this.data[k]; g += this.data[k + 1]; b += this.data[k + 2]; n++;
      }
    }
    return n ? [r / n, g / n, b / n] : null;
  }

  /**
   * The colour a rectangle is MOSTLY, which is not its average.
   *
   * A striped shirt averages to mud and a face with a shadow down one side
   * averages darker than any part of it. Counting coarse buckets and taking
   * the fullest one answers "what colour is that" the way a person would.
   */
  dominant(x, y, w, h, reject = null) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return null;
    const bins = new Map();
    const step = Math.max(1, Math.round(Math.min(x1 - x0, y1 - y0) / 40));
    for (let j = y0; j < y1; j += step) {
      for (let i = x0; i < x1; i += step) {
        const k = (j * this.w + i) * 4;
        const c = [this.data[k], this.data[k + 1], this.data[k + 2]];
        if (reject && near(c, reject, 44)) continue;
        const key = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
        let bin = bins.get(key);
        if (!bin) bins.set(key, (bin = [0, 0, 0, 0]));
        bin[0] += c[0]; bin[1] += c[1]; bin[2] += c[2]; bin[3]++;
      }
    }
    let best = null;
    for (const bin of bins.values()) if (!best || bin[3] > best[3]) best = bin;
    if (!best) return null;
    return [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
  }
}

export const near = (a, b, tol) => (
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < tol * 3
);

/**
 * Skin, as a rule about colour rather than a model of a person.
 *
 * The chroma test is the standard one and it has two holes in it, both big
 * enough to lose a face through, and both found by looking at what came out
 * rather than by reading about it:
 *
 *   **dark brown hair** sits in exactly the same corner of the colour space
 *   as skin. Chroma cannot tell them apart, because in chroma they are not
 *   different — only in brightness. Hence the floor under the value, and it
 *   is what stops a fringe being read as a forehead and the whole head being
 *   swallowed by the box.
 *
 *   **a cream shirt** clears the standard test by a whisker, and a portrait
 *   is mostly shirt. Merged into the face, it drags the box down to the
 *   waist and there is nothing left of the head. What separates them is not
 *   brightness — a pale complexion is as bright — but the SPREAD between red
 *   and green: skin has forty or fifty points of it at any complexion, and
 *   undyed cloth has six.
 */
export function skinish(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 56 && y < 250
    && Math.max(r, g, b) > 78
    && cb > 76 && cb < 130
    && cr > 134 && cr < 178
    && r - g > 12 && r > b * 0.9;
}

/**
 * The frame the whole build hangs off.
 *
 * `box` is the HEAD — the top of the hair down to the bottom of the chin, and
 * as wide as the head is at the ears. `eye` and `mouth` are absolute rows in
 * the photograph, and they are what make an eight-pixel face possible: the
 * sampler warps the picture so those two land dead on a texel row instead of
 * being smeared across the boundary between two.
 */
export function frame(box, eye, mouth, tilt = 0, eyeL = null, eyeR = null) {
  return { x: box.x, y: box.y, w: box.w, h: box.h, eye, mouth, tilt, eyeL, eyeR };
}

/**
 * Where the two eyes are ACROSS the face.
 *
 * The eye line stops a face being smeared up and down. This stops it being
 * smeared side to side, and it is the same argument: an eye is about as wide
 * as a texel, so an eye landing on a texel BOUNDARY is two half-eyes and
 * reads as neither. Pinned to a column each, they read as eyes.
 *
 * Found as the darkest column in a band round the eye line, once per half of
 * the face, with the outer sixth left out because that is hair.
 */
export function eyeColumns(photo, box, eye) {
  const y0 = eye - box.h * 0.035, y1 = eye + box.h * 0.035;
  const inset = box.w * 0.16;
  const a = box.x + inset, b = box.x + box.w - inset;
  const mid = box.x + box.w / 2;
  const steps = 40;
  const darkest = (from, to) => {
    let best = null, bl = Infinity;
    for (let i = 0; i < steps; i++) {
      const x = from + (i + 0.5) * (to - from) / steps;
      const c = photo.area(x - box.w * 0.02, y0, box.w * 0.04, y1 - y0);
      if (!c) continue;
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      if (l < bl) { bl = l; best = x; }
    }
    return best;
  };
  const left = darkest(a, mid - box.w * 0.04);
  const right = darkest(mid + box.w * 0.04, b);
  if (left === null || right === null || right - left < box.w * 0.12) return [null, null];
  return [left, right];
}

/**
 * Find a head, without asking anybody.
 *
 * Uses the browser's own face detector where there is one — Chrome on
 * Android often has it — and falls back to finding the largest run of
 * skin-coloured pixels, which works on anything and is wrong often enough
 * that the box it returns is a handle, not an answer.
 */
export async function autoFace(photo) {
  const built = await detectorFace(photo);
  if (built) return built;
  return heuristicFace(photo);
}

async function detectorFace(photo) {
  const FD = globalThis.FaceDetector;
  if (!FD) return null;
  try {
    const det = new FD({ fastMode: false, maxDetectedFaces: 4 });
    const found = await det.detect(photo.canvas);
    if (!found || !found.length) return null;
    found.sort((a, b) => b.boundingBox.width * b.boundingBox.height
      - a.boundingBox.width * a.boundingBox.height);
    const bb = found[0].boundingBox;
    // the detector's box is brow-to-chin; a head is taller than that, and the
    // extra is all hair
    const h = bb.height * 1.62;
    const w = Math.max(bb.width * 1.18, h * 0.78);
    const box = {
      x: bb.x + bb.width / 2 - w / 2,
      y: bb.y + bb.height * 0.98 - h,
      w,
      h,
    };
    const marks = found[0].landmarks || [];
    const eyes = marks.filter((m) => m.type === 'eye');
    const mouths = marks.filter((m) => m.type === 'mouth');
    const eyeY = eyes.length
      ? eyes.reduce((s, m) => s + m.locations[0].y, 0) / eyes.length
      : box.y + box.h * 0.56;
    const mouthY = mouths.length
      ? mouths[0].locations[0].y
      : box.y + box.h * 0.80;
    let tilt = 0;
    let eyeL = null, eyeR = null;
    if (eyes.length === 2) {
      const [a, b] = eyes.map((m) => m.locations[0]).sort((p, q) => p.x - q.x);
      tilt = Math.atan2(b.y - a.y, Math.max(1, b.x - a.x));
      eyeL = a.x; eyeR = b.x;
    }
    return frame(box, eyeY, mouthY, tilt, eyeL, eyeR);
  } catch {
    return null;
  }
}

/**
 * The skin mask, and the biggest run of it.
 *
 * A coarse grid on purpose: fine enough that an eye is several cells across,
 * coarse enough that the whole search is a few thousand cells and runs while
 * a finger is still on the Choose button.
 */
function maskGrid(photo) {
  const gw = 120;
  const gh = Math.max(1, Math.round(gw * photo.h / photo.w));
  const sx = photo.w / gw, sy = photo.h / gh;
  const mask = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = photo.at((i + 0.5) * sx, (j + 0.5) * sy);
      mask[j * gw + i] = skinish(c[0], c[1], c[2]) ? 1 : 0;
    }
  }
  const seen = new Int32Array(gw * gh).fill(-1);
  const blobs = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s] >= 0) continue;
    const id = blobs.length;
    let n = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0, sxs = 0, sys = 0;
    stack.length = 0;
    stack.push(s);
    seen[s] = id;
    while (stack.length) {
      const p = stack.pop();
      const px = p % gw, py = (p / gw) | 0;
      n++; sxs += px; sys += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      const ns = [p - 1, p + 1, p - gw, p + gw];
      for (let k = 0; k < 4; k++) {
        const q = ns[k];
        if (q < 0 || q >= mask.length || !mask[q] || seen[q] >= 0) continue;
        if (k < 2 && Math.abs((q % gw) - px) !== 1) continue;
        seen[q] = id;
        stack.push(q);
      }
    }
    blobs.push({ id, n, x0, y0, x1, y1, cy: sys / n, cx: sxs / n });
  }
  // prefer a big blob that is high in the picture and not absurdly wide
  let blob = null, bestScore = -1;
  for (const b of blobs) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    if (w < 5 || h < 5) continue;
    const aspect = h / w;
    const score = b.n * (aspect > 0.7 && aspect < 2.6 ? 1 : 0.35)
      * (1.3 - b.cy / gh * 0.6);
    if (score > bestScore) { bestScore = score; blob = b; }
  }
  return { gw, gh, sx, sy, mask, seen, blob };
}

/**
 * The eyes, found as HOLES.
 *
 * This is the one that made the finder work, and it came from looking at
 * what the skin mask actually contained rather than from any theory about
 * faces. **The whites of eyes are never skin-coloured** — they are neutral,
 * and the test wants forty points of red over green — and nor is an iris. So
 * on any face, of any complexion, in any light, the two eyes are two small
 * holes punched in an otherwise solid run of skin.
 *
 * Holes are cheap to find (flood the not-skin cells inward from the edge of
 * the blob's box; what the flood cannot reach is enclosed) and a pair of
 * them at the same height, the right distance apart, is a face looking at
 * the camera.
 *
 * And once the eyes are known, the rest of the head follows from proportions
 * that hold across people: the distance between the pupils is about a third
 * of the width of a head and a quarter of its height, and the eye line sits
 * halfway down it. Measured against a drawn portrait whose true measurements
 * were known, this lands within three pixels on every number — where reading
 * the head off the edges of the skin blob was out by a hundred and fifty.
 */
function eyeHoles(g) {
  const { gw, gh, seen, blob } = g;
  if (!blob) return null;
  const { x0, y0, x1, y1, id } = blob;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const idx = (i, j) => j * gw + i;
  const gap = (i, j) => seen[idx(i, j)] !== id;

  // what the flood CAN reach from the rim of the box is outside the head
  const out = new Uint8Array(gw * gh);
  const stack = [];
  const seed = (i, j) => {
    if (i < x0 || i > x1 || j < y0 || j > y1) return;
    const k = idx(i, j);
    if (out[k] || !gap(i, j)) return;
    out[k] = 1;
    stack.push(k);
  };
  for (let j = y0; j <= y1; j++) { seed(x0, j); seed(x1, j); }
  for (let i = x0; i <= x1; i++) { seed(i, y0); seed(i, y1); }
  while (stack.length) {
    const k = stack.pop();
    const i = k % gw, j = (k / gw) | 0;
    seed(i + 1, j); seed(i - 1, j); seed(i, j + 1); seed(i, j - 1);
  }

  // everything else inside the box that is not skin is a hole in the face
  const done = new Uint8Array(gw * gh);
  const holes = [];
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const k = idx(i, j);
      if (!gap(i, j) || out[k] || done[k]) continue;
      done[k] = 1;
      stack.length = 0;
      stack.push(k);
      let n = 0, sxs = 0, sys = 0;
      while (stack.length) {
        const q = stack.pop();
        const qi = q % gw, qj = (q / gw) | 0;
        n++; sxs += qi; sys += qj;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = qi + di, b = qj + dj;
          if (a < x0 || a > x1 || b < y0 || b > y1) continue;
          const r = idx(a, b);
          if (!gap(a, b) || out[r] || done[r]) continue;
          done[r] = 1;
          stack.push(r);
        }
      }
      holes.push({ n, cx: sxs / n, cy: sys / n });
    }
  }

  // a pair at the same height, the right distance apart, in the upper part
  const up = holes.filter((h) => h.n >= 2 && h.cy < y0 + bh * 0.72);
  let pair = null, pairScore = -1;
  for (let i = 0; i < up.length; i++) {
    for (let j = i + 1; j < up.length; j++) {
      let a = up[i], b = up[j];
      if (a.cx > b.cx) [a, b] = [b, a];
      const dx = b.cx - a.cx;
      const dy = Math.abs(b.cy - a.cy);
      if (dy > bh * 0.10) continue;
      if (dx < bw * 0.18 || dx > bw * 0.80) continue;
      // two of a kind: eyes are the same size as each other
      const score = a.n + b.n - Math.abs(a.n - b.n);
      if (score > pairScore) { pairScore = score; pair = [a, b]; }
    }
  }
  return pair;
}

/** No detector: find the biggest patch of skin and reason outward from it. */
export function heuristicFace(photo) {
  const g = maskGrid(photo);
  const pair = eyeHoles(g);
  if (pair) return fromEyes(photo, g, pair);
  return fromBlob(photo, g);
}

/** The head, worked out from where the two eyes are. */
function fromEyes(photo, g, [a, b]) {
  const { sx, sy } = g;
  const eyeL = (a.cx + 0.5) * sx;
  const eyeR = (b.cx + 0.5) * sx;
  const eye = ((a.cy + b.cy) / 2 + 0.5) * sy;
  const ipd = Math.max(4, eyeR - eyeL);
  const w = ipd * 2.90;
  const h = ipd * 4.25;
  const box = { x: (eyeL + eyeR) / 2 - w / 2, y: eye - h * 0.515, w, h };
  // the proportion puts the mouth about here; the picture says exactly where
  const guessed = eye + ipd * 1.10;
  const found = darkestRow(photo, { ...box, y: guessed - ipd * 0.45, h: ipd * 0.9 },
    0, 1, 0.34, 0.66);
  const mouth = found === null ? guessed : found;
  const tilt = Math.atan2((b.cy - a.cy) * sy, Math.max(1, eyeR - eyeL));
  return frame(box, eye, Math.max(eye + h * 0.08, mouth), tilt, eyeL, eyeR);
}

/**
 * The old way, kept for the faces the new way cannot see.
 *
 * Closed eyes, sunglasses, a head turned away, a photograph too small for an
 * eye to be more than one cell: no pair of holes, no proportions. Reading
 * the head off the edges of the skin is much worse, but it is never nothing,
 * and there is a box on screen to drag.
 */
function fromBlob(photo, g) {
  const { gw, gh, sx, sy, seen, blob } = g;
  let skinBox;
  if (blob) {
    // brown hair is brown skin as far as any colour rule is concerned, so
    // ask this head where its own light and dark halves divide
    const split = splitByBrightness(photo, seen, blob.id, gw, gh, sx, sy);
    if (split) {
      for (let i = 0; i < seen.length; i++) {
        if (seen[i] === blob.id && split.lum[i] < split.cut) seen[i] = -1;
      }
    }
    skinBox = faceOfBlob(seen, blob.id, gw, gh, sx, sy);
  } else {
    // nothing found: a square in the upper middle, which is where a portrait
    // puts a head whether the mask agreed or not
    const side = Math.min(photo.w, photo.h) * 0.46;
    skinBox = { x: photo.w / 2 - side / 2, y: photo.h * 0.44 - side / 2, w: side, h: side * 0.9 };
  }
  // bare skin runs from the hairline to the chin: about seven tenths of a
  // head, and the missing three tenths are hair
  const h = skinBox.h / 0.70;
  const w = Math.max(skinBox.w * 1.16, h * 0.74);
  const guess = {
    x: skinBox.x + skinBox.w / 2 - w / 2,
    y: skinBox.y + skinBox.h - h * 0.97,
    w,
    h,
  };
  // a ratio is a guess about a haircut; the picture knows
  const box = growToHair(photo, guess, skinBox);
  // Brows are darker than eyes and sit barely a twentieth of a head above
  // them, so a search that starts too high finds a brow every time and puts
  // the whole face one row out.
  const eye = darkestRow(photo, box, 0.46, 0.66) ?? box.y + box.h * 0.54;
  const mouth = darkestRow(photo, box, 0.70, 0.92) ?? box.y + box.h * 0.78;
  const tilt = eyeTilt(photo, box, eye);
  const [eyeL, eyeR] = eyeColumns(photo, box, eye);
  return frame(box, eye, Math.max(eye + box.h * 0.08, mouth), tilt, eyeL, eyeR);
}

/**
 * Split hair off skin when the two are the same COLOUR.
 *
 * There is no colour rule that separates mid-brown hair from mid-brown skin,
 * because there is no difference: put a swatch of each side by side and they
 * are the same paint. Every fixed threshold that excludes one excludes
 * somebody's complexion — a floor high enough to drop brown hair drops a
 * deep complexion with it, and now the tool works on some people and not on
 * others, which is the worst failure available here.
 *
 * So the threshold is not fixed. Otsu's method asks the RUN OF PIXELS THIS
 * PERSON is made of where its own natural split is, and only splits when
 * there genuinely are two groups: hair and skin on one head are far apart in
 * brightness whoever the head belongs to, and a bald head or one whose hair
 * matches the skin has one group and is left alone.
 */
function splitByBrightness(photo, seen, id, gw, gh, sx, sy) {
  const hist = new Float64Array(64);
  let total = 0;
  const lumaAt = (i) => {
    const c = photo.at(((i % gw) + 0.5) * sx, (((i / gw) | 0) + 0.5) * sy);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const lum = new Float32Array(seen.length);
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] !== id) continue;
    const l = lumaAt(i);
    lum[i] = l;
    hist[Math.min(63, Math.max(0, Math.floor(l / 4)))]++;
    total++;
  }
  if (total < 30) return null;
  let sum = 0;
  for (let k = 0; k < 64; k++) sum += k * hist[k];
  let sumB = 0, wB = 0, best = -1, cut = 0, mLo = 0, mHi = 0;
  for (let k = 0; k < 64; k++) {
    wB += hist[k];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += k * hist[k];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; cut = k; mLo = mB; mHi = mF; }
  }
  // one group, not two: leave it be
  if ((mHi - mLo) * 4 < 42) return null;
  return { cut: (cut + 1) * 4, lum };
}

/**
 * The FACE part of a run of skin, which is not the same as its bounding box.
 *
 * A portrait's skin is one connected shape: face, then neck, then whatever
 * the shirt leaves out. Take the box round all of it and the "head" reaches
 * the collarbone. But a neck is narrow and a face is not — so the widest row
 * is a cheek, and the chin is the first row below it where the shape pinches
 * in. That one measurement is the difference between a head box and a
 * head-and-shoulders box.
 */
function faceOfBlob(seen, id, gw, gh, sx, sy) {
  const width = new Int32Array(gh);
  let top = gh, bottom = 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) if (seen[j * gw + i] === id) width[j]++;
    if (width[j]) { if (j < top) top = j; bottom = j; }
  }
  let jMax = top, maxW = 0;
  for (let j = top; j <= bottom; j++) if (width[j] > maxW) { maxW = width[j]; jMax = j; }
  let chin = bottom;
  for (let j = jMax + 1; j <= bottom; j++) {
    if (width[j] < maxW * 0.62) { chin = j; break; }
  }
  // the sides, ignoring the odd stray column an ear or a strap adds
  const xs = [];
  for (let j = top; j <= chin; j++) {
    for (let i = 0; i < gw; i++) if (seen[j * gw + i] === id) xs.push(i);
  }
  xs.sort((a, b) => a - b);
  const lo = xs.length ? xs[Math.floor(xs.length * 0.04)] : 0;
  const hi = xs.length ? xs[Math.floor(xs.length * 0.96)] : gw - 1;
  return {
    x: lo * sx,
    y: top * sy,
    w: Math.max(8, (hi - lo + 1) * sx),
    h: Math.max(8, (chin - top + 1) * sy),
  };
}

/**
 * Push the head box out until it meets the wall.
 *
 * The ratio above says a head is a certain amount taller and wider than the
 * bare skin in it, which is a statement about a haircut and is therefore
 * wrong for most people. A crop stops being a guess the moment you ask the
 * picture: step outward a strip at a time, and stop at the first strip that
 * is the same colour as what is behind the person. That finds a bob, a beard
 * and a bald head without knowing that any of them exist.
 *
 * Capped, and thrown away if it runs: a busy background never looks like a
 * wall, and a box that grew to the frame edge is worse than the ratio it
 * replaced.
 */
function growToHair(photo, guess, skinBox) {
  const s = Math.max(4, Math.round(Math.min(photo.w, photo.h) * 0.05));
  const corners = [[0, 0], [photo.w - s, 0], [0, photo.h - s], [photo.w - s, photo.h - s]]
    .map(([x, y]) => photo.area(x, y, s, s)).filter(Boolean);
  if (corners.length < 3) return guess;
  const bg = [0, 1, 2].map((k) => {
    const v = corners.map((c) => c[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  // a wall is not just one colour, it is one colour EVENLY: a strip whose own
  // spread is large is a scene, not a background
  const flat = (x, y, w, h) => {
    const a = photo.area(x, y, w, h / 2);
    const b = photo.area(x, y + h / 2, w, h / 2);
    return a && b && near(a, b, 18) && near(a, bg, 34);
  };
  const step = Math.max(2, guess.w * 0.03);
  // The last step is always half wrong: a photographed edge is a blur a few
  // pixels wide, so the strip that first reads as wall was already partly
  // wall. Stepping back one keeps the box on the hair rather than around it,
  // and a box a hair's breadth too small is worth much more than one too
  // large — background inside the box costs a whole texel of face.
  // It either found the wall or it did not, and the difference matters. A
  // busy background — a doorway, a worktop, a room — never reads as one flat
  // colour, so the search runs to its limit and the "edge of the hair" it
  // reports is just where it gave up. That is worse than the ratio it was
  // meant to improve on, so a side that runs out falls back to the ratio.
  const grow = (from, dir, limit, strip) => {
    let at = from;
    for (let i = 0; i < 60; i++) {
      const next = at + dir * step;
      if (Math.abs(next - from) > limit) return { at: from, found: false };
      if (next < -step || next > Math.max(photo.w, photo.h) + step) {
        return { at: from, found: false };
      }
      if (flat(...strip(next))) return { at: at - dir * step * (i ? 1 : 0), found: true };
      at = next;
    }
    return { at: from, found: false };
  };

  const sideLimit = guess.w * 0.45;
  const topLimit = guess.h * 0.55;
  const top = grow(skinBox.y, -1, topLimit,
    (y) => [skinBox.x + skinBox.w * 0.22, y, skinBox.w * 0.56, step]);
  const left = grow(skinBox.x, -1, sideLimit,
    (x) => [x, skinBox.y, step, skinBox.h * 0.7]);
  const right = grow(skinBox.x + skinBox.w, +1, sideLimit,
    (x) => [x, skinBox.y, step, skinBox.h * 0.7]);

  const gx0 = guess.x, gx1 = guess.x + guess.w;
  const x0 = left.found ? left.at : gx0;
  const x1 = right.found ? right.at : gx1;
  const y0 = top.found ? top.at : guess.y;
  const grown = {
    x: x0,
    y: y0,
    w: x1 - x0,
    h: skinBox.y + skinBox.h - y0 + skinBox.h * 0.04,
  };
  // it only counts if it stopped somewhere sensible
  const sane = grown.w > guess.w * 0.78 && grown.w < guess.w * 1.38
    && grown.h > guess.h * 0.78 && grown.h < guess.h * 1.38;
  return sane ? grown : guess;
}

/** The darkest row in a band of the head box — brows, eyes, or a mouth. */
function darkestRow(photo, box, lo, hi, x0 = 0.22, x1 = 0.78) {
  const yA = box.y + box.h * lo, yB = box.y + box.h * hi;
  const xA = box.x + box.w * x0, xB = box.x + box.w * x1;
  const steps = Math.max(6, Math.round(yB - yA));
  let bestY = null, best = Infinity;
  for (let s = 0; s < steps; s++) {
    const y = yA + (s + 0.5) * (yB - yA) / steps;
    let sum = 0, n = 0;
    for (let x = xA; x < xB; x += Math.max(1, (xB - xA) / 24)) {
      const c = photo.at(x, y);
      sum += 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      n++;
    }
    const mean = n ? sum / n : 255;
    if (mean < best) { best = mean; bestY = y; }
  }
  return bestY;
}

/** How far the head is leaning, from where the eye line sits on each side. */
function eyeTilt(photo, box, eye) {
  const band = { ...box, y: eye - box.h * 0.10, h: box.h * 0.20 };
  const left = darkestRow(photo, band, 0, 1, 0.20, 0.46);
  const right = darkestRow(photo, band, 0, 1, 0.54, 0.80);
  if (left === null || right === null) return 0;
  const dx = box.w * 0.34;
  const t = Math.atan2(right - left, dx);
  return Math.abs(t) > 0.42 ? 0 : t;
}

/**
 * Squeeze a region of the photograph down to a grid of texels.
 *
 * Two things make this worth more than drawImage into a tiny canvas. It
 * WARPS: the eye line and the mouth line are pinned to whole texel rows, so
 * a face keeps its features instead of dissolving into a gradient. And it
 * area-averages properly, sixteen reads a texel, so a bright earring does
 * not vanish because the one pixel it landed on was not sampled.
 *
 * @param {Photo} photo
 * @param {object} f the frame: box, eye, mouth, tilt
 * @param {number} cols texels across
 * @param {number} rows texels down
 * @param {object} o  anchors and zoom
 */
export function sampleFace(photo, f, cols, rows, o = {}) {
  const eyeRow = o.eyeRow === undefined ? 4.5 : o.eyeRow;
  const mouthRow = o.mouthRow === undefined ? 6.5 : o.mouthRow;
  const zoomX = o.zoomX === undefined ? 1 : o.zoomX;
  const shiftX = o.shiftX || 0;
  const shiftY = o.shiftY || 0;
  const rowsF = rows;
  // anchors in texel rows, and where each one lands in the photograph
  const anchors = [[0, f.y]];
  if (f.eye > f.y && f.eye < f.y + f.h) anchors.push([eyeRow * rows / 8, f.eye]);
  if (f.mouth > f.eye && f.mouth < f.y + f.h) anchors.push([mouthRow * rows / 8, f.mouth]);
  anchors.push([rowsF, f.y + f.h]);
  const cos = Math.cos(-f.tilt), sin = Math.sin(-f.tilt);
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;

  // the same trick across: an eye pinned to the middle of a column rather
  // than to the join between two
  const cols8 = cols / 8;
  const across = [[0, f.x]];
  if (f.eyeL !== null && f.eyeR !== null && f.eyeR > f.eyeL) {
    const lo = f.x + f.w * 0.10, hi = f.x + f.w * 0.90, mid = f.x + f.w / 2;
    const l = Math.min(Math.max(f.eyeL, lo), mid - f.w * 0.04);
    const r = Math.max(Math.min(f.eyeR, hi), mid + f.w * 0.04);
    across.push([2.5 * cols8, l], [5.5 * cols8, r]);
  }
  across.push([cols, f.x + f.w]);

  const walk = (list, t, last) => {
    for (let i = 1; i < list.length; i++) {
      const [aT, aV] = list[i - 1], [bT, bV] = list[i];
      if (t <= bT || i === list.length - 1) {
        const k = bT === aT ? 0 : (t - aT) / (bT - aT);
        return aV + (bV - aV) * k;
      }
    }
    return last;
  };
  const rowAt = (v) => walk(anchors, v, f.y + f.h);
  const colAt = (u) => walk(across, u, f.x + f.w);

  const out = new Array(cols * rows);
  const N = 4;
  for (let v = 0; v < rows; v++) {
    for (let u = 0; u < cols; u++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const fu = u + (i + 0.5) / N;
          const fv = v + (j + 0.5) / N;
          const px = cx + (colAt(fu) - cx) / zoomX + shiftX;
          const py = rowAt(fv) + shiftY;
          // lean the sampling grid rather than the picture
          const dx = px - cx, dy = py - cy;
          const sx = cx + dx * cos - dy * sin;
          const sy = cy + dx * sin + dy * cos;
          const c = photo.at(sx, sy);
          r += c[0]; g += c[1]; b += c[2]; n++;
        }
      }
      out[v * cols + u] = [r / n, g / n, b / n];
    }
  }
  return out;
}

/**
 * A plain rectangle of the photograph, squeezed into a grid.
 *
 * No warp and no anchors: a shirt has no eye line. What it does have is an
 * EDGE, and half the point of this is knowing how much of the rectangle was
 * actually in the picture — a head-and-shoulders shot has no trousers in it,
 * and a torso sampled off the bottom of the frame is a grey smear that
 * somebody has to notice and undo.
 */
export function sampleRect(photo, x, y, w, h, cols, rows) {
  const out = new Array(cols * rows);
  const N = 3;
  let inside = 0;
  for (let v = 0; v < rows; v++) {
    for (let u = 0; u < cols; u++) {
      let r = 0, g = 0, b = 0, n = 0, seen = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const px = x + w * (u + (i + 0.5) / N) / cols;
          const py = y + h * (v + (j + 0.5) / N) / rows;
          if (photo.inside(px, py)) seen++;
          const c = photo.at(px, py);
          r += c[0]; g += c[1]; b += c[2]; n++;
        }
      }
      inside += seen / n;
      out[v * cols + u] = [r / n, g / n, b / n, 255];
    }
  }
  out.covered = inside / (cols * rows);
  return out;
}

/**
 * The rest of the person, in head-heights.
 *
 * A head is the ruler every life-drawing class uses, and it is the only
 * ruler available here: once the head box is right, the shoulders are a
 * third of a head below the chin and the hips are a bit over two heads below
 * that, on anybody. Wrong for a child and wrong for a photograph taken from
 * below — which is why it is a BOX ON SCREEN and not a constant.
 */
export function bodyFrame(f) {
  const H = f.h, W = f.w;
  const cx = f.x + W / 2;
  const chin = f.y + H;
  const torsoW = W * 1.30;
  return {
    x: cx - torsoW / 2,
    y: chin + H * 0.30,
    w: torsoW,
    h: H * 1.95,
  };
}

/**
 * The colours a photograph offers, before anybody has drawn anything.
 *
 * Hair, skin, shirt, trousers, shoes and the background — the last one so
 * that everything else can be checked against it. A band that falls off the
 * bottom of the picture comes back null, and the generator picks instead:
 * a head-and-shoulders shot cannot be asked what shoes the man had on.
 */
export function probe(photo, f) {
  const bg = backgroundOf(photo, f);
  const chin = f.y + f.h;
  const cx = f.x + f.w / 2;
  const hair = photo.dominant(f.x + f.w * 0.22, f.y + f.h * 0.01, f.w * 0.56, f.h * 0.20, bg);
  const skin = skinOf(photo, f);
  const band = (a, b, wide) => {
    const y = chin + f.h * a, h = f.h * (b - a);
    if (y > photo.h - 4) return null;
    const w = f.w * wide;
    return photo.dominant(cx - w / 2, y, w, Math.min(h, photo.h - y), bg);
  };
  return {
    bg,
    hair: hair || (skin ? [skin[0] * 0.4, skin[1] * 0.36, skin[2] * 0.33] : [70, 48, 34]),
    skin: skin || [222, 176, 142],
    shirt: band(0.30, 1.15, 1.7),
    trousers: band(1.75, 2.80, 1.5),
    shoes: band(3.20, 3.90, 1.6),
  };
}

/**
 * What is behind the person.
 *
 * Taken from a ring just OUTSIDE the head, not from the corners of the
 * picture, because a wall is rarely one colour: photographed indoors it is a
 * gradient, and the corner of the frame can be half a stop away from the
 * patch actually touching somebody's ear. It is that touching patch the face
 * sampler will pick up, so it is that patch worth knowing.
 *
 * Five places round the upper half, and the median of them, so a hand or a
 * doorframe in one of the five does not carry the vote. Below the chin is
 * left out on purpose: that is shoulders.
 */
function backgroundOf(photo, f) {
  const spots = [];
  if (f) {
    const s = Math.max(3, f.w * 0.10);
    const out = [
      [f.x - f.w * 0.16, f.y + f.h * 0.10],
      [f.x + f.w / 2 - s / 2, f.y - f.h * 0.16],
      [f.x + f.w * 1.06, f.y + f.h * 0.10],
      [f.x - f.w * 0.16, f.y + f.h * 0.55],
      [f.x + f.w * 1.06, f.y + f.h * 0.55],
    ];
    for (const [x, y] of out) {
      const c = photo.area(x, y, s, s);
      if (c) spots.push(c);
    }
  }
  if (spots.length < 3) {
    const s = Math.max(4, Math.round(Math.min(photo.w, photo.h) * 0.06));
    for (const [x, y] of [[0, 0], [photo.w - s, 0], [0, photo.h - s], [photo.w - s, photo.h - s]]) {
      const c = photo.area(x, y, s, s);
      if (c) spots.push(c);
    }
  }
  if (!spots.length) return [0, 0, 0];
  const pick = (k) => {
    const v = spots.map((c) => c[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [pick(0), pick(1), pick(2)];
}

/** Complexion, taken off the cheeks and only from pixels that read as skin. */
function skinOf(photo, f) {
  const spots = [[0.28, 0.66], [0.72, 0.66], [0.5, 0.50], [0.5, 0.86], [0.34, 0.80], [0.66, 0.80]];
  const rad = Math.max(2, f.w * 0.05);
  const good = [];
  for (const [u, v] of spots) {
    const c = photo.area(f.x + f.w * u - rad, f.y + f.h * v - rad, rad * 2, rad * 2);
    if (c && skinish(c[0], c[1], c[2])) good.push(c);
  }
  if (!good.length) {
    const c = photo.area(f.x + f.w * 0.3, f.y + f.h * 0.6, f.w * 0.4, f.h * 0.2);
    return c;
  }
  // the median of what survived, channel by channel — one bright specular
  // highlight should not decide a complexion
  const pick = (k) => {
    const v = good.map((c) => c[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [pick(0), pick(1), pick(2)];
}
