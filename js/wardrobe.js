// The wardrobe.
//
// Minecraft's own character creator is a column of categories — Tops,
// Bottoms, Outerwear, Headwear, Gloves, Footwear, Face Items, Back Items —
// and a grid of things under each one. This is that, and it fits the skin
// format better than it has any right to, because Minecraft's two layers ARE
// the wardrobe's layers:
//
//   base   the person and what is against their skin: hair, shirt, trousers,
//          shoes, gloves, a beard
//   outer  what is worn OVER that: a jacket, a hat, glasses, a backpack
//
// So a hat goes on the head's overlay and covers whatever hair is underneath,
// exactly as a hat does, and taking it off reveals the hair rather than a
// hole. Nothing here needed a third layer, which is just as well: Minecraft
// renders two.
//
// Nothing here is a stored picture. Every one of these is a function drawing
// in FRACTIONS of the part it is on, which is what lets two hundred garments
// fit a 64 and a 256 alike and take whatever colour they are handed. What
// makes them look like CLOTHES rather than colour swatches is `cloth.js` —
// weave, light, print and edges — and it is worth reading that first.

import { shade, mix, hexToRgb } from './pixels.js';
import { FACES, WEAVE, PRINT, panel, rows, sub, line, jitter } from './cloth.js';

const saltOf = (id) => {
  let n = 7;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(n) % 9973;
};

/** Lay a colour over every face of a part, wherever `mask` says yes. */
function overFaces(skin, rects, mask, colour, ink, faces = FACES) {
  for (const face of faces) {
    skin.mapRect(rects[face], (u, v, cur, w, h) => {
      const t = mask(face, (u + 0.5) / w, (v + 0.5) / h, u, v, w, h);
      if (!t) return null;
      const c = typeof colour === 'function' ? colour(face, u, v, w, h) : colour;
      return ink.lit(c, face);
    });
  }
}

// ===========================================================================
// hair
// ===========================================================================
//
// One mask and a table of shapes. What makes a STYLE is where the hair stops
// — how far down the forehead, the sides and the back — and what the edge of
// it does. What makes it look like HAIR rather than a brown hat is the
// stranding: vertical runs of two or three tones, a highlight where the crown
// catches the light, and roots a shade darker than the ends.

const EDGE = {
  straight: () => 0,
  ragged: (u, v, s) => (jitter(Math.round(u * 26), 0, s) - 0.5) * 0.11,
  spiky: (u, v, s) => (jitter(Math.round(u * 14), 0, s) > 0.5 ? -0.12 : 0.07),
  wavy: (u) => Math.sin(u * 13) * 0.05,
  curly: (u, v, s) => (jitter(Math.round(u * 18), Math.round(v * 18), s) - 0.5) * 0.15,
  blunt: (u) => (Math.abs(u - 0.5) > 0.42 ? 0.06 : 0),
};

function hairStyle(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      const edge = EDGE[o.edge || 'straight'];
      const sideW = o.sideWidth === undefined ? 0.14 : o.sideWidth;

      const hairAt = (face, x, y) => {
        if (face === 'bottom') return false;
        if (face === 'top') return !o.bald;
        const wob = edge(x, y, salt);
        if (face === 'front') {
          if (o.bald) return y < 0.09 && (x < 0.17 || x > 0.83);
          if (o.mohawk) return y < o.fringe + wob && Math.abs(x - 0.5) < (o.strip || 0.14);
          if (o.parted && y < o.fringe + wob) {
            // a centre parting is a wedge of forehead, and at this size it is
            // most of what separates two otherwise identical dark haircuts
            return Math.abs(x - 0.5) > 0.06 || y < o.fringe * 0.42;
          }
          if (y < o.fringe + wob) return true;
          return y < (o.sideLen || 0) && (x < sideW || x > 1 - sideW);
        }
        if (face === 'back') {
          if (o.mohawk) return y < o.backLen && Math.abs(x - 0.5) < (o.strip || 0.14);
          return y < o.backLen + wob;
        }
        if (o.mohawk) return y < 0.10;
        if (o.fade) {
          const toBack = face === 'right' ? 1 - x : x;
          return y < (o.sideLen || o.fringe) * (0.45 + toBack * 0.9) + wob;
        }
        return y < (o.sideLen || o.fringe) + wob;
      };

      const tone = (face, u, v, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        let k = 1 - y * 0.16;                                 // roots darker
        k *= 1 + (jitter(Math.round(x * 22), 0, salt) - 0.5) * 0.22;   // strands
        k *= 1 + (jitter(u, v, salt + 5) - 0.5) * 0.07;
        if (face === 'top' || y < 0.14) k *= 1.09;            // the crown
        if (o.shine && Math.abs(x - 0.34) < 0.09 && y > 0.12 && y < 0.5) k *= 1.22;
        return shade(col, k);
      };

      overFaces(skin, c.parts.head.rects, (face, x, y) => hairAt(face, x, y), tone, c.ink);

      if (o.parted) {
        skin.mapRect(c.parts.head.rects.top, (u, v, cur, w) => (
          Math.abs((u + 0.5) / w - 0.5) < 0.07 ? shade(cur, 0.8) : null
        ));
      } else if (o.part) {
        skin.mapRect(c.parts.head.rects.top, (u, v, cur, w) => (
          Math.abs((u + 0.5) / w - o.part) < 0.07 ? shade(cur, 0.82) : null
        ));
      }

      // anything that stands proud of the skull gets the second layer as well
      if (o.puff) {
        overFaces(skin, c.parts.head.overRects, (face, x, y) => (
          face !== 'bottom' && hairAt(face, x, y)
          && (o.puffAll || jitter(Math.round(x * 18), Math.round(y * 18), salt + 9) > 0.24)
        ), tone, c.ink);
      }
      if (o.tail) {
        const r = c.parts.head.overRects.back;
        const box = o.tail === 'bun' ? sub(r, 0.32, 0.00, 0.68, 0.32)
          : o.tail === 'topknot' ? sub(r, 0.36, 0.00, 0.64, 0.18)
            : sub(r, 0.38, 0.20, 0.62, 1.0);
        skin.mapRect(box, (u, v, cur, w, h) => shade(col, 1 - ((v + 0.5) / h) * 0.2
          + (jitter(u, v, salt) - 0.5) * 0.12));
      }
      if (o.pigtails) {
        for (const face of ['right', 'left']) {
          const r = c.parts.head.overRects[face];
          skin.mapRect(sub(r, 0.14, 0.40, 0.62, 0.98), (u, v, cur, w, h) => (
            shade(col, 1 - ((v + 0.5) / h) * 0.18 + (jitter(u, v, salt) - 0.5) * 0.14)
          ));
        }
      }
      if (o.braids) {
        overFaces(skin, c.parts.head.rects, (face, x, y) => (
          face !== 'bottom' && hairAt(face, x, y) && Math.floor(x * 9) % 2 === 0
        ), () => shade(col, 0.78), c.ink);
      }
    },
  };
}

export const HAIR = [
  { id: 'none', name: 'Shaved', draw() {} },
  hairStyle('gradeone', 'Grade one', { fringe: 0.20, sideLen: 0.26, backLen: 0.34 }),
  hairStyle('buzz', 'Buzz cut', { fringe: 0.24, sideLen: 0.30, backLen: 0.40 }),
  hairStyle('crew', 'Crew cut', { fringe: 0.26, sideLen: 0.30, backLen: 0.42, shine: true }),
  hairStyle('caesar', 'Caesar', { fringe: 0.34, sideLen: 0.32, backLen: 0.44, edge: 'blunt' }),
  hairStyle('crop', 'French crop', { fringe: 0.30, sideLen: 0.28, backLen: 0.44, edge: 'ragged', fade: true }),
  hairStyle('fade', 'High fade', { fringe: 0.30, sideLen: 0.34, backLen: 0.48, fade: true, shine: true }),
  hairStyle('short', 'Short back and sides', { fringe: 0.32, sideLen: 0.38, backLen: 0.50, part: 0.34 }),
  hairStyle('sidepart', 'Side part', { fringe: 0.34, sideLen: 0.42, backLen: 0.54, part: 0.26, shine: true }),
  hairStyle('combover', 'Comb over', { fringe: 0.30, sideLen: 0.34, backLen: 0.48, part: 0.18, shine: true }),
  hairStyle('quiff', 'Quiff', { fringe: 0.18, sideLen: 0.28, backLen: 0.44, edge: 'spiky', puff: true, shine: true }),
  hairStyle('pompadour', 'Pompadour', { fringe: 0.14, sideLen: 0.26, backLen: 0.44, puff: true, puffAll: true, shine: true }),
  hairStyle('flattop', 'Flat top', { fringe: 0.22, sideLen: 0.26, backLen: 0.38, edge: 'blunt', puff: true, puffAll: true }),
  hairStyle('spiky', 'Spiky', { fringe: 0.26, sideLen: 0.32, backLen: 0.46, edge: 'spiky', puff: true }),
  hairStyle('messy', 'Bed head', { fringe: 0.34, sideLen: 0.44, backLen: 0.58, edge: 'ragged', puff: true }),
  hairStyle('shag', 'Shag', { fringe: 0.40, sideLen: 0.62, backLen: 0.74, edge: 'ragged', puff: true }),
  hairStyle('curtains', 'Curtains', { fringe: 0.46, sideLen: 0.56, backLen: 0.62, parted: true, shine: true }),
  hairStyle('emo', 'Side fringe', { fringe: 0.52, sideLen: 0.60, backLen: 0.64, edge: 'wavy', part: 0.72 }),
  hairStyle('bowl', 'Bowl', { fringe: 0.40, sideLen: 0.48, backLen: 0.56, edge: 'blunt' }),
  hairStyle('fringe', 'Blunt fringe', { fringe: 0.44, sideLen: 0.54, backLen: 0.64 }),
  hairStyle('hime', 'Hime', { fringe: 0.42, sideLen: 0.92, backLen: 1.0, edge: 'blunt', sideWidth: 0.20 }),
  hairStyle('bob', 'Bob', { fringe: 0.36, sideLen: 0.76, backLen: 0.80, sideWidth: 0.16, shine: true }),
  hairStyle('bobwave', 'Wavy bob', { fringe: 0.36, sideLen: 0.78, backLen: 0.84, edge: 'wavy', sideWidth: 0.18 }),
  hairStyle('lob', 'Long bob', { fringe: 0.32, sideLen: 0.88, backLen: 0.92, sideWidth: 0.18, shine: true }),
  hairStyle('long', 'Long', { fringe: 0.30, sideLen: 0.95, backLen: 1.0, sideWidth: 0.18, shine: true }),
  hairStyle('longwave', 'Long wavy', { fringe: 0.32, sideLen: 0.95, backLen: 1.0, edge: 'wavy', sideWidth: 0.20 }),
  hairStyle('longpart', 'Long, centre part', { fringe: 0.40, sideLen: 0.96, backLen: 1.0, parted: true, sideWidth: 0.20, shine: true }),
  hairStyle('curly', 'Curly', { fringe: 0.36, sideLen: 0.60, backLen: 0.70, edge: 'curly', puff: true }),
  hairStyle('ringlets', 'Ringlets', { fringe: 0.34, sideLen: 0.86, backLen: 0.94, edge: 'curly', puff: true, sideWidth: 0.22 }),
  hairStyle('afro', 'Afro', { fringe: 0.30, sideLen: 0.52, backLen: 0.62, edge: 'curly', puff: true, puffAll: true }),
  hairStyle('coils', 'Coils', { fringe: 0.26, sideLen: 0.40, backLen: 0.52, edge: 'curly', puff: true, puffAll: true }),
  hairStyle('cornrows', 'Cornrows', { fringe: 0.24, sideLen: 0.34, backLen: 0.52, braids: true }),
  hairStyle('boxbraids', 'Box braids', { fringe: 0.30, sideLen: 0.88, backLen: 0.96, braids: true, sideWidth: 0.20 }),
  hairStyle('dreads', 'Locs', { fringe: 0.28, sideLen: 0.86, backLen: 0.94, edge: 'spiky', sideWidth: 0.20 }),
  hairStyle('shortlocs', 'Short locs', { fringe: 0.28, sideLen: 0.40, backLen: 0.52, edge: 'spiky', puff: true }),
  hairStyle('ponytail', 'Ponytail', { fringe: 0.30, sideLen: 0.36, backLen: 0.50, tail: 'tail', shine: true }),
  hairStyle('highpony', 'High ponytail', { fringe: 0.26, sideLen: 0.30, backLen: 0.42, tail: 'tail' }),
  hairStyle('bun', 'Bun', { fringe: 0.28, sideLen: 0.34, backLen: 0.48, tail: 'bun' }),
  hairStyle('topknot', 'Top knot', { fringe: 0.22, sideLen: 0.20, backLen: 0.34, tail: 'topknot' }),
  hairStyle('spacebuns', 'Space buns', { fringe: 0.30, sideLen: 0.32, backLen: 0.44, pigtails: true }),
  hairStyle('pigtails', 'Pigtails', { fringe: 0.34, sideLen: 0.44, backLen: 0.56, pigtails: true }),
  hairStyle('mullet', 'Mullet', { fringe: 0.24, sideLen: 0.34, backLen: 1.0, edge: 'ragged' }),
  hairStyle('wolf', 'Wolf cut', { fringe: 0.42, sideLen: 0.70, backLen: 0.96, edge: 'ragged', puff: true }),
  hairStyle('mohawk', 'Mohawk', { fringe: 0.36, backLen: 0.52, mohawk: true, strip: 0.13, edge: 'spiky', puff: true, puffAll: true }),
  hairStyle('fauxhawk', 'Faux hawk', { fringe: 0.30, backLen: 0.46, mohawk: true, strip: 0.20, puff: true }),
  hairStyle('undercut', 'Undercut', { fringe: 0.32, sideLen: 0.12, backLen: 0.28, part: 0.30, shine: true }),
  hairStyle('sideshave', 'Side shave', { fringe: 0.40, sideLen: 0.70, backLen: 0.80, part: 0.80, sideWidth: 0.30 }),
  hairStyle('receding', 'Receding', { fringe: 0.11, sideLen: 0.44, backLen: 0.56, sideWidth: 0.22 }),
  hairStyle('balding', 'Balding', { bald: true, sideLen: 0.44, backLen: 0.52, fringe: 0 }),
];

// ===========================================================================
// tops
// ===========================================================================

function top(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      const P = c.parts;
      const trim = o.trim ? mix(col, hexToRgb(o.trim), 0.8) : shade(col, o.trimK || 1.18);
      const bare = c.pal.skin;

      for (const face of FACES) {
        skin.mapRect(P.body.rects[face], panel(col, face, o, c.ink, salt));
      }
      skin.mapRect(P.body.rects.top, (u, v, cur, w, h) => (
        u >= w * 0.25 && u < w * 0.75 && v >= h * 0.25 && v < h * 0.75
          ? c.ink.lit(shade(bare, 0.9), 'top') : null
      ));

      // --- the neckline, which is most of a top's character ---------------
      const neck = o.neck || 'crew';
      for (const face of ['front', 'back']) {
        skin.mapRect(P.body.rects[face], (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          const d = Math.abs(x - 0.5) * 2;
          if (neck === 'vee' && face === 'front') {
            if (y < 0.24 && d < 0.52 - y * 1.7) return c.ink.lit(shade(bare, 0.95), face);
            if (y < 0.28 && Math.abs(d - (0.52 - y * 1.7)) < 0.13) return c.ink.lit(trim, face);
            return null;
          }
          if (neck === 'scoop') {
            return y < 0.16 && d < 0.62 ? c.ink.lit(shade(bare, 0.95), face) : null;
          }
          if (neck === 'tank') {
            return (y < 0.40 && d > 0.56) || (y < 0.14 && d < 0.62)
              ? c.ink.lit(shade(bare, 0.95), face) : null;
          }
          if (neck === 'collar') {
            if (y < 0.09) return c.ink.lit(trim, face);
            if (y < 0.15 && d < 0.42) return c.ink.lit(shade(trim, 0.86), face);
            return null;
          }
          if (neck === 'polo') {
            if (y < 0.09) return c.ink.lit(trim, face);
            if (face === 'front' && y < 0.30 && d < 0.16) return c.ink.lit(shade(col, 0.8), face);
            return null;
          }
          if (neck === 'roll') {
            return y < 0.13 ? c.ink.lit(shade(trim, 1.02), face) : null;
          }
          return y * h < line(h) ? c.ink.lit(trim, face) : null;     // a crew rib
        });
      }

      // --- fastenings and prints ------------------------------------------
      const front = P.body.rects.front;
      if (o.mark === 'zip') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const d = Math.abs((u + 0.5) / w - 0.5), y = (v + 0.5) / h;
          if (d > 0.055) return null;
          return c.ink.lit(y < 0.14 ? [206, 202, 194] : shade(col, 0.6), 'front');
        });
      } else if (o.mark === 'buttons') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const d = Math.abs((u + 0.5) / w - 0.5), y = (v + 0.5) / h;
          if (d < 0.05) return c.ink.lit(shade(col, 0.82), 'front');
          if (d < 0.10 && (Math.abs(y - 0.26) < 0.04 || Math.abs(y - 0.52) < 0.04
            || Math.abs(y - 0.78) < 0.04)) return c.ink.lit([226, 222, 210], 'front');
          return null;
        });
      } else if (o.mark === 'placket') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const d = Math.abs((u + 0.5) / w - 0.5), y = (v + 0.5) / h;
          return d < 0.07 && y < 0.42 ? c.ink.lit(shade(col, 0.86), 'front') : null;
        });
      } else if (o.mark === 'number') {
        skin.mapRect(P.body.rects.back, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          const on = y > 0.26 && y < 0.64 && ((x > 0.28 && x < 0.40) || (x > 0.60 && x < 0.72)
            || (y > 0.42 && y < 0.52 && x > 0.28 && x < 0.72));
          return on ? c.ink.lit([238, 234, 226], 'back') : null;
        });
      } else if (o.mark === 'print') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (x < 0.26 || x > 0.74 || y < 0.28 || y > 0.60) return null;
          const n = jitter(Math.round(x * 14), Math.round(y * 14), salt);
          return c.ink.lit(shade(col, n > 0.55 ? 1.7 : n > 0.3 ? 1.3 : 0.6), 'front');
        });
      } else if (o.mark === 'pocket') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (x < 0.16 || x > 0.48 || y < 0.28 || y > 0.50) return null;
          return c.ink.lit(shade(col, y < 0.32 ? 0.78 : 0.94), 'front');
        });
      } else if (o.mark === 'apron') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (x < 0.18 || x > 0.82) return null;
          if (y < 0.20 && Math.abs(x - 0.5) > 0.18) return null;
          return c.ink.lit(shade(mix(col, [236, 232, 222], 0.7), 1 - y * 0.1), 'front');
        });
      }

      // --- the sleeves ------------------------------------------------------
      const sleeve = o.sleeve;
      for (const key of ['armR', 'armL']) {
        const arm = P[key];
        for (const face of FACES) {
          const cloth = panel(col, face, { ...o, hem: false }, c.ink, salt);
          const bareArm = panel(bare, face, { weave: 'cotton', fall: 0.09, roll: 0.08, hem: false }, c.ink, salt + 3);
          skin.mapRect(arm.rects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h;
            if (face === 'top') return c.ink.lit(sleeve > 0 ? shade(col, 1.06) : bare, face);
            if (face === 'bottom') return c.ink.lit(sleeve >= 1 ? shade(col, 0.9) : shade(bare, 0.9), face);
            if (y > sleeve) {
              const out = bareArm(u, v, cur, w, h);
              return y > 0.86 ? shade(out, 0.94) : out;      // fingers
            }
            let out = cloth(u, v, cur, w, h);
            if (sleeve < 0.99 && y > sleeve - 0.10) out = shade(out, 0.84);   // the cuff
            if (y < 0.10) out = shade(out, 0.92);                             // shoulder seam
            return out;
          });
        }
      }
    },
  };
}

export const TOPS = [
  { id: 'none',
    name: 'Bare',
    draw(skin, c) {
      for (const key of ['body', 'armR', 'armL']) {
        for (const face of FACES) {
          skin.mapRect(c.parts[key].rects[face],
            panel(c.pal.skin, face, { weave: 'cotton', fall: 0.09, roll: 0.09, hem: false }, c.ink, 11));
        }
      }
    } },
  top('tee', 'T-shirt', { sleeve: 0.34, neck: 'crew', weave: 'cotton' }),
  top('teevee', 'V-neck tee', { sleeve: 0.34, neck: 'vee', weave: 'cotton' }),
  top('scoop', 'Scoop neck', { sleeve: 0.30, neck: 'scoop', weave: 'cotton' }),
  top('tank', 'Vest', { sleeve: 0.05, neck: 'tank', weave: 'cotton' }),
  top('longtee', 'Long sleeve', { sleeve: 0.94, neck: 'crew', weave: 'cotton' }),
  top('jumper', 'Jumper', { sleeve: 1, neck: 'collar', weave: 'knit', trimK: 0.86 }),
  top('cable', 'Cable knit', { sleeve: 1, neck: 'collar', weave: 'cable', trimK: 0.86 }),
  top('roll', 'Roll-neck', { sleeve: 1, neck: 'roll', weave: 'knit' }),
  top('argyle', 'Argyle jumper', { sleeve: 1, neck: 'vee', weave: 'knit', print: 'argyle' }),
  top('hoodie', 'Hoodie', { sleeve: 1, neck: 'collar', weave: 'cotton', mark: 'zip' }),
  top('sweat', 'Sweatshirt', { sleeve: 1, neck: 'collar', weave: 'cotton', mark: 'print' }),
  top('shirt', 'Shirt', { sleeve: 1, neck: 'collar', weave: 'linen', mark: 'buttons' }),
  top('shortshirt', 'Short-sleeved shirt', { sleeve: 0.34, neck: 'collar', weave: 'linen', mark: 'buttons' }),
  top('oxford', 'Oxford', { sleeve: 1, neck: 'collar', weave: 'linen', print: 'pin', mark: 'buttons' }),
  top('polo', 'Polo', { sleeve: 0.34, neck: 'polo', weave: 'cotton' }),
  top('rugby', 'Rugby shirt', { sleeve: 1, neck: 'polo', weave: 'cotton', print: 'wide' }),
  top('striped', 'Striped tee', { sleeve: 0.34, neck: 'crew', weave: 'cotton', print: 'hoops' }),
  top('breton', 'Breton', { sleeve: 0.94, neck: 'crew', weave: 'cotton', print: 'fine' }),
  top('vstripe', 'Vertical stripes', { sleeve: 0.94, neck: 'collar', weave: 'linen', print: 'stripes', mark: 'buttons' }),
  top('plaid', 'Plaid shirt', { sleeve: 1, neck: 'collar', weave: 'linen', print: 'plaid', mark: 'buttons' }),
  top('tartan', 'Tartan shirt', { sleeve: 1, neck: 'collar', weave: 'linen', print: 'tartan', mark: 'buttons' }),
  top('checks', 'Checked shirt', { sleeve: 0.34, neck: 'collar', weave: 'linen', print: 'checker', mark: 'buttons' }),
  top('jersey', 'Football strip', { sleeve: 0.34, neck: 'crew', weave: 'cotton', print: 'stripes', mark: 'number' }),
  top('hooped', 'Hooped strip', { sleeve: 0.34, neck: 'polo', weave: 'cotton', print: 'hoops', mark: 'number' }),
  top('band', 'Band tee', { sleeve: 0.34, neck: 'crew', weave: 'cotton', mark: 'print' }),
  top('track', 'Track top', { sleeve: 1, neck: 'collar', weave: 'satin', print: 'sides', mark: 'zip' }),
  top('camo', 'Camo shirt', { sleeve: 1, neck: 'collar', weave: 'linen', print: 'camo', mark: 'buttons' }),
  top('hivis', 'Hi-vis', { sleeve: 0.34, neck: 'crew', weave: 'cotton', print: 'hazard' }),
  top('work', 'Work shirt', { sleeve: 1, neck: 'collar', weave: 'denim', mark: 'pocket' }),
  top('apron', 'Apron', { sleeve: 0.34, neck: 'crew', weave: 'cotton', mark: 'apron' }),
  top('robe', 'Dressing gown', { sleeve: 1, neck: 'vee', weave: 'towel', mark: 'placket' }),
  top('tunic', 'Tunic', { sleeve: 0.72, neck: 'vee', weave: 'linen', print: 'speckle' }),
  top('mail', 'Chainmail', { sleeve: 0.72, neck: 'crew', weave: 'scale' }),
];

// ===========================================================================
// bottoms
// ===========================================================================

function bottom(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      const bare = c.pal.skin;
      for (const key of ['legR', 'legL']) {
        const leg = c.parts[key];
        const inner = key === 'legR' ? 'left' : 'right';
        for (const face of FACES) {
          const cloth = panel(col, face, { ...o, hem: false }, c.ink, salt);
          const bareLeg = panel(bare, face, { weave: 'cotton', fall: 0.08, roll: 0.07, hem: false }, c.ink, salt + 7);
          skin.mapRect(leg.rects[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            if (face === 'top') return c.ink.lit(shade(col, 1.05), face);
            if (face === 'bottom') return null;                  // footwear's job
            if (y > o.length) return bareLeg(u, v, cur, w, h);
            let out = cloth(u, v, cur, w, h);
            if (o.length < 0.99 && y > o.length - 0.06) out = shade(out, 0.82);
            if (o.turnup && y > o.length - 0.14 && y <= o.length - 0.06) out = shade(out, 1.12);
            if (o.pocket && y > 0.08 && y < 0.26 && (x < 0.24 || x > 0.76)) out = shade(out, 0.88);
            if (o.seam && face === inner && Math.abs(x - 0.5) < 0.18) out = shade(out, 0.9);
            if (o.knee && Math.abs(y - 0.46) < 0.05 && face === 'front') out = shade(out, 0.93);
            return out;
          });
        }
      }
      if (o.belt) {
        const belt = hexToRgb(o.belt);
        for (const key of ['legR', 'legL']) {
          for (const face of ['front', 'back', 'right', 'left']) {
            rows(skin, c.parts[key].rects[face], 0, 0.075, () => c.ink.lit(belt, face));
          }
          const inner = key === 'legR' ? 0.78 : 0.22;
          skin.mapRect(c.parts[key].rects.front, (u, v, cur, w, h) => (
            (v + 0.5) / h < 0.075 && Math.abs((u + 0.5) / w - inner) < 0.24
              ? c.ink.lit([214, 190, 122], 'front') : null
          ));
        }
      }
    },
  };
}

export const BOTTOMS = [
  { id: 'none',
    name: 'Bare legs',
    draw(skin, c) {
      for (const key of ['legR', 'legL']) {
        for (const face of FACES) {
          if (face === 'bottom') continue;
          skin.mapRect(c.parts[key].rects[face],
            panel(c.pal.skin, face, { weave: 'cotton', fall: 0.08, roll: 0.08, hem: false }, c.ink, 13));
        }
      }
    } },
  bottom('jeans', 'Jeans', { length: 1, weave: 'denim', seam: true, pocket: true, belt: '#3b2b1e' }),
  bottom('blackjeans', 'Black jeans', { length: 1, weave: 'denim', seam: true, pocket: true, belt: '#241d18' }),
  bottom('ripped', 'Ripped jeans', { length: 1, weave: 'denim', print: 'speckle', seam: true, knee: true, pocket: true }),
  bottom('trousers', 'Trousers', { length: 1, weave: 'linen', seam: true, belt: '#2d2620' }),
  bottom('chinos', 'Chinos', { length: 1, weave: 'cotton', pocket: true, belt: '#5a4632' }),
  bottom('cord', 'Corduroys', { length: 1, weave: 'cord', pocket: true, belt: '#4a3826' }),
  bottom('cargo', 'Cargo trousers', { length: 1, weave: 'cotton', pocket: true, print: 'panel', belt: '#3b3327' }),
  bottom('combat', 'Combats', { length: 1, weave: 'cotton', print: 'camo', pocket: true, belt: '#2f2c22' }),
  bottom('suit', 'Suit trousers', { length: 1, weave: 'flat', seam: true, turnup: true, belt: '#22201e' }),
  bottom('pinstripe', 'Pinstripes', { length: 1, weave: 'flat', print: 'pin', seam: true, belt: '#22201e' }),
  bottom('track', 'Tracksuit bottoms', { length: 1, weave: 'satin', print: 'sides' }),
  bottom('joggers', 'Joggers', { length: 0.94, weave: 'cotton', turnup: true }),
  bottom('leggings', 'Leggings', { length: 1, weave: 'knit', roll: 0.16 }),
  bottom('tights', 'Tights', { length: 1, weave: 'flat', roll: 0.20 }),
  bottom('shorts', 'Shorts', { length: 0.44, weave: 'cotton', pocket: true, belt: '#4a3826' }),
  bottom('longshorts', 'Long shorts', { length: 0.62, weave: 'denim', pocket: true, turnup: true }),
  bottom('cutoffs', 'Cut-offs', { length: 0.40, weave: 'denim', print: 'speckle', pocket: true }),
  bottom('trunks', 'Swimming trunks', { length: 0.34, weave: 'satin', print: 'hoops' }),
  bottom('skirt', 'Skirt', { length: 0.40, weave: 'cotton' }),
  bottom('pleated', 'Pleated skirt', { length: 0.46, weave: 'linen', print: 'stripes' }),
  bottom('kilt', 'Kilt', { length: 0.50, weave: 'linen', print: 'tartan' }),
  bottom('longskirt', 'Long skirt', { length: 0.80, weave: 'linen', print: 'fine' }),
  bottom('dungaree', 'Dungarees', { length: 1, weave: 'denim', seam: true, print: 'panel', pocket: true }),
  bottom('greaves', 'Greaves', { length: 1, weave: 'metal', print: 'panel' }),
];

// ===========================================================================
// outerwear — the body's second layer, which is exactly what a jacket is
// ===========================================================================

function outer(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    layer: 'over',
    draw(skin, c) {
      const col = c.colour;
      const P = c.parts;
      const trim = o.trim ? mix(col, hexToRgb(o.trim), 0.8) : shade(col, 1.22);
      for (const face of FACES) {
        const cloth = panel(col, face, { ...o, hem: false }, c.ink, salt);
        skin.mapRect(P.body.overRects[face], (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (y > o.length) return [0, 0, 0, 0];
          if (o.open && face === 'front' && Math.abs(x - 0.5) < o.open) return [0, 0, 0, 0];
          let out = cloth(u, v, cur, w, h);
          if (o.collar && y < 0.10) out = shade(trim, 1);
          if (o.belted && Math.abs(y - 0.62) < 0.05) out = shade(out, 0.74);
          if (o.open && face === 'front' && Math.abs(x - 0.5) < o.open + 0.09) out = shade(out, 0.84);
          if (o.length < 0.99 && y > o.length - 0.05) out = shade(out, 0.82);
          if (o.pockets && y > 0.55 && y < 0.76 && (x < 0.26 || x > 0.74)) out = shade(out, 0.86);
          return out;
        });
      }
      for (const key of ['armR', 'armL']) {
        for (const face of FACES) {
          const cloth = panel(col, face, { ...o, hem: false }, c.ink, salt);
          skin.mapRect(P[key].overRects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h;
            if (y > o.sleeve) return [0, 0, 0, 0];
            let out = cloth(u, v, cur, w, h);
            if (o.sleeve < 0.99 && y > o.sleeve - 0.09) out = shade(out, 0.84);
            if (o.cuff && y > 0.88) out = shade(trim, 1);
            return out;
          });
        }
      }
      if (o.hood) {
        overFaces(skin, P.head.overRects, (face, x, y) => (
          face === 'back' || face === 'top'
          || ((face === 'right' || face === 'left') && x < 0.42)
          || (face === 'front' && y < 0.10)
        ), (face, u, v, w, h) => panel(col, face, { ...o, hem: false }, c.ink, salt)(u, v, null, w, h),
        c.ink);
      }
    },
  };
}

export const OUTERWEAR = [
  { id: 'none', name: 'None', layer: 'over', draw() {} },
  outer('jacket', 'Jacket', { length: 0.94, sleeve: 1, open: 0.09, weave: 'cotton', collar: true, pockets: true }),
  outer('denim', 'Denim jacket', { length: 0.70, sleeve: 1, open: 0.09, weave: 'denim', collar: true, pockets: true }),
  outer('leather', 'Leather jacket', { length: 0.74, sleeve: 1, open: 0.10, weave: 'leather', collar: true, trim: '#2a2320' }),
  outer('biker', 'Biker jacket', { length: 0.72, sleeve: 1, open: 0.14, weave: 'leather', collar: true, belted: true }),
  outer('bomber', 'Bomber', { length: 0.70, sleeve: 1, weave: 'satin', print: 'panel', collar: true, cuff: true, trim: '#c9a24a' }),
  outer('varsity', 'Varsity jacket', { length: 0.74, sleeve: 1, weave: 'cotton', print: 'sides', collar: true, cuff: true }),
  outer('coat', 'Long coat', { length: 1, sleeve: 1, open: 0.07, weave: 'linen', collar: true, pockets: true }),
  outer('trench', 'Trench coat', { length: 1, sleeve: 1, open: 0.07, weave: 'linen', collar: true, belted: true, pockets: true }),
  outer('parka', 'Parka', { length: 1, sleeve: 1, weave: 'quilt', hood: true, collar: true, pockets: true, trim: '#7a6a4e' }),
  outer('puffer', 'Puffer', { length: 0.90, sleeve: 1, weave: 'quilt', collar: true }),
  outer('ziphood', 'Zip hoodie', { length: 0.92, sleeve: 1, open: 0.06, weave: 'cotton', hood: true, cuff: true }),
  outer('anorak', 'Anorak', { length: 0.88, sleeve: 1, weave: 'satin', print: 'wide', hood: true }),
  outer('cardigan', 'Cardigan', { length: 0.96, sleeve: 1, open: 0.13, weave: 'knit', pockets: true }),
  outer('gilet', 'Gilet', { length: 0.86, sleeve: 0, open: 0.09, weave: 'quilt', collar: true }),
  outer('waistcoat', 'Waistcoat', { length: 0.94, sleeve: 0, open: 0.12, weave: 'satin', collar: true }),
  outer('labcoat', 'Lab coat', { length: 1, sleeve: 1, open: 0.07, weave: 'linen', collar: true, pockets: true }),
  outer('hivis', 'Hi-vis vest', { length: 0.82, sleeve: 0, open: 0.09, weave: 'cotton', print: 'hazard' }),
  outer('workapron', 'Work apron', { length: 1, sleeve: 0, weave: 'leather', belted: true }),
  outer('poncho', 'Poncho', { length: 1, sleeve: 0.30, weave: 'linen', print: 'chevron' }),
  outer('cloak', 'Cloak', { length: 1, sleeve: 0.16, weave: 'linen', hood: true, collar: true }),
  outer('breastplate', 'Breastplate', { length: 0.80, sleeve: 0.32, weave: 'metal', collar: true, trim: '#c9c4bb' }),
  outer('chainmail', 'Chainmail', { length: 0.88, sleeve: 0.86, weave: 'scale' }),
  outer('wizard', 'Wizard robe', { length: 1, sleeve: 1, weave: 'satin', print: 'speckle', hood: true }),
  outer('scarf', 'Scarf', { length: 0.22, sleeve: 0, weave: 'knit', print: 'hoops' }),
];

// ===========================================================================
// headwear — the head's outer layer
// ===========================================================================

function headwear(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    layer: 'over',
    draw(skin, c) {
      const col = c.colour;
      const R = c.parts.head.overRects;
      const band = o.band === undefined ? 0.30 : o.band;
      const trim = o.trim ? mix(col, hexToRgb(o.trim), 0.8) : shade(col, 0.7);

      const covered = (face, x, y) => {
        if (face === 'bottom') return false;
        if (face === 'top') return o.crown !== false;
        switch (o.shape) {
          case 'band': return y > band - 0.13 && y < band;
          case 'bandana': return y < band && (face !== 'front' || y < band * 0.75);
          case 'cap': return y < band;
          case 'visor': return y > band - 0.14 && y < band;
          case 'crown': return y < (Math.floor(x * 5) % 2 === 0 ? band : band * 0.5);
          case 'horns':
          case 'ears':
          case 'none': return false;
          default: return y < band;
        }
      };

      overFaces(skin, R, covered, (face, u, v, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        if (o.rim && y > band - 0.11 && y < band) return trim;
        if (face === 'top' && o.button && Math.abs(x - 0.5) < 0.14 && Math.abs(y - 0.5) < 0.14) {
          return shade(col, 0.72);
        }
        const p = PRINT[o.print || 'none'](x, y, col, salt);
        const k = (1 - y * 0.10) * WEAVE[o.weave || 'cotton'](x, y, salt);
        return shade(p || col, k);
      }, c.ink);

      if (o.shape === 'cap' || o.shape === 'visor') {
        skin.mapRect(R.top, (u, v, cur, w, h) => {
          const y = (v + 0.5) / h;
          return (o.back ? y < 0.34 : y > 0.62) ? c.ink.lit(shade(col, 0.84), 'top') : null;
        });
      }
      if (o.brim) {
        skin.mapRect(R.top, () => c.ink.lit(shade(col, 1.06), 'top'));
        for (const face of ['front', 'back', 'right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => (
            Math.abs((v + 0.5) / h - band) < 0.055 ? c.ink.lit(trim, face) : null
          ));
        }
      }
      if (o.shape === 'horns') {
        for (const face of ['front', 'back', 'right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            return y < 0.24 && (x < 0.20 || x > 0.80)
              ? c.ink.lit(shade(col, 1 - y * 0.6), face) : null;
          });
        }
        skin.mapRect(R.top, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          return (x < 0.22 || x > 0.78) && y > 0.26 && y < 0.74 ? c.ink.lit(col, 'top') : null;
        });
      }
      if (o.shape === 'ears') {
        skin.mapRect(R.top, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (!((x < 0.32 || x > 0.68) && y > 0.18 && y < 0.62)) return null;
          const inner = (x > 0.10 && x < 0.24) || (x > 0.76 && x < 0.90);
          return c.ink.lit(inner ? shade(col, 1.3) : col, 'top');
        });
      }
      if (o.goggles) {
        skin.mapRect(R.front, (u, v, cur, w, h) => {
          const y = (v + 0.5) / h;
          return y > band && y < band + 0.14 ? c.ink.lit([54, 58, 66], 'front') : null;
        });
      }
    },
  };
}

export const HEADWEAR = [
  { id: 'none', name: 'None', layer: 'over', draw() {} },
  headwear('cap', 'Baseball cap', { shape: 'cap', band: 0.30, weave: 'cotton' }),
  headwear('capback', 'Cap, backwards', { shape: 'cap', band: 0.30, back: true }),
  headwear('capstripe', 'Panelled cap', { shape: 'cap', band: 0.30, print: 'stripes' }),
  headwear('visor', 'Visor', { shape: 'visor', band: 0.30, crown: false }),
  headwear('beanie', 'Beanie', { shape: 'beanie', band: 0.36, weave: 'knit', rim: true }),
  headwear('bobble', 'Bobble hat', { shape: 'beanie', band: 0.42, weave: 'knit', rim: true, button: true, print: 'fine' }),
  headwear('slouch', 'Slouchy beanie', { shape: 'beanie', band: 0.48, weave: 'cable' }),
  headwear('band', 'Headband', { shape: 'band', band: 0.34, crown: false }),
  headwear('sweatband', 'Sweatband', { shape: 'band', band: 0.32, crown: false, print: 'fine' }),
  headwear('bandana', 'Bandana', { shape: 'bandana', band: 0.28, print: 'checker' }),
  headwear('wrap', 'Head wrap', { shape: 'bandana', band: 0.40, weave: 'satin' }),
  headwear('hood', 'Hood', { shape: 'beanie', band: 0.46, weave: 'linen' }),
  headwear('tophat', 'Top hat', { shape: 'beanie', band: 0.46, brim: true, weave: 'satin' }),
  headwear('bowler', 'Bowler', { shape: 'beanie', band: 0.28, brim: true, weave: 'flat' }),
  headwear('fedora', 'Fedora', { shape: 'beanie', band: 0.32, brim: true, weave: 'linen', trim: '#3a2c1e' }),
  headwear('cowboy', 'Cowboy hat', { shape: 'beanie', band: 0.30, brim: true, weave: 'leather', trim: '#4a3520' }),
  headwear('straw', 'Straw hat', { shape: 'beanie', band: 0.26, brim: true, weave: 'linen', print: 'fine' }),
  headwear('beret', 'Beret', { shape: 'beanie', band: 0.24, weave: 'knit', button: true }),
  headwear('flatcap', 'Flat cap', { shape: 'cap', band: 0.26, weave: 'linen', print: 'checker' }),
  headwear('ushanka', 'Ushanka', { shape: 'beanie', band: 0.42, weave: 'fur', rim: true }),
  headwear('crown', 'Crown', { shape: 'crown', band: 0.26, crown: false, weave: 'metal' }),
  headwear('circlet', 'Circlet', { shape: 'band', band: 0.26, crown: false, weave: 'metal' }),
  headwear('helm', 'Helmet', { shape: 'beanie', band: 0.54, weave: 'metal', rim: true }),
  headwear('hardhat', 'Hard hat', { shape: 'beanie', band: 0.34, weave: 'flat', rim: true }),
  headwear('pilot', 'Flying cap', { shape: 'beanie', band: 0.52, weave: 'leather', goggles: true }),
  headwear('turban', 'Turban', { shape: 'bandana', band: 0.46, weave: 'satin', rim: true }),
  headwear('nursecap', 'Cap', { shape: 'beanie', band: 0.20, weave: 'linen' }),
  headwear('horns', 'Horns', { shape: 'horns', band: 0, crown: false }),
  headwear('ears', 'Animal ears', { shape: 'ears', band: 0, crown: false }),
];

// ===========================================================================
// gloves and footwear
// ===========================================================================

function gloves(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      for (const key of ['armR', 'armL']) {
        for (const face of FACES) {
          const cloth = panel(col, face, { ...o, hem: false }, c.ink, salt);
          skin.mapRect(c.parts[key].rects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h;
            if (face === 'top') return null;
            if (face === 'bottom') return c.ink.lit(o.open ? c.pal.skin : shade(col, 0.88), face);
            if (y < 1 - o.length) return null;
            if (o.open && y > 0.93) return null;
            let out = cloth(u, v, cur, w, h);
            if (y < 1 - o.length + 0.07) out = shade(out, 1.14);       // the cuff
            if (o.knuckles && Math.abs(y - 0.88) < 0.04) out = shade(out, 0.82);
            return out;
          });
        }
      }
    },
  };
}

export const GLOVES = [
  { id: 'none', name: 'Bare hands', draw() {} },
  gloves('gloves', 'Gloves', { length: 0.20, weave: 'leather' }),
  gloves('wool', 'Woolly gloves', { length: 0.22, weave: 'knit' }),
  gloves('fingerless', 'Fingerless', { length: 0.18, weave: 'leather', open: true }),
  gloves('driving', 'Driving gloves', { length: 0.20, weave: 'leather', knuckles: true, open: true }),
  gloves('mittens', 'Mittens', { length: 0.26, weave: 'knit', print: 'fine' }),
  gloves('long', 'Long gloves', { length: 0.44, weave: 'satin' }),
  gloves('opera', 'Opera gloves', { length: 0.62, weave: 'satin' }),
  gloves('gauntlets', 'Gauntlets', { length: 0.52, weave: 'metal', knuckles: true }),
  gloves('bracers', 'Bracers', { length: 0.40, weave: 'leather', print: 'panel' }),
  gloves('wraps', 'Hand wraps', { length: 0.16, weave: 'linen', open: true }),
  gloves('boxing', 'Boxing gloves', { length: 0.30, weave: 'leather', knuckles: true }),
  gloves('rubber', 'Washing-up gloves', { length: 0.38, weave: 'flat' }),
];

function footwear(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      const sole = o.sole ? mix(col, hexToRgb(o.sole), 0.8) : shade(col, 0.62);
      for (const key of ['legR', 'legL']) {
        for (const face of FACES) {
          const cloth = panel(col, face, { ...o, hem: false }, c.ink, salt);
          skin.mapRect(c.parts[key].rects[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            if (face === 'top') return null;
            if (face === 'bottom') return c.ink.lit(shade(sole, 0.92), face);
            if (y < 1 - o.height) return null;
            let out = cloth(u, v, cur, w, h);
            if (o.sole !== false && y > 0.93) out = sole;
            if (o.stripe && Math.abs(y - (1 - o.height + 0.07)) < 0.035) out = shade(col, 1.4);
            if (o.toe && face === 'front' && y > 0.86) out = shade(col, 1.18);
            if (o.laces && face === 'front' && Math.abs(x - 0.5) < 0.22
              && y > 1 - o.height + 0.04 && y < 0.88 && Math.floor(y * 22) % 2) {
              out = shade(col, 1.45);
            }
            if (o.cuff && y < 1 - o.height + 0.08) out = shade(out, 1.16);
            return out;
          });
        }
      }
    },
  };
}

export const FOOTWEAR = [
  { id: 'none', name: 'Barefoot', draw() {} },
  footwear('trainers', 'Trainers', { height: 0.22, sole: '#e8e4dc', stripe: true, laces: true, weave: 'cotton' }),
  footwear('runners', 'Running shoes', { height: 0.24, sole: '#dcdce4', print: 'sides', laces: true, weave: 'satin' }),
  footwear('hightops', 'High tops', { height: 0.36, sole: '#e8e4dc', laces: true, toe: true, weave: 'cotton' }),
  footwear('plimsolls', 'Plimsolls', { height: 0.20, sole: '#efece4', toe: true, weave: 'linen' }),
  footwear('boots', 'Boots', { height: 0.42, sole: '#2a2420', laces: true, weave: 'leather' }),
  footwear('work', 'Work boots', { height: 0.46, sole: '#33291f', laces: true, toe: true, weave: 'leather' }),
  footwear('tallboots', 'Tall boots', { height: 0.64, sole: '#2a2420', cuff: true, weave: 'leather' }),
  footwear('cowboyboots', 'Cowboy boots', { height: 0.58, sole: '#3a2c20', print: 'chevron', weave: 'leather' }),
  footwear('wellies', 'Wellies', { height: 0.58, sole: '#23262a', weave: 'flat' }),
  footwear('snow', 'Snow boots', { height: 0.52, sole: '#2c2c30', cuff: true, weave: 'fur' }),
  footwear('shoes', 'Dress shoes', { height: 0.18, sole: '#241f1c', weave: 'leather' }),
  footwear('brogues', 'Brogues', { height: 0.20, sole: '#2a221c', print: 'speckle', laces: true, weave: 'leather' }),
  footwear('loafers', 'Loafers', { height: 0.17, sole: '#241f1c', weave: 'leather' }),
  footwear('sandals', 'Sandals', { height: 0.10, sole: '#4a4038', weave: 'leather' }),
  footwear('flipflops', 'Flip-flops', { height: 0.07, sole: '#3c3c44', weave: 'flat' }),
  footwear('slippers', 'Slippers', { height: 0.16, sole: false, weave: 'fur' }),
  footwear('skates', 'Skates', { height: 0.42, sole: '#c8ccd4', laces: true, stripe: true, weave: 'leather' }),
  footwear('steel', 'Steel boots', { height: 0.34, sole: '#8e939c', weave: 'metal' }),
  footwear('socks', 'Socks', { height: 0.30, sole: false, weave: 'knit', print: 'hoops' }),
];

// ===========================================================================
// face items
// ===========================================================================

function faceItem(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    layer: o.over ? 'over' : 'base',
    draw(skin, c) {
      const col = o.useHair ? c.pal.hair : c.colour;
      const R = o.over ? c.parts.head.overRects : c.parts.head.rects;
      skin.mapRect(R.front, (u, v, cur, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        const on = o.mask(x, y, salt);
        if (!on) return o.over ? [0, 0, 0, 0] : null;
        const base = typeof on === 'object' ? on : col;
        const k = 1 - y * 0.08 + (jitter(u, v, salt) - 0.5) * (o.rough || 0.05);
        return c.ink.lit(shade(base, k), 'front');
      });
      if (o.sides) {
        for (const face of ['right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            const t = face === 'right' ? 1 - x : x;
            const on = o.sides(t, y, salt);
            if (!on) return o.over ? [0, 0, 0, 0] : null;
            const base = typeof on === 'object' ? on : col;
            return c.ink.lit(shade(base, 0.96 + (jitter(u, v, salt) - 0.5) * (o.rough || 0.05)), face);
          });
        }
      }
    },
  };
}

const EYE = [0.50, 0.66];      // the band the generator puts eyes in

export const FACE_ITEMS = [
  { id: 'none', name: 'None', draw() {} },
  faceItem('glasses', 'Glasses', {
    over: true,
    mask: (x, y) => (y > EYE[0] && y < EYE[1] && x > 0.06 && x < 0.94 && (x < 0.44 || x > 0.56))
      || (Math.abs(y - EYE[0]) < 0.03 && x > 0.06 && x < 0.94),
  }),
  faceItem('round', 'Round glasses', {
    over: true,
    mask: (x, y) => y > EYE[0] && y < EYE[1]
      && ((x > 0.12 && x < 0.34) || (x > 0.66 && x < 0.88) || (x > 0.44 && x < 0.56)),
  }),
  faceItem('square', 'Square glasses', {
    over: true,
    mask: (x, y) => {
      if (!(y > EYE[0] - 0.02 && y < EYE[1] + 0.02)) return false;
      const inA = x > 0.10 && x < 0.40, inB = x > 0.60 && x < 0.90;
      if (Math.abs(y - (EYE[0] - 0.02)) < 0.03 || Math.abs(y - (EYE[1] + 0.02)) < 0.03) {
        return inA || inB || (x > 0.44 && x < 0.56);
      }
      const edge = (a, b) => Math.abs(x - a) < 0.04 || Math.abs(x - b) < 0.04;
      return edge(0.10, 0.40) || edge(0.60, 0.90) || (x > 0.44 && x < 0.56);
    },
  }),
  faceItem('shades', 'Sunglasses', {
    over: true,
    mask: (x, y) => y > EYE[0] - 0.04 && y < EYE[1] && x > 0.06 && x < 0.94,
  }),
  faceItem('aviators', 'Aviators', {
    over: true,
    mask: (x, y) => (y > EYE[0] - 0.02 && y < EYE[1] + 0.04
      && ((x > 0.08 && x < 0.42) || (x > 0.58 && x < 0.92)))
      || (Math.abs(y - EYE[0]) < 0.03 && x > 0.42 && x < 0.58),
  }),
  faceItem('monocle', 'Monocle', {
    over: true,
    mask: (x, y) => y > EYE[0] && y < EYE[1] && x > 0.60 && x < 0.86,
  }),
  faceItem('eyepatch', 'Eyepatch', {
    over: true,
    mask: (x, y) => (y > EYE[0] - 0.06 && y < EYE[1] + 0.04 && x > 0.58 && x < 0.86)
      || (Math.abs(y - (EYE[0] - 0.11)) < 0.04 && x > 0.10),
  }),
  faceItem('goggles', 'Goggles', {
    over: true,
    mask: (x, y) => (y > EYE[0] - 0.05 && y < EYE[1] + 0.03 && x > 0.05 && x < 0.95)
      ? ((x > 0.14 && x < 0.38) || (x > 0.62 && x < 0.86) ? [128, 176, 196] : [58, 52, 46])
      : false,
  }),
  faceItem('visorface', 'Visor', {
    over: true,
    mask: (x, y) => (y > EYE[0] - 0.06 && y < EYE[1] + 0.02 && x > 0.04 && x < 0.96)
      ? [70, 84, 104] : false,
  }),
  faceItem('mask', 'Face mask', {
    over: true,
    mask: (x, y) => y > 0.68 && x > 0.08 && x < 0.92,
  }),
  faceItem('facescarf', 'Scarf over the face', {
    over: true,
    mask: (x, y) => y > 0.74 && x > 0.04 && x < 0.96,
    sides: (t, y) => y > 0.74,
  }),
  faceItem('stubble', 'Stubble', {
    useHair: true,
    rough: 0.16,
    mask: (x, y, s) => y > 0.72 && x > 0.12 && x < 0.88
      && jitter(Math.round(x * 30), Math.round(y * 30), s) > 0.42,
    sides: (t, y, s) => y > 0.72 && t < 0.5
      && jitter(Math.round(t * 30), Math.round(y * 30), s) > 0.5,
  }),
  faceItem('moustache', 'Moustache', {
    useHair: true,
    mask: (x, y) => y > 0.72 && y < 0.80 && x > 0.26 && x < 0.74,
  }),
  faceItem('handlebar', 'Handlebar moustache', {
    useHair: true,
    mask: (x, y) => (y > 0.72 && y < 0.79 && x > 0.20 && x < 0.80)
      || (y > 0.66 && y < 0.74 && (x < 0.26 || x > 0.74) && x > 0.14 && x < 0.86),
  }),
  faceItem('goatee', 'Goatee', {
    useHair: true,
    mask: (x, y) => (y > 0.72 && y < 0.79 && x > 0.30 && x < 0.70)
      || (y > 0.84 && x > 0.36 && x < 0.64),
  }),
  faceItem('beard', 'Beard', {
    useHair: true,
    rough: 0.10,
    mask: (x, y) => y > 0.72 && x > 0.10 && x < 0.90,
    sides: (t, y) => y > 0.70 && t < 0.55,
  }),
  faceItem('fullbeard', 'Full beard', {
    useHair: true,
    rough: 0.12,
    mask: (x, y) => y > 0.64 && x > 0.06 && x < 0.94,
    sides: (t, y) => y > 0.60 && t < 0.7,
  }),
  faceItem('longbeard', 'Long beard', {
    useHair: true,
    rough: 0.14,
    mask: (x, y) => y > 0.60 && x > 0.08 && x < 0.92,
    sides: (t, y) => y > 0.58 && t < 0.8,
  }),
  faceItem('sideburns', 'Sideburns', {
    useHair: true,
    mask: (x, y) => y > 0.52 && y < 0.78 && (x < 0.12 || x > 0.88),
    sides: (t, y) => y > 0.52 && y < 0.78 && t < 0.3,
  }),
  faceItem('freckles', 'Freckles', {
    mask: (x, y, s) => (y > 0.60 && y < 0.78 && (x < 0.38 || x > 0.62)
      && jitter(Math.round(x * 26), Math.round(y * 26), s) > 0.70) ? [176, 122, 84] : false,
  }),
  faceItem('blush', 'Blush', {
    mask: (x, y) => (y > 0.64 && y < 0.78 && (x < 0.26 || x > 0.74)) ? [214, 132, 122] : false,
  }),
  faceItem('lipstick', 'Lipstick', {
    mask: (x, y) => (y > 0.74 && y < 0.82 && x > 0.32 && x < 0.68) ? [186, 62, 70] : false,
  }),
  faceItem('eyeliner', 'Eyeliner', {
    mask: (x, y) => (Math.abs(y - (EYE[0] - 0.015)) < 0.025 && x > 0.10 && x < 0.90)
      ? [36, 32, 34] : false,
  }),
  faceItem('eyeshadow', 'Eye shadow', {
    mask: (x, y) => (y > EYE[0] - 0.09 && y < EYE[0] - 0.01 && x > 0.10 && x < 0.90)
      ? [124, 96, 150] : false,
  }),
  faceItem('warpaint', 'War paint', {
    mask: (x, y) => (Math.abs(y - 0.58) < 0.05 && x > 0.06 && x < 0.94) ? [190, 60, 54] : false,
  }),
  faceItem('facepaint', 'Face paint', {
    mask: (x, y) => {
      if (Math.abs(y - EYE[0] - 0.02) < 0.08 && (x < 0.34 || x > 0.66)) return [40, 40, 46];
      if (y > 0.74 && y < 0.82 && x > 0.28 && x < 0.72) return [190, 52, 58];
      return false;
    },
  }),
  faceItem('scar', 'Scar', {
    mask: (x, y) => (x > 0.70 && x < 0.78 && y > 0.42 && y < 0.72) ? [186, 128, 108] : false,
  }),
  faceItem('bindi', 'Bindi', {
    mask: (x, y) => (Math.abs(x - 0.5) < 0.05 && Math.abs(y - 0.40) < 0.04) ? [178, 44, 60] : false,
  }),
  faceItem('nosering', 'Nose ring', {
    over: true,
    mask: (x, y) => (Math.abs(x - 0.62) < 0.04 && Math.abs(y - 0.70) < 0.03) ? [214, 190, 122] : false,
  }),
  faceItem('earrings', 'Earrings', {
    over: true,
    mask: () => false,
    sides: (t, y) => (y > 0.58 && y < 0.66 && t > 0.40 && t < 0.54) ? [222, 198, 128] : false,
  }),
];

// ===========================================================================
// back items
// ===========================================================================

function backItem(id, name, o) {
  const salt = saltOf(id);
  return {
    id,
    name,
    layer: 'over',
    draw(skin, c) {
      const col = c.colour;
      const R = c.parts.body.overRects;
      skin.mapRect(R.back, (u, v, cur, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        const on = o.back(x, y, salt);
        if (!on) return null;
        const base = typeof on === 'object' ? on : col;
        const k = (1 - y * 0.10) * WEAVE[o.weave || 'cotton'](x, y, salt);
        return c.ink.lit(shade(base, k), 'back');
      });
      if (o.straps) {
        skin.mapRect(R.front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (y > 0.66) return null;
          return Math.abs(x - 0.26) < 0.075 || Math.abs(x - 0.74) < 0.075
            ? c.ink.lit(shade(col, 0.88), 'front') : null;
        });
      }
      if (o.sash) {
        skin.mapRect(R.front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          return Math.abs((x * 0.9 + y * 0.8) - 0.72) < 0.10
            ? c.ink.lit(shade(col, 0.9), 'front') : null;
        });
      }
      if (o.sides) {
        for (const face of ['right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => (
            o.sides((u + 0.5) / w, (v + 0.5) / h) ? c.ink.lit(shade(col, 0.9), face) : null
          ));
        }
      }
    },
  };
}

export const BACK_ITEMS = [
  { id: 'none', name: 'None', layer: 'over', draw() {} },
  backItem('backpack', 'Backpack', {
    weave: 'cotton',
    straps: true,
    back: (x, y) => (x > 0.14 && x < 0.86 && y > 0.08 && y < 0.84)
      ? (y > 0.40 && y < 0.62 && x > 0.28 && x < 0.72 ? [0, 0, 0] : true) : false,
    sides: (x, y) => y > 0.08 && y < 0.84 && x > 0.28,
  }),
  backItem('rucksack', 'Rucksack', {
    weave: 'linen',
    straps: true,
    back: (x, y) => x > 0.18 && x < 0.82 && y > 0.04 && y < 0.72,
    sides: (x, y) => y > 0.04 && y < 0.72 && x > 0.34,
  }),
  backItem('satchel', 'Satchel', {
    weave: 'leather',
    sash: true,
    back: (x, y) => x > 0.20 && x < 0.80 && y > 0.34 && y < 0.80,
  }),
  backItem('quiver', 'Quiver', {
    weave: 'leather',
    sash: true,
    back: (x, y) => (x > 0.54 && x < 0.78 && y > 0.04 && y < 0.74)
      ? (y < 0.16 ? [86, 68, 44] : true) : false,
  }),
  backItem('scabbard', 'Sword on the back', {
    weave: 'leather',
    sash: true,
    back: (x, y) => {
      if (Math.abs(x - 0.5) < 0.06 && y > 0.10 && y < 0.86) return true;
      if (Math.abs(x - 0.5) < 0.20 && Math.abs(y - 0.12) < 0.04) return [176, 176, 184];
      return false;
    },
  }),
  backItem('wings', 'Wings', {
    weave: 'fur',
    back: (x, y) => (x < 0.36 || x > 0.64) && y > 0.04 && y < 0.72
      && Math.abs(x - 0.5) * 2 > y * 0.5,
  }),
  backItem('elytra', 'Elytra', {
    weave: 'scale',
    back: (x, y) => y > 0.04 && y < 0.88 && Math.abs(x - 0.5) > 0.07,
  }),
  backItem('cape', 'Cape', {
    weave: 'satin',
    back: (x, y) => y > 0.02,
    sides: (x) => x > 0.5,
  }),
  backItem('shell', 'Shell', {
    weave: 'scale',
    back: (x, y) => Math.hypot((x - 0.5) * 1.35, y - 0.5) < 0.44,
    sides: (x, y) => y > 0.18 && y < 0.82 && x > 0.42,
  }),
  backItem('jetpack', 'Jetpack', {
    weave: 'metal',
    straps: true,
    back: (x, y) => (Math.abs(x - 0.32) < 0.13 || Math.abs(x - 0.68) < 0.13)
      && y > 0.04 && y < 0.80,
  }),
  backItem('airtank', 'Air tank', {
    weave: 'metal',
    straps: true,
    back: (x, y) => Math.abs(x - 0.5) < 0.20 && y > 0.06 && y < 0.78,
  }),
  backItem('drum', 'Drum', {
    weave: 'leather',
    sash: true,
    back: (x, y) => Math.hypot((x - 0.5) * 1.2, (y - 0.55) * 1.1) < 0.34,
  }),
  backItem('guitar', 'Guitar', {
    weave: 'satin',
    sash: true,
    back: (x, y) => (Math.abs(x - 0.5) < 0.06 && y > 0.04 && y < 0.5)
      || Math.hypot((x - 0.5) * 1.3, (y - 0.68) * 1.5) < 0.30,
  }),
  backItem('shield', 'Shield', {
    weave: 'metal',
    back: (x, y) => y > 0.14 && y < 0.86
      && Math.abs(x - 0.5) < 0.34 * (1 - Math.max(0, y - 0.6) * 1.4),
  }),
  backItem('scarftails', 'Scarf tails', {
    weave: 'knit',
    back: (x, y) => Math.abs(x - 0.5) < 0.16 && y > 0.02 && y < 0.74,
  }),
  backItem('bow', 'Bow', {
    weave: 'satin',
    back: (x, y) => (Math.abs(x - 0.5) < 0.30 && Math.abs(y - 0.22) < 0.12
      && Math.abs(x - 0.5) > 0.06) || (Math.abs(x - 0.5) < 0.08 && y > 0.22 && y < 0.60),
  }),
];

// ===========================================================================
// the wardrobe itself
// ===========================================================================
//
// ORDER MATTERS and it is the order a person dresses in. Tops before
// outerwear, hair before hats, and the face last so a beard is not painted
// over by a collar. Anything that draws on the outer layer draws after
// everything that draws on the skin underneath it.

// ===========================================================================
// effects — the skin set on fire
// ===========================================================================
//
// The "alive" skins you see in Minecraft — arms wreathed in flame, frost
// crawling up the legs — are not a third layer, because the format has no
// third layer: they are the OVERLAY, used as air. The overlay floats half a
// texel off the body, so a jagged tongue of orange painted on it with
// transparency around it reads as fire licking the limb, not as a sleeve.
//
// So effects are ordinary items with three deliberate differences. They are
// a LIST, not a slot — flaming arms AND frosted legs is a fair thing to want,
// which is the "more extra layers" idea: any number of them stack in the
// editor and flatten into the one overlay the PNG has, so the file stays a
// plain Minecraft skin. They draw LAST, over the jacket, because fire is on
// top of everything. And they take a TICK: drawn again with a different tick
// the tongues move, which is what lets the dressing room show the fire
// burning — every exported frame is still one static, compatible PNG.
//
// Nothing here writes a transparent texel. A flame paints only where the
// flame is, so whatever it burns over — a sleeve, bare skin — survives
// underneath and around it.

const FIRE_RAMP = ['#fff6c8', '#ffd94e', '#ff9422', '#e8501c', '#9c2412']
  .map(hexToRgb);
const FROST_RAMP = ['#ffffff', '#d8f2fe', '#9adcf8', '#58b0e4', '#2f74b0']
  .map(hexToRgb);

// Tongues of flame up a box part, from the far end toward the near.
// `fromBottom` true burns up from the wrist or ankle; false burns down from
// the shoulder line (used for the body's collar of fire).
function blaze(skin, part, ramp, salt, tick, o = {}) {
  const height = o.height ?? 0.55;      // how far up the limb the fire reaches
  const vary = o.vary ?? 0.35;          // how ragged the tongues are
  const seed = salt * 31 + (tick % 8) * 977;
  for (const face of ['right', 'front', 'left', 'back']) {
    const r = part.overRects[face];
    const [, , w, h] = r;
    skin.mapRect(r, (u, v, cur) => {
      // distance from the burning end, 0..1 up the limb
      const d = (h - 1 - v + 0.5) / h;
      const tongue = height * (1 - vary + jitter(u, face.length, seed) * 2 * vary);
      if (d > tongue) return cur;
      // hottest at the source, dark red at the tips, and the tip texel of
      // every tongue flickers a step hotter so the edge sparkles
      let k = Math.min(ramp.length - 1, Math.floor((d / tongue) * ramp.length));
      if (d > tongue * 0.8 && jitter(u, v, seed + 7) < 0.3) k = 1;
      // holes in the body of the fire, so it reads as flame and not as paint
      if (k >= 2 && jitter(u, v, seed + 13) < 0.16) return cur;
      return [...ramp[k].slice(0, 3), 255];
    });
  }
  // the underside — the palm of the fire — burns solid hot
  const b = part.overRects.bottom;
  if (b) skin.fillRect(b, [...FIRE_RAMP[0].slice(0, 3), 255]);
}

// Frost is fire's opposite in more than colour: it CLIMBS from the same end
// but in crystals, not tongues — hard-edged steps rather than ragged licks.
function rime(skin, part, salt, tick) {
  const seed = salt * 53 + (tick % 8) * 631;
  for (const face of ['right', 'front', 'left', 'back']) {
    const r = part.overRects[face];
    const [, , w, h] = r;
    skin.mapRect(r, (u, v, cur) => {
      const d = (h - 1 - v + 0.5) / h;
      // stepped, so the edge is crystalline: each column's reach snaps to
      // quarters of the limb
      const reach = (1 + Math.floor(jitter(u, face.length, seed) * 3)) * 0.16;
      if (d > reach) return cur;
      const k = Math.min(FROST_RAMP.length - 1,
        Math.floor((d / reach) * FROST_RAMP.length));
      if (k >= 3 && jitter(u, v, seed + 5) < 0.2) return cur;
      return [...FROST_RAMP[k].slice(0, 3), 255];
    });
  }
  const b = part.overRects.bottom;
  if (b) skin.fillRect(b, [...FROST_RAMP[1].slice(0, 3), 255]);
}

export const EFFECTS = [
  { id: 'flamearms', name: 'Arms aflame',
    draw(skin, c) {
      blaze(skin, c.parts.armR, FIRE_RAMP, 1, c.tick ?? 0);
      blaze(skin, c.parts.armL, FIRE_RAMP, 2, c.tick ?? 0);
    } },
  { id: 'flamelegs', name: 'Legs aflame',
    draw(skin, c) {
      blaze(skin, c.parts.legR, FIRE_RAMP, 3, c.tick ?? 0, { height: 0.6 });
      blaze(skin, c.parts.legL, FIRE_RAMP, 4, c.tick ?? 0, { height: 0.6 });
    } },
  { id: 'frostarms', name: 'Frosted arms',
    draw(skin, c) {
      rime(skin, c.parts.armR, 5, c.tick ?? 0);
      rime(skin, c.parts.armL, 6, c.tick ?? 0);
    } },
  { id: 'frostlegs', name: 'Frosted legs',
    draw(skin, c) {
      rime(skin, c.parts.legR, 7, c.tick ?? 0);
      rime(skin, c.parts.legL, 8, c.tick ?? 0);
    } },
  // Embers: the body smoulders — sparse glowing coals over the torso, dense
  // at the waist and thinning upward, the way a burnt thing cools.
  { id: 'embers', name: 'Smouldering',
    draw(skin, c) {
      const seed = 11 * 31 + ((c.tick ?? 0) % 8) * 977;
      for (const face of ['front', 'back', 'right', 'left']) {
        const r = c.parts.body.overRects[face];
        const [, , , h] = r;
        skin.mapRect(r, (u, v, cur) => {
          const d = (v + 0.5) / h;                     // 0 collar, 1 waist
          const glow = jitter(u, v, seed);
          if (glow > 0.10 + d * 0.16) return cur;
          const k = glow < 0.05 ? 1 : glow < 0.09 ? 2 : 3;
          return [...FIRE_RAMP[k].slice(0, 3), 255];
        });
      }
    } },
  // Lightning: two or three white-cored bolts crawling down each arm. The
  // bolt is a walk — one texel a row, jinking by jitter — which is what a
  // spark actually looks like at this resolution.
  { id: 'sparks', name: 'Crackling',
    draw(skin, c) {
      const tick = c.tick ?? 0;
      const CORE = hexToRgb('#ffffff');
      const EDGE = hexToRgb('#6ad4f8');
      for (const [part, salt] of [[c.parts.armR, 21], [c.parts.armL, 22]]) {
        for (const face of ['front', 'back', 'right', 'left']) {
          const r = part.overRects[face];
          const [, , w, h] = r;
          const seed = salt * 97 + face.length * 7 + (tick % 8) * 389;
          let x = Math.floor(jitter(0, 0, seed) * w);
          const px = [];
          for (let v = 0; v < h; v++) {
            x += Math.floor(jitter(1, v, seed) * 3) - 1;
            x = ((x % w) + w) % w;
            px.push(x);
          }
          skin.mapRect(r, (u, v, cur) => {
            if (u === px[v]) return [...CORE.slice(0, 3), 255];
            if (Math.abs(u - px[v]) === 1 && jitter(u, v, seed + 3) < 0.5) {
              return [...EDGE.slice(0, 3), 255];
            }
            return cur;
          });
        }
      }
    } },
];

// The list an effect id is looked up in — dressUp skips the whole category
// (see applyEffects), so this is the one door they are drawn through.
export function applyEffects(skin, wear, ctx, tick = 0) {
  const list = (wear || {}).effects;
  if (!Array.isArray(list)) return;
  for (const id of list) {
    const it = EFFECTS.find((x) => x.id === id);
    it?.draw?.(skin, { ...ctx, tick });
  }
}

export const CATEGORIES = [
  { key: 'hair', name: 'Hair', items: HAIR, colour: 'hair', shows: 'head' },
  { key: 'top', name: 'Tops', items: TOPS, colour: 'shirt', shows: 'torso' },
  { key: 'bottom', name: 'Bottoms', items: BOTTOMS, colour: 'trousers', shows: 'legs' },
  { key: 'outer', name: 'Outerwear', items: OUTERWEAR, colour: 'outer', shows: 'torso' },
  { key: 'headwear', name: 'Headwear', items: HEADWEAR, colour: 'headwear', shows: 'head' },
  { key: 'gloves', name: 'Gloves', items: GLOVES, colour: 'gloves', shows: 'hands' },
  { key: 'footwear', name: 'Footwear', items: FOOTWEAR, colour: 'shoes', shows: 'legs' },
  { key: 'face', name: 'Face Items', items: FACE_ITEMS, colour: 'face', shows: 'head' },
  { key: 'back', name: 'Back Items', items: BACK_ITEMS, colour: 'back', shows: 'back' },
  // A LIST, not a slot — see the effects block above. `multi` is what tells
  // the racks to toggle rather than choose, and dressUp to leave the whole
  // category to applyEffects.
  { key: 'effects', name: 'Effects', items: EFFECTS, colour: 'effects',
    shows: 'all', multi: true },
];

/** Sensible starting colours for the categories the photograph cannot answer. */
export const EXTRA_COLOURS = {
  outer: '#3a4152',
  headwear: '#8a3f34',
  gloves: '#4a3a2c',
  face: '#2c2c30',
  back: '#4a4034',
};

export const DEFAULT_WEAR = {
  effects: [],
  hair: 'auto',
  top: 'auto',
  bottom: 'auto',
  outer: 'none',
  headwear: 'none',
  gloves: 'none',
  footwear: 'auto',
  face: 'none',
  back: 'none',
};

// ---- READY-MADE PEOPLE -------------------------------------------------------
//
// The wardrobe is a set of parts and it makes anybody, which is the right way
// round and a poor way to START: a room full of drawers and no examples is a
// room you close again. These are finished people, built out of the same
// drawers — pick one and it dresses you head to foot, and then every drawer
// is still there to change your mind with.
//
// Nothing here is a new drawing. Each is a `wear` (one item per category) and
// the colours to paint them, so the whole gallery costs a table and adding
// another is four lines.
export const OUTFITS = [
  // Every outfit names EVERY slot and every colour, deliberately. The first
  // draft named only what it cared about, and the rest leaked in from
  // whatever you were wearing before — pick the zombie and then the angel and
  // the angel had a green face. A finished person is finished: nothing about
  // them is left to chance, and switching between them is switching whole.
  //
  // Each of these is designed to be READ AT A GLANCE, off a 64-pixel
  // thumbnail: one silhouette and two or three colour masses that say who it
  // is before the name does. So every outfit picks a dominant colour, a
  // support and one accent, keeps a value step between shirt, outer and
  // trousers so the body reads as layers, and the humans get skins from
  // across the whole range rather than one default tan — a gallery of one
  // complexion is a palette mistake wearing thirty costumes.

  { id: 'angel', name: 'Angel',
    wear: { hair: 'longwave', top: 'robe', bottom: 'longskirt', outer: 'none',
      headwear: 'circlet', gloves: 'none', footwear: 'sandals',
      face: 'none', back: 'wings' },
    colours: { skin: '#f2d6b8', hair: '#f0dfa8', shirt: '#fdfcf7',
      trousers: '#efeadd', headwear: '#f2cf5e', shoes: '#dcd2ba',
      back: '#ffffff' } },

  // RED, head to foot. A demon in a dark coat is a man having a bad day; a
  // demon is red the way a zombie is green — the flesh is the costume. The
  // horns stay bone so they read against the red instead of sinking into it.
  { id: 'demon', name: 'Demon',
    wear: { hair: 'spiky', top: 'tank', bottom: 'ripped', outer: 'cloak',
      headwear: 'horns', gloves: 'none', footwear: 'none',
      face: 'goatee', back: 'none' },
    colours: { skin: '#a83226', hair: '#1c0e0c', shirt: '#2a1214',
      trousers: '#361418', outer: '#4a1216', headwear: '#efe6d2',
      face: '#1c0e0c' } },

  // Gold where the angel is white — the cloak and the crown are what stop
  // two white-robed blonds being the same thumbnail twice.
  { id: 'god', name: 'God',
    wear: { hair: 'longwave', top: 'robe', bottom: 'longskirt',
      outer: 'cloak', headwear: 'crown', gloves: 'none',
      footwear: 'sandals', face: 'longbeard', back: 'cape' },
    colours: { skin: '#e0c09e', hair: '#efede4', shirt: '#faf8f0',
      trousers: '#f2efe4', outer: '#e8c65e', headwear: '#f6dc7c',
      shoes: '#d6ccb2', face: '#efede4', back: '#f6f3e8' } },

  // The burgundy waistcoat is the accent that stops a second navy suit
  // reading as a second policeman across the room.
  { id: 'business', name: 'Business',
    wear: { hair: 'sidepart', top: 'oxford', bottom: 'suit',
      outer: 'waistcoat', headwear: 'none', gloves: 'none',
      footwear: 'brogues', face: 'square', back: 'none' },
    colours: { skin: '#8d5c34', hair: '#1e1812', shirt: '#f4f6f9',
      trousers: '#232836', outer: '#45222c', shoes: '#2e1a12',
      face: '#1c1c22' } },

  // Driving gloves, because a man in his line of work leaves no prints. The
  // trench sits a full shade lighter than the pinstripe so the coat reads as
  // a coat and not as more suit.
  { id: 'gangster', name: 'Gangster',
    wear: { hair: 'combover', top: 'shirt', bottom: 'pinstripe',
      outer: 'trench', headwear: 'fedora', gloves: 'driving',
      footwear: 'brogues', face: 'moustache', back: 'none' },
    colours: { skin: '#d9a77b', hair: '#241c14', shirt: '#ece5d4',
      trousers: '#262630', outer: '#4a4238', headwear: '#211c17',
      gloves: '#2e2018', shoes: '#1e1610', face: '#241c14' } },

  // The scrubs are a proper teal, not a pale one: the first draft was
  // nearly white and vanished into the angel and the bride-in-waiting at
  // thumbnail size. The cap stays white — that is the one white she keeps.
  { id: 'nurse', name: 'Nurse',
    wear: { hair: 'bun', top: 'tunic', bottom: 'trousers', outer: 'none',
      headwear: 'nursecap', gloves: 'none', footwear: 'plimsolls',
      face: 'none', back: 'none' },
    colours: { skin: '#b5794e', hair: '#3a2a1c', shirt: '#7fb8be',
      trousers: '#689fa8', headwear: '#ffffff', shoes: '#f2f2ef' } },

  // Silver wire-rims, deliberately: dark frames on dark skin disappear, and
  // a doctor with no glasses is just a man in a nice coat.
  { id: 'doctor', name: 'Doctor',
    wear: { hair: 'crop', top: 'oxford', bottom: 'chinos', outer: 'labcoat',
      headwear: 'none', gloves: 'none', footwear: 'shoes',
      face: 'glasses', back: 'none' },
    colours: { skin: '#6f452a', hair: '#181209', shirt: '#b8d0e8',
      trousers: '#333c4c', outer: '#f8f9fa', shoes: '#26201a',
      face: '#d5dade' } },

  { id: 'fireman', name: 'Fire crew',
    wear: { hair: 'buzz', top: 'work', bottom: 'combat', outer: 'hivis',
      headwear: 'helm', gloves: 'gauntlets', footwear: 'steel',
      face: 'none', back: 'airtank' },
    colours: { skin: '#e2b088', hair: '#2a2018', shirt: '#3a3f46',
      trousers: '#2c3138', outer: '#e8b71e', headwear: '#c8402c',
      gloves: '#3a3028', shoes: '#221d19', back: '#c2c6cc' } },

  // Navy, cap, shades. The shirt is a step lighter than the gilet so the
  // vest reads as armour over cloth rather than one slab of dark.
  { id: 'cop', name: 'Police',
    wear: { hair: 'crew', top: 'shirt', bottom: 'trousers', outer: 'gilet',
      headwear: 'cap', gloves: 'none', footwear: 'boots',
      face: 'shades', back: 'none' },
    colours: { skin: '#c99e76', hair: '#241e16', shirt: '#46587c',
      trousers: '#202632', outer: '#181f2c', headwear: '#181f2c',
      shoes: '#1a1612', face: '#141418' } },

  // Cream roll-neck, rust cardigan, deep teal skirt: three values and a
  // warm-against-cool pair, where the first draft was three browns that
  // read as one tweedy smudge.
  { id: 'teacher', name: 'Teacher',
    wear: { hair: 'lob', top: 'roll', bottom: 'longskirt',
      outer: 'cardigan', headwear: 'none', gloves: 'none',
      footwear: 'loafers', face: 'round', back: 'satchel' },
    colours: { skin: '#a06a42', hair: '#6a4526', shirt: '#e8dfc8',
      trousers: '#2e4a4a', outer: '#9c5230', shoes: '#4a2e1c',
      face: '#4a3424', back: '#8a5c34' } },

  // Space buns and a loud tee under the coat — the doctor wears the
  // uniform, the scientist wears whatever was clean. The blue rubber
  // gloves are the tell at a distance.
  { id: 'scientist', name: 'Scientist',
    wear: { hair: 'spacebuns', top: 'tee', bottom: 'chinos',
      outer: 'labcoat', headwear: 'none', gloves: 'rubber',
      footwear: 'shoes', face: 'goggles', back: 'none' },
    colours: { skin: '#e8c29c', hair: '#2e2018', shirt: '#c2452e',
      trousers: '#565e6a', outer: '#f5f7f8', gloves: '#a8d2e0',
      shoes: '#28221c', face: '#2e5a68' } },

  // The white dress and the platinum wave, which is the picture everybody
  // has of her. Built out of the same drawers as everything else here —
  // the red lips are the accent doing all the work against the white.
  { id: 'marilyn', name: 'Marilyn',
    wear: { hair: 'bobwave', top: 'scoop', bottom: 'longskirt',
      outer: 'none', headwear: 'none', gloves: 'none', footwear: 'shoes',
      face: 'lipstick', back: 'none' },
    colours: { skin: '#f2d0b0', hair: '#f2e4b0', shirt: '#faf8f2',
      trousers: '#f4f1e8', shoes: '#eae6da', face: '#cc2040' } },

  // Not a portrait of a real man — a lab coat, a shock of white hair and a
  // walrus moustache, which is the cartoon everybody draws.
  { id: 'einstein', name: 'Professor',
    wear: { hair: 'messy', top: 'roll', bottom: 'trousers',
      outer: 'labcoat', headwear: 'none', gloves: 'none',
      footwear: 'shoes', face: 'handlebar', back: 'none' },
    colours: { skin: '#dcb28e', hair: '#f4f3ee', shirt: '#7a7f6c',
      trousers: '#46423c', outer: '#f4f4f1', shoes: '#2c241e',
      face: '#eceae2' } },

  // Steel in three values — bright plate, mid mail, dark sabatons — so the
  // armour reads as pieces and not as one grey man. The cape is the accent.
  { id: 'knight', name: 'Knight',
    wear: { hair: 'short', top: 'mail', bottom: 'greaves',
      outer: 'breastplate', headwear: 'helm', gloves: 'gauntlets',
      footwear: 'steel', face: 'none', back: 'cape' },
    colours: { skin: '#d8a87c', hair: '#38281c', shirt: '#7e8692',
      trousers: '#6e7680', outer: '#b4bcc6', headwear: '#a6aeb8',
      gloves: '#6e7680', shoes: '#50565e', back: '#a02a24' } },

  { id: 'wizard', name: 'Wizard',
    wear: { hair: 'long', top: 'robe', bottom: 'longskirt', outer: 'wizard',
      headwear: 'none', gloves: 'none', footwear: 'boots',
      face: 'longbeard', back: 'none' },
    colours: { skin: '#cfa27a', hair: '#e6e4da', shirt: '#3a2f6e',
      trousers: '#2c2456', outer: '#4c3f8a', shoes: '#2c2218',
      face: '#e6e4da' } },

  // --- the rest of the world ------------------------------------------------
  //
  // Every one of these earned its place the same way: name the one thing
  // that says who it is — the eyepatch, the gold visor, the horns, the
  // toque — and check the drawers already hold it. None of them cost a new
  // drawing; each is the four lines the comment above promised.

  // The eyepatch and the red bandana are the whole read; the breton does
  // the sailing. The earrings lost the face slot to the eyepatch, which is
  // the right trade — one eye says pirate, two hoops say market stall.
  { id: 'pirate', name: 'Pirate',
    wear: { hair: 'long', top: 'breton', bottom: 'trousers', outer: 'none',
      headwear: 'bandana', gloves: 'none', footwear: 'tallboots',
      face: 'eyepatch', back: 'scabbard' },
    colours: { skin: '#b98a5c', hair: '#241a12', shirt: '#e6dfd0',
      trousers: '#262c3a', headwear: '#b02a26', shoes: '#2c2014',
      face: '#16120e', back: '#4a3826' } },

  // Bone horns, red beard, shield on the back. The horns are the same item
  // the demon wears and the beard is what keeps the two apart — that, and
  // the demon being red. Historians are asked to look away.
  { id: 'viking', name: 'Viking',
    wear: { hair: 'long', top: 'tunic', bottom: 'combat', outer: 'gilet',
      headwear: 'horns', gloves: 'bracers', footwear: 'boots',
      face: 'fullbeard', back: 'shield' },
    colours: { skin: '#e8c4a0', hair: '#b5652c', shirt: '#6a5638',
      trousers: '#4a3a28', outer: '#7a6448', headwear: '#ded2b8',
      gloves: '#5a4228', shoes: '#3a2a1a', face: '#a5581f',
      back: '#8a3a22' } },

  // A white top hat is the nearest thing the drawer has to a toque, and at
  // sixty-four pixels it IS one. The red neckerchief and the black trousers
  // are what keep his whites out of the nurse's ward.
  { id: 'chef', name: 'Chef',
    wear: { hair: 'crop', top: 'work', bottom: 'trousers', outer: 'scarf',
      headwear: 'tophat', gloves: 'none', footwear: 'shoes',
      face: 'moustache', back: 'none' },
    colours: { skin: '#e2b088', hair: '#3a2a1e', shirt: '#f4f4f0',
      trousers: '#26262a', outer: '#b02a26', headwear: '#fafaf6',
      shoes: '#1e1a16', face: '#3a2a1e' } },

  // Black on black on black, with the mask a shade lighter than the hood so
  // the head reads as two pieces and the eye slit stays an eye slit. The
  // red hand-wraps are the one colour allowed in, and the socks are tabi.
  { id: 'ninja', name: 'Ninja',
    wear: { hair: 'none', top: 'longtee', bottom: 'joggers', outer: 'none',
      headwear: 'hood', gloves: 'wraps', footwear: 'socks',
      face: 'facescarf', back: 'scabbard' },
    colours: { skin: '#caa078', shirt: '#1e2026', trousers: '#171920',
      headwear: '#191b21', gloves: '#7a2028', shoes: '#14161c',
      face: '#262830', back: '#30323a' } },

  // The puffer is the pressure suit and the gold visor is the whole read —
  // it is also what keeps yet another white outfit from being the angel's
  // or the chef's at thumbnail size. Nobody sees the face behind gold.
  { id: 'astronaut', name: 'Astronaut',
    wear: { hair: 'none', top: 'track', bottom: 'track', outer: 'puffer',
      headwear: 'helm', gloves: 'gloves', footwear: 'boots',
      face: 'visorface', back: 'airtank' },
    colours: { skin: '#8a5a38', shirt: '#e8eaee', trousers: '#dfe2e8',
      outer: '#f2f4f6', headwear: '#eceef2', gloves: '#dfe2e8',
      shoes: '#9aa2ac', face: '#e8b93c', back: '#c2c6cc' } },

  // Gold collar, white kilt, lapis headcloth, kohl round the eyes — four
  // colours the whole civilisation agreed on, so they are the four here.
  // The eyeliner is kohl-black on bronze, where it actually shows.
  { id: 'pharaoh', name: 'Pharaoh',
    wear: { hair: 'none', top: 'tank', bottom: 'kilt', outer: 'none',
      headwear: 'wrap', gloves: 'bracers', footwear: 'sandals',
      face: 'eyeliner', back: 'none' },
    colours: { skin: '#b0763f', shirt: '#e0aa38', trousers: '#f2ecda',
      headwear: '#2a4a9c', gloves: '#d8a232', shoes: '#c89232',
      face: '#14141c' } },

  // Facepaint, NOT warpaint — warpaint covers the eyes, and a clown with no
  // eyes is a different genre. Red afro, white face, and primaries below:
  // the hoops in yellow, the dungarees in blue, the boots in red.
  { id: 'clown', name: 'Clown',
    wear: { hair: 'afro', top: 'hooped', bottom: 'dungaree', outer: 'none',
      headwear: 'none', gloves: 'gloves', footwear: 'boots',
      face: 'facepaint', back: 'none' },
    colours: { skin: '#e2b088', hair: '#d43c28', shirt: '#e8c22e',
      trousers: '#3a6ac8', gloves: '#f4f2ee', shoes: '#c22a20',
      face: '#f4f2ec' } },

  // The hat and the poncho are the silhouette; everything else is dust
  // colours. The jeans are the one cool note so the legs read against all
  // that leather, and the stubble says three days from the nearest town.
  { id: 'cowboy', name: 'Cowboy',
    wear: { hair: 'short', top: 'work', bottom: 'jeans', outer: 'poncho',
      headwear: 'cowboy', gloves: 'none', footwear: 'cowboyboots',
      face: 'stubble', back: 'none' },
    colours: { skin: '#c68e5e', hair: '#4a3220', shirt: '#7a4f34',
      trousers: '#3a4a63', outer: '#9c7a4a', headwear: '#6a4a2a',
      shoes: '#5c3a1e', face: '#3a2c20' } },

  // The green mohawk is the accent and the silhouette in one. The jacket
  // sits a shade lighter than the tee so the leather reads as a layer, the
  // nosering is silver so it shows, and the guitar goes where a knight
  // keeps his shield.
  { id: 'punk', name: 'Punk',
    wear: { hair: 'mohawk', top: 'band', bottom: 'ripped', outer: 'biker',
      headwear: 'none', gloves: 'fingerless', footwear: 'boots',
      face: 'nosering', back: 'guitar' },
    colours: { skin: '#e8c8a8', hair: '#3cb44a', shirt: '#141216',
      trousers: '#2a2a30', outer: '#26222a', gloves: '#1e1a1e',
      shoes: '#201c18', face: '#c8ccd2', back: '#7a3a20' } },

  // Crimson gown, gold crown, white opera gloves, purple cape: the royal
  // colours in the royal order. The crown is the same one the god wears,
  // and the gown is what keeps the two thrones apart.
  { id: 'queen', name: 'Queen',
    wear: { hair: 'ringlets', top: 'robe', bottom: 'longskirt',
      outer: 'none', headwear: 'crown', gloves: 'opera',
      footwear: 'shoes', face: 'lipstick', back: 'cape' },
    colours: { skin: '#7c4c2c', hair: '#2a1c14', shirt: '#7a1830',
      trousers: '#641226', headwear: '#f2cf5e', gloves: '#f2ede0',
      shoes: '#3a1420', face: '#c22440', back: '#522a72' } },

  // Straw hat, red plaid, denim dungarees, green wellies — the farm from
  // fifty yards. The freckles are a shade darker than the skin, which is
  // the only way freckles ever show on anybody.
  { id: 'farmer', name: 'Farmer',
    wear: { hair: 'crop', top: 'plaid', bottom: 'dungaree', outer: 'none',
      headwear: 'straw', gloves: 'none', footwear: 'wellies',
      face: 'freckles', back: 'none' },
    colours: { skin: '#d8a06e', hair: '#b06a34', shirt: '#a03a28',
      trousers: '#3e5474', headwear: '#d8b866', shoes: '#3a4a2e',
      face: '#9a6238' } },

  // --- the monsters ---------------------------------------------------------
  //
  // The one thing the wardrobe could not do until now was stop being a
  // PERSON, and the reason was never the clothes: it was the skin. `skin` is
  // a colour like any other and an outfit may set it, so a monster is the
  // same drawers with the flesh painted green, grey or bone — which is what a
  // monster in this art style actually is.

  // The shirt is a cold slate on purpose: the first draft dressed a green
  // man in green, and at thumbnail size he was one moss-coloured lump.
  { id: 'zombie', name: 'Zombie',
    wear: { hair: 'messy', top: 'shirt', bottom: 'ripped', outer: 'none',
      headwear: 'none', gloves: 'none', footwear: 'shoes',
      face: 'scar', back: 'none' },
    colours: { skin: '#6e8a52', hair: '#2f2a20', shirt: '#4a5568',
      trousers: '#3d3a44', shoes: '#2a2420', face: '#42523a' } },

  { id: 'skeleton', name: 'Skeleton',
    wear: { hair: 'none', top: 'tank', bottom: 'shorts', outer: 'none',
      headwear: 'none', gloves: 'none', footwear: 'none',
      face: 'none', back: 'none' },
    colours: { skin: '#e8e4d4', shirt: '#d4cfbe', trousers: '#c8c2b0' } },

  { id: 'vampire', name: 'Vampire',
    wear: { hair: 'sidepart', top: 'oxford', bottom: 'suit',
      outer: 'waistcoat', headwear: 'none', gloves: 'none',
      footwear: 'brogues', face: 'goatee', back: 'cape' },
    colours: { skin: '#e8e0da', hair: '#16121a', shirt: '#f2f0ec',
      trousers: '#1a1a22', outer: '#2c1218', shoes: '#141014',
      face: '#16121a', back: '#5c1420' } },

  // The plaid shirt is the transformation story in one garment: he dressed
  // as a man and the moon had other plans. ('ripped' is a pair of jeans,
  // not a top — the first draft wore it here and the shirt never drew.)
  { id: 'werewolf', name: 'Werewolf',
    wear: { hair: 'shag', top: 'plaid', bottom: 'cutoffs', outer: 'none',
      headwear: 'ears', gloves: 'none', footwear: 'none',
      face: 'fullbeard', back: 'none' },
    colours: { skin: '#8a6844', hair: '#3a2a1c', shirt: '#6a2822',
      trousers: '#463826', headwear: '#3a2a1c', face: '#32241a' } },

  { id: 'mummy', name: 'Mummy',
    wear: { hair: 'none', top: 'tank', bottom: 'shorts', outer: 'none',
      headwear: 'wrap', gloves: 'wraps', footwear: 'none',
      face: 'facescarf', back: 'none' },
    colours: { skin: '#c8bc9c', shirt: '#e2dabf', trousers: '#d8cfb4',
      headwear: '#e8e0c8', gloves: '#e2dabf', face: '#dcd4ba' } },

  { id: 'ghost', name: 'Ghost',
    wear: { hair: 'long', top: 'robe', bottom: 'longskirt', outer: 'cloak',
      headwear: 'none', gloves: 'none', footwear: 'none',
      face: 'none', back: 'none' },
    colours: { skin: '#dfe8ee', hair: '#cddae2', shirt: '#e8eff4',
      trousers: '#dde6ec', outer: '#eef4f8' } },

  { id: 'witch', name: 'Witch',
    wear: { hair: 'longpart', top: 'robe', bottom: 'longskirt',
      outer: 'wizard', headwear: 'none', gloves: 'none',
      footwear: 'boots', face: 'none', back: 'none' },
    colours: { skin: '#93a468', hair: '#241c26', shirt: '#2c2240',
      trousers: '#241a34', outer: '#1f1830', shoes: '#181212' } },

  { id: 'monster', name: 'The monster',
    wear: { hair: 'flattop', top: 'work', bottom: 'trousers',
      outer: 'none', headwear: 'none', gloves: 'none', footwear: 'steel',
      face: 'scar', back: 'none' },
    colours: { skin: '#7f9a70', hair: '#1a1816', shirt: '#2f3a2c',
      trousers: '#2a2a2e', shoes: '#181412', face: '#3a4a34' } },

  // Silver jumpsuit, not a green one — green flesh in green cloth was one
  // creature-shaped blur. The goggles in near-black are the huge dark eyes,
  // which is the one thing every drawing of an alien agrees on.
  { id: 'alien', name: 'Alien',
    wear: { hair: 'none', top: 'track', bottom: 'track', outer: 'none',
      headwear: 'none', gloves: 'gloves', footwear: 'boots',
      face: 'goggles', back: 'airtank' },
    colours: { skin: '#a2c8a4', shirt: '#7a8290', trousers: '#6a7280',
      gloves: '#565a62', shoes: '#3a3e46', face: '#0e1216',
      back: '#c8ccd2' } },

  { id: 'robot', name: 'Robot',
    wear: { hair: 'none', top: 'mail', bottom: 'greaves',
      outer: 'breastplate', headwear: 'helm', gloves: 'gauntlets',
      footwear: 'steel', face: 'visorface', back: 'jetpack' },
    colours: { skin: '#9aa2ad', shirt: '#8a929c', trousers: '#7d858f',
      outer: '#aeb6c0', headwear: '#9aa2ad', gloves: '#7d858f',
      shoes: '#5c626a', face: '#2ab4d4', back: '#8a929c' } },

  { id: 'troll', name: 'Troll',
    wear: { hair: 'dreads', top: 'tunic', bottom: 'cutoffs', outer: 'none',
      headwear: 'band', gloves: 'none', footwear: 'none',
      face: 'fullbeard', back: 'none' },
    colours: { skin: '#74904e', hair: '#463620', shirt: '#66563a',
      trousers: '#463c28', headwear: '#5a4426', face: '#3c2e1a' } },
];


export const outfit = (id) => OUTFITS.find((o) => o.id === id) || null;

const byId = (list, id) => list.find((i) => i.id === id) || null;

/** One item by category and id, or null for "leave it as the photo made it". */
export function item(catKey, id) {
  const cat = CATEGORIES.find((c) => c.key === catKey);
  if (!cat || !id || id === 'auto') return null;
  return byId(cat.items, id);
}

/**
 * Put the clothes on.
 *
 * `wear` names one item per category; `auto` means "whatever the generator
 * already made from the photograph", which is the default for the ones the
 * photograph can actually answer.
 */
export function dressUp(skin, wear, ctx) {
  for (const cat of CATEGORIES) {
    // effects go through applyEffects, LAST and with a tick — fire is on top
    // of the jacket, not under it
    if (cat.multi) continue;
    const it = item(cat.key, (wear || {})[cat.key]);
    if (!it || !it.draw) continue;
    const chosen = (ctx.colours || {})[cat.colour];
    const colour = chosen ? hexToRgb(chosen)
      : ctx.pal[cat.colour] || hexToRgb(EXTRA_COLOURS[cat.colour] || '#808080');
    it.draw(skin, { ...ctx, colour, cat: cat.key });
  }
}

/** Whether a category has anything on. */
export function isWorn(wear, key) {
  const id = (wear || {})[key];
  if (Array.isArray(id)) return id.length > 0;
  return !!id && id !== 'none' && id !== 'auto';
}

export { jitter };
