// Working out which way somebody was facing, from a bag of photographs.
//
// The old flow asked for nine named shots and knew each one's angle because
// it had asked for it. Handing the program twenty photographs at once is a
// much better way to work — more outlines is exactly what a visual hull wants
// — but then nothing knows what angle any of them is.
//
// Three facts do nearly all of it:
//
//   **They are in order.** Somebody photographing themselves turning takes
//   the pictures in the order they turned, and a phone names files in the
//   order it took them. So sorting by name recovers the sequence, and the
//   angles are that sequence spread evenly round a circle. This is the whole
//   of the arithmetic and it is right far more often than any clever
//   alternative.
//
//   **The front is findable in two steps.** A body is wider across than it is
//   deep, so of the two pairs of opposite views the front-and-back pair is
//   the wide one — that names the axis, and rules out the profiles. Then skin
//   in the head band picks the end: facing the camera it is mostly face,
//   facing away it is mostly hair. Neither signal settles it alone — skin
//   cannot tell a front from a profile, since a profile is half a face — and
//   together they do. Nobody has to start facing the camera or say which one
//   they did.
//
//   **Which WAY they turned barely shows in a silhouette.** There is one
//   clue — the nose swings toward one side of the frame as they turn — and it
//   is accumulated over the quarter turn either side of the front and only
//   believed when it is decisive. Undecided means one fixed default, on
//   purpose: a guess that is right half the time hands back a MIRROR IMAGE of
//   the person half the time, which is worse than a default nobody has to
//   think about. The toggle beside the thumbnails fixes it in one tap.

import { skinish } from './photo.js';

/** Sort the way a person would: photo2 before photo10. */
export function naturalOrder(names) {
  return [...names].sort((a, b) => String(a).localeCompare(String(b), undefined, {
    numeric: true, sensitivity: 'base',
  }));
}

/**
 * How much of the head is FACE.
 *
 * Counted inside the silhouette only, over the top band of it, so hair,
 * background and shoulders are all out of it. Facing the camera this is high;
 * facing away it is nearly nothing, because the back of a head is hair. In
 * profile it lands in between, which is what makes the peak findable.
 *
 * Also returns where that skin sits ACROSS the head, which is the only clue
 * available to which way the turn went.
 */
export function faceScore(photo, sil) {
  if (!sil || sil.h < 8) return { score: 0, offset: 0 };
  const y0 = sil.y + Math.round(sil.h * 0.02);
  const y1 = sil.y + Math.round(sil.h * 0.17);
  const step = Math.max(1, Math.round(sil.h / 160));
  let skin = 0, all = 0, sum = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = sil.x; x < sil.x + sil.w; x += step) {
      if (x < 0 || y < 0 || x >= sil.mw || y >= sil.mh) continue;
      if (!sil.mask[y * sil.mw + x]) continue;
      all++;
      const c = photo.px(x, y);
      if (skinish(c[0], c[1], c[2])) { skin++; sum += x; }
    }
  }
  if (!all) return { score: 0, offset: 0 };
  const centre = sil.x + sil.w / 2;
  return {
    score: skin / all,
    offset: skin ? (sum / skin - centre) / sil.w : 0,
  };
}

/**
 * Give every photograph an angle.
 *
 * @param {Array} shots  [{ photo, sil, name }] in the order they were taken
 * @param {object} o     { front, flip } — overrides, when somebody disagrees
 */
export function assignAngles(shots, o = {}) {
  const n = shots.length;
  if (!n) return [];
  const step = 360 / n;
  const faces = shots.map((s) => faceScore(s.photo, s.sil));

  // The front, in two steps, because neither signal settles it alone.
  //
  // FIRST the axis. A body is wider across than it is deep, so of the two
  // pairs of opposite views, the front-and-back pair is the wide one — and
  // that is true of everybody, whatever they are wearing. Add each opposite
  // pair and the biggest sum names the front-back axis.
  //
  // THEN which end of it. Facing the camera, the head band is mostly face;
  // facing away it is mostly hair. Skin cannot tell a front from a PROFILE —
  // a profile shows plenty of cheek — but it separates a front from a back
  // easily, and the axis has already ruled the profiles out.
  let front = o.front === undefined || o.front === null || o.front < 0 || o.front >= n
    ? 0 : o.front;
  if (o.front === undefined || o.front === null || o.front < 0) {
    const wide = shots.map((s2) => (s2.sil && s2.sil.h ? s2.sil.w / s2.sil.h : 0));
    const half = Math.max(1, Math.round(n / 2));
    let bestAxis = -1, axisAt = 0;
    for (let i = 0; i < Math.min(n, half); i++) {
      const sum = wide[i] + wide[(i + half) % n];
      if (sum > bestAxis) { bestAxis = sum; axisAt = i; }
    }
    const other = (axisAt + half) % n;
    front = faces[axisAt].score >= faces[other].score ? axisAt : other;
  }

  // WHICH WAY ROUND.
  //
  // The only clue a silhouette offers is where the face sits across the head:
  // turning one way swings the nose toward one side of the frame and the
  // back of the head toward the other. It is a real signal on a real head and
  // no signal at all on a symmetrical one, so it is accumulated over the
  // whole quarter turn either side of the front and only believed when it is
  // decisive.
  //
  // Undecided means +1, deliberately. A guess that is right half the time
  // hands back a MIRROR IMAGE of the person half the time, which is worse
  // than a fixed default nobody has to think about — and one tap fixes it
  // either way, which is why the toggle sits next to the thumbnails and says
  // what it does.
  let dir = 1;
  if (o.flip !== undefined) {
    dir = o.flip ? -1 : 1;
  } else {
    const reach = Math.max(1, Math.floor(n / 4));
    let lean = 0, seen = 0;
    for (let k = 1; k <= reach; k++) {
      const nxt = faces[(front + k) % n].offset || 0;
      const prv = faces[(front - k + n * 2) % n].offset || 0;
      lean += nxt - prv;
      seen++;
    }
    if (seen && Math.abs(lean / seen) > 0.035) dir = lean >= 0 ? 1 : -1;
  }

  return shots.map((s, i) => {
    const k = ((i - front) % n + n) % n;
    const angle = ((dir * k * step) % 360 + 360) % 360;
    return { ...s, angle, front: i === front, face: faces[i].score };
  });
}

/**
 * Is this set worth carving, and what is wrong with it if not.
 *
 * The two failures worth catching before the carve rather than after: too few
 * turns to say anything, and a bunch of photographs that are all the SAME
 * angle — which happens when somebody photographs themselves eight times
 * without turning, and produces a hull that is a slab.
 */
export function checkSet(assigned) {
  const notes = [];
  if (assigned.length < 3) {
    notes.push('three photographs at least — a front, a side and a back');
    return { ok: false, notes };
  }
  const widths = assigned.map((a) => a.sil.w / Math.max(1, a.sil.h));
  const lo = Math.min(...widths), hi = Math.max(...widths);
  if (hi / lo < 1.12) {
    notes.push('every photograph is the same width — did the turns happen?');
  }
  if (assigned.length < 6) notes.push(`${assigned.length} turns works, but more fills it out`);
  return { ok: true, notes };
}
