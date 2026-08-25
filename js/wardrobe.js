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
// Everything is drawn in FRACTIONS of the part it is on, never in pixels, so
// the same wardrobe fits a 64 and a 256 without a second set of numbers.

import { shade, hexToRgb } from './pixels.js';

// ---------------------------------------------------------------------------
// drawing in fractions
// ---------------------------------------------------------------------------

/** A sub-rectangle of a face, in fractions of it: (left, top, right, bottom). */
export function sub(rect, a, b, c, d) {
  const [x, y, w, h] = rect;
  const x0 = x + Math.round(w * a), y0 = y + Math.round(h * b);
  const x1 = x + Math.round(w * c), y1 = y + Math.round(h * d);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/**
 * A repeatable scatter, by position.
 *
 * Spiky hair has to be spiky in the SAME places every time it is drawn, or
 * the thumbnail in the grid is a different haircut from the one that lands on
 * the figure. Hashed off the coordinates, so it is a property of the style
 * rather than of when it was drawn.
 */
export function jitter(u, v, salt = 0) {
  let n = (u * 374761393 + v * 668265263 + salt * 2246822519) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];

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

// ---------------------------------------------------------------------------
// hair
// ---------------------------------------------------------------------------
//
// One mask function and a table of shapes, rather than thirty hand-drawn
// haircuts. What makes a style is where the hair STOPS: how far down the
// forehead, how far down the sides, how far down the back, and whether the
// edge of it is a straight line, a ragged one or a spike.

const EDGE = {
  straight: () => 0,
  ragged: (u, v, salt) => (jitter(Math.round(u * 24), 0, salt) - 0.5) * 0.10,
  spiky: (u, v, salt) => (jitter(Math.round(u * 16), 0, salt) > 0.5 ? -0.10 : 0.06),
  wavy: (u) => Math.sin(u * 12) * 0.045,
  curly: (u, v, salt) => (jitter(Math.round(u * 20), Math.round(v * 20), salt) - 0.5) * 0.14,
};

function hairStyle(id, name, o) {
  return {
    id,
    name,
    layer: o.puff ? 'both' : 'base',
    draw(skin, c) {
      if (o.bald && !o.crown) return;
      const col = c.colour;
      const edge = EDGE[o.edge || 'straight'];
      const salt = id.length * 7 + 3;
      const hairAt = (face, x, y) => {
        if (face === 'bottom') return false;
        if (face === 'top') return true;
        const wobble = edge(x, y, salt);
        if (face === 'front') {
          if (o.bald) return y < 0.10 && (x < 0.16 || x > 0.84);
          if (o.mohawk) return y < o.fringe + wobble && x > 0.36 && x < 0.64;
          if (y < o.fringe + wobble) return true;
          // sideburns and the hair falling past the ears at the front edge
          return y < (o.sideLen || 0) && (x < (o.sideWidth ?? 0.14) || x > 1 - (o.sideWidth ?? 0.14));
        }
        if (face === 'back') {
          if (o.mohawk) return y < o.backLen && x > 0.36 && x < 0.64;
          return y < o.backLen + wobble;
        }
        // the two sides
        if (o.mohawk) return false;
        return y < (o.sideLen || o.fringe) + wobble;
      };
      overFaces(skin, c.parts.head.rects, (face, x, y) => hairAt(face, x, y),
        (face, u, v, w, h) => {
          const y = (v + 0.5) / h;
          const shadeK = 1 - y * 0.10 + (jitter(u, v, salt) - 0.5) * 0.10;
          return shade(col, shadeK);
        }, c.ink);
      // a parting, which is most of what tells two dark haircuts apart
      if (o.part) {
        const r = c.parts.head.rects.top;
        skin.mapRect(r, (u, v, cur, w) => {
          const x = (u + 0.5) / w;
          return Math.abs(x - o.part) < 0.07 ? shade(cur, 0.82) : null;
        });
      }
      if (o.puff) {
        // a style that stands proud of the skull gets the second layer too
        overFaces(skin, c.parts.head.overRects, (face, x, y) => (
          face !== 'bottom' && hairAt(face, x, y) && (o.puffAll || jitter(Math.round(x * 20), Math.round(y * 20), salt + 5) > 0.22)
        ), (face, u, v, w, h) => shade(col, 1 - ((v + 0.5) / h) * 0.08), c.ink);
      }
      if (o.tail) {
        // a ponytail or a bun on the back of the head, on the outer layer
        const r = c.parts.head.overRects.back;
        const box = o.tail === 'bun'
          ? sub(r, 0.34, 0.02, 0.66, 0.34)
          : sub(r, 0.38, 0.24, 0.62, 1.0);
        skin.fillRect(box, shade(col, 0.94));
      }
      if (o.pigtails) {
        for (const face of ['right', 'left']) {
          const r = c.parts.head.overRects[face];
          skin.fillRect(sub(r, 0.16, 0.42, 0.62, 0.98), shade(col, 0.96));
        }
      }
    },
  };
}

export const HAIR = [
  { id: 'none', name: 'Shaved', draw() {} },
  hairStyle('buzz', 'Buzz cut', { fringe: 0.24, sideLen: 0.30, backLen: 0.40, edge: 'straight' }),
  hairStyle('crop', 'Crop', { fringe: 0.30, sideLen: 0.34, backLen: 0.46, edge: 'ragged' }),
  hairStyle('short', 'Short', { fringe: 0.32, sideLen: 0.40, backLen: 0.52, edge: 'straight', part: 0.34 }),
  hairStyle('sidepart', 'Side part', { fringe: 0.34, sideLen: 0.42, backLen: 0.54, edge: 'straight', part: 0.28 }),
  hairStyle('quiff', 'Quiff', { fringe: 0.20, sideLen: 0.30, backLen: 0.44, edge: 'spiky', puff: true }),
  hairStyle('spiky', 'Spiky', { fringe: 0.26, sideLen: 0.32, backLen: 0.46, edge: 'spiky', puff: true, puffAll: false }),
  hairStyle('messy', 'Messy', { fringe: 0.34, sideLen: 0.44, backLen: 0.58, edge: 'ragged', puff: true }),
  hairStyle('bowl', 'Bowl', { fringe: 0.40, sideLen: 0.48, backLen: 0.56, edge: 'straight' }),
  hairStyle('fringe', 'Fringe', { fringe: 0.44, sideLen: 0.52, backLen: 0.62, edge: 'straight' }),
  hairStyle('bob', 'Bob', { fringe: 0.36, sideLen: 0.76, backLen: 0.80, edge: 'straight', sideWidth: 0.16 }),
  hairStyle('bobwave', 'Wavy bob', { fringe: 0.36, sideLen: 0.78, backLen: 0.84, edge: 'wavy', sideWidth: 0.18 }),
  hairStyle('long', 'Long', { fringe: 0.30, sideLen: 0.95, backLen: 1.0, edge: 'straight', sideWidth: 0.18 }),
  hairStyle('longwave', 'Long wavy', { fringe: 0.32, sideLen: 0.95, backLen: 1.0, edge: 'wavy', sideWidth: 0.20 }),
  hairStyle('curly', 'Curly', { fringe: 0.36, sideLen: 0.60, backLen: 0.70, edge: 'curly', puff: true }),
  hairStyle('afro', 'Afro', { fringe: 0.30, sideLen: 0.52, backLen: 0.62, edge: 'curly', puff: true, puffAll: true }),
  hairStyle('coils', 'Coils', { fringe: 0.26, sideLen: 0.40, backLen: 0.52, edge: 'curly', puff: true, puffAll: true }),
  hairStyle('dreads', 'Locs', { fringe: 0.28, sideLen: 0.86, backLen: 0.94, edge: 'spiky', sideWidth: 0.20 }),
  hairStyle('ponytail', 'Ponytail', { fringe: 0.30, sideLen: 0.36, backLen: 0.50, edge: 'straight', tail: 'tail' }),
  hairStyle('bun', 'Bun', { fringe: 0.28, sideLen: 0.34, backLen: 0.48, edge: 'straight', tail: 'bun' }),
  hairStyle('pigtails', 'Pigtails', { fringe: 0.34, sideLen: 0.44, backLen: 0.56, edge: 'straight', pigtails: true }),
  hairStyle('mohawk', 'Mohawk', { fringe: 0.34, backLen: 0.50, mohawk: true, edge: 'spiky', puff: true, puffAll: true }),
  hairStyle('undercut', 'Undercut', { fringe: 0.32, sideLen: 0.14, backLen: 0.30, edge: 'straight', part: 0.30 }),
  hairStyle('receding', 'Receding', { fringe: 0.12, sideLen: 0.44, backLen: 0.56, edge: 'straight', sideWidth: 0.22 }),
  hairStyle('balding', 'Balding', { bald: true, crown: false, sideLen: 0.44, backLen: 0.52, fringe: 0 }),
];

// ---------------------------------------------------------------------------
// tops
// ---------------------------------------------------------------------------
//
// A top is three numbers and a pattern: how far down the arm the sleeve goes,
// what the neckline does, and what is printed on it. That covers a t-shirt, a
// jumper, a vest and a football strip without four separate drawings.

const PATTERN = {
  plain: () => null,
  hoops: (x, y, c) => (Math.floor(y * 6) % 2 ? shade(c, 0.82) : null),
  stripes: (x, y, c) => (Math.floor(x * 8) % 2 ? shade(c, 0.84) : null),
  wide: (x, y, c) => (Math.floor(y * 3) % 2 ? shade(c, 0.78) : null),
  plaid: (x, y, c) => (Math.floor(y * 5) % 2 || Math.floor(x * 5) % 2 ? shade(c, 0.86) : null),
  speckle: (x, y, c, salt) => (jitter(Math.round(x * 40), Math.round(y * 40), salt) > 0.72 ? shade(c, 0.88) : null),
  panel: (x, y, c) => (x > 0.32 && x < 0.68 ? shade(c, 1.10) : null),
};

function top(id, name, o) {
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      const P = c.parts;
      const pat = PATTERN[o.pattern || 'plain'];
      const salt = id.length * 11 + 5;
      const cloth = (face) => (u, v, cur, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        let out = shade(col, 1 - y * 0.12);
        const p = pat(x, y, col, salt);
        if (p) out = p;
        return c.ink.grain(c.ink.lit(out, face), 0.7);
      };
      for (const face of FACES) skin.mapRect(P.body.rects[face], cloth(face));

      // the neckline: what a top does at the throat is most of its character
      const neck = c.pal.skin;
      const front = P.body.rects.front;
      if (o.neck === 'vee') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const x = Math.abs((u + 0.5) / w - 0.5) * 2, y = (v + 0.5) / h;
          return y < 0.22 && x < 0.5 - y * 1.4 ? c.ink.lit(shade(neck, 0.95), 'front') : null;
        });
      } else if (o.neck === 'tank') {
        for (const face of ['front', 'back']) {
          skin.mapRect(P.body.rects[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            return (y < 0.34 && (x < 0.22 || x > 0.78)) || (y < 0.16 && x > 0.3 && x < 0.7)
              ? c.ink.lit(shade(neck, 0.95), face) : null;
          });
        }
      } else if (o.neck === 'collar') {
        skin.mapRect(front, (u, v, cur, w, h) => (
          (v + 0.5) / h < 0.09 ? c.ink.lit(shade(col, 1.16), 'front') : null
        ));
      }
      // a zip, a placket or a number, down or across the front
      if (o.mark === 'zip') {
        skin.mapRect(front, (u, v, cur, w) => (
          Math.abs((u + 0.5) / w - 0.5) < 0.07 ? c.ink.lit(shade(col, 0.66), 'front') : null
        ));
      } else if (o.mark === 'buttons') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const x = Math.abs((u + 0.5) / w - 0.5), y = (v + 0.5) / h;
          if (x < 0.06) return c.ink.lit(shade(col, 0.78), 'front');
          return x < 0.10 && (y > 0.2 && y < 0.26 || y > 0.5 && y < 0.56)
            ? c.ink.lit([222, 216, 200], 'front') : null;
        });
      } else if (o.mark === 'number') {
        skin.mapRect(P.body.rects.back, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          const on = y > 0.28 && y < 0.62 && ((x > 0.30 && x < 0.40) || (x > 0.60 && x < 0.70)
            || (y > 0.42 && y < 0.50 && x > 0.30 && x < 0.70));
          return on ? c.ink.lit([236, 232, 224], 'back') : null;
        });
      } else if (o.mark === 'print') {
        skin.mapRect(front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          return x > 0.28 && x < 0.72 && y > 0.30 && y < 0.58
            ? c.ink.lit(shade(col, jitter(u, v, salt) > 0.4 ? 1.5 : 1.2), 'front') : null;
        });
      }

      // the sleeves, and the skin the sleeve leaves showing
      const sleeve = o.sleeve;
      for (const key of ['armR', 'armL']) {
        const arm = P[key];
        for (const face of FACES) {
          skin.mapRect(arm.rects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h;
            if (face === 'top') return c.ink.lit(sleeve > 0 ? shade(col, 1.05) : c.pal.skin, face);
            if (face === 'bottom') return c.ink.lit(sleeve >= 1 ? col : c.pal.skin, face);
            if (y > sleeve) {
              const bare = shade(c.pal.skin, 1 - y * 0.07);
              return c.ink.grain(c.ink.lit(bare, face), 0.5);
            }
            let out = shade(col, 1 - y * 0.10);
            const p = pat((u + 0.5) / w, y, col, salt);
            if (p) out = p;
            if (y > sleeve - 0.09) out = shade(out, 0.86);      // the cuff
            return c.ink.grain(c.ink.lit(out, face), 0.7);
          });
        }
      }
    },
  };
}

export const TOPS = [
  top('tee', 'T-shirt', { sleeve: 0.34, neck: 'round' }),
  top('teevee', 'V-neck tee', { sleeve: 0.34, neck: 'vee' }),
  top('tank', 'Vest', { sleeve: 0.06, neck: 'tank' }),
  top('longtee', 'Long sleeve', { sleeve: 0.92, neck: 'round' }),
  top('jumper', 'Jumper', { sleeve: 1, neck: 'collar' }),
  top('roll', 'Roll-neck', { sleeve: 1, neck: 'collar', pattern: 'speckle' }),
  top('hoodie', 'Hoodie', { sleeve: 1, neck: 'collar', mark: 'zip' }),
  top('shirt', 'Shirt', { sleeve: 1, neck: 'collar', mark: 'buttons' }),
  top('shortshirt', 'Short shirt', { sleeve: 0.34, neck: 'collar', mark: 'buttons' }),
  top('polo', 'Polo', { sleeve: 0.34, neck: 'collar', mark: 'buttons' }),
  top('striped', 'Striped tee', { sleeve: 0.34, neck: 'round', pattern: 'hoops' }),
  top('breton', 'Breton', { sleeve: 0.92, neck: 'round', pattern: 'wide' }),
  top('plaid', 'Plaid shirt', { sleeve: 1, neck: 'collar', pattern: 'plaid', mark: 'buttons' }),
  top('jersey', 'Football strip', { sleeve: 0.34, neck: 'round', pattern: 'stripes', mark: 'number' }),
  top('band', 'Band tee', { sleeve: 0.34, neck: 'round', mark: 'print' }),
  top('track', 'Track top', { sleeve: 1, neck: 'collar', pattern: 'panel', mark: 'zip' }),
  top('apron', 'Apron', { sleeve: 0.34, neck: 'round', pattern: 'panel' }),
  {
    // not a garment: skin, everywhere a garment would have been
    id: 'none',
    name: 'Bare',
    draw(skin, c) {
      for (const key of ['body', 'armR', 'armL']) {
        for (const face of FACES) {
          skin.mapRect(c.parts[key].rects[face], (u, v, cur, ww, hh) => (
            c.ink.grain(c.ink.lit(shade(c.pal.skin, 1 - ((v + 0.5) / hh) * 0.08), face), 0.5)
          ));
        }
      }
    },
  },
];

// ---------------------------------------------------------------------------
// bottoms
// ---------------------------------------------------------------------------

function bottom(id, name, o) {
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      const salt = id.length * 13 + 2;
      const pat = PATTERN[o.pattern || 'plain'];
      for (const key of ['legR', 'legL']) {
        const leg = c.parts[key];
        for (const face of FACES) {
          skin.mapRect(leg.rects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h, x = (u + 0.5) / w;
            if (face === 'top') return c.ink.lit(shade(col, 1.04), face);
            if (face === 'bottom') return null;      // footwear's business
            if (y > o.length) {
              const bare = shade(c.pal.skin, 1 - y * 0.06);
              return c.ink.grain(c.ink.lit(bare, face), 0.5);
            }
            let out = shade(col, 1 - y * 0.08);
            const p = pat(x, y, col, salt);
            if (p) out = p;
            if (o.length < 0.98 && y > o.length - 0.06) out = shade(out, 0.84);   // the hem
            if (o.pocket && y > 0.10 && y < 0.24 && (x < 0.22 || x > 0.78)) out = shade(out, 0.88);
            if (o.seam && Math.abs(x - 0.5) < 0.07 && face === 'front') out = shade(out, 0.9);
            return c.ink.grain(c.ink.lit(out, face), 0.7);
          });
        }
      }
      // a waistband across the top of both legs and the bottom of the body
      if (o.belt) {
        for (const key of ['legR', 'legL']) {
          for (const face of ['front', 'back', 'right', 'left']) {
            skin.mapRect(c.parts[key].rects[face], (u, v, cur, w, h) => (
              (v + 0.5) / h < 0.07 ? c.ink.lit(shade(hexToRgb(o.belt), 1), face) : null
            ));
          }
        }
      }
    },
  };
}

export const BOTTOMS = [
  bottom('jeans', 'Jeans', { length: 1, seam: true, pocket: true, belt: '#3b2b1e' }),
  bottom('trousers', 'Trousers', { length: 1, seam: true }),
  bottom('chinos', 'Chinos', { length: 1, pocket: true, belt: '#5a4632' }),
  bottom('cargo', 'Cargo', { length: 1, pocket: true, pattern: 'panel', belt: '#3b3327' }),
  bottom('shorts', 'Shorts', { length: 0.46, pocket: true }),
  bottom('longshorts', 'Long shorts', { length: 0.62, pocket: true }),
  bottom('skirt', 'Skirt', { length: 0.40 }),
  bottom('kilt', 'Kilt', { length: 0.48, pattern: 'plaid' }),
  bottom('track', 'Tracksuit', { length: 1, pattern: 'stripes' }),
  bottom('leggings', 'Leggings', { length: 1, pattern: 'speckle' }),
  bottom('dungarees', 'Dungarees', { length: 1, seam: true, pattern: 'panel' }),
  bottom('swim', 'Trunks', { length: 0.34, pattern: 'hoops' }),
];

// ---------------------------------------------------------------------------
// outerwear — the body's second layer, which is exactly what a jacket is
// ---------------------------------------------------------------------------

function outer(id, name, o) {
  return {
    id,
    name,
    layer: 'over',
    draw(skin, c) {
      const col = c.colour;
      const P = c.parts;
      const salt = id.length * 17 + 9;
      for (const face of FACES) {
        skin.mapRect(P.body.overRects[face], (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          if (y > o.length) return [0, 0, 0, 0];
          if (o.open && face === 'front' && Math.abs(x - 0.5) < o.open) return [0, 0, 0, 0];
          let out = shade(col, 1 - y * 0.10);
          if (o.pattern) {
            const p = PATTERN[o.pattern](x, y, col, salt);
            if (p) out = p;
          }
          if (o.trim && y < 0.09) out = shade(col, 1.2);
          return c.ink.grain(c.ink.lit(out, face), 0.6);
        });
      }
      for (const key of ['armR', 'armL']) {
        for (const face of FACES) {
          skin.mapRect(P[key].overRects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h;
            if (y > o.sleeve) return [0, 0, 0, 0];
            let out = shade(col, 1 - y * 0.08);
            if (y > o.sleeve - 0.09 && o.sleeve < 0.98) out = shade(out, 0.86);
            return c.ink.grain(c.ink.lit(out, face), 0.6);
          });
        }
      }
      // a hood, which lives on the head's outer layer and so must be drawn
      // before any hat is: a hat over a hood is a hat, and that is right
      if (o.hood) {
        overFaces(skin, P.head.overRects, (face, x, y) => (
          face === 'back' || face === 'top' || ((face === 'right' || face === 'left') && x < 0.45)
        ), () => col, c.ink);
      }
    },
  };
}

export const OUTERWEAR = [
  { id: 'none', name: 'None', layer: 'over', draw() {} },
  outer('jacket', 'Jacket', { length: 0.94, sleeve: 1, open: 0.10, trim: true }),
  outer('denim', 'Denim jacket', { length: 0.72, sleeve: 1, open: 0.10, pattern: 'speckle' }),
  outer('coat', 'Long coat', { length: 1, sleeve: 1, open: 0.08 }),
  outer('parka', 'Parka', { length: 1, sleeve: 1, hood: true, trim: true }),
  outer('hoodie', 'Hoodie', { length: 0.92, sleeve: 1, hood: true }),
  outer('bomber', 'Bomber', { length: 0.72, sleeve: 1, trim: true, pattern: 'panel' }),
  outer('gilet', 'Gilet', { length: 0.86, sleeve: 0, open: 0.10, pattern: 'wide' }),
  outer('cardigan', 'Cardigan', { length: 0.96, sleeve: 1, open: 0.14, pattern: 'speckle' }),
  outer('labcoat', 'Lab coat', { length: 1, sleeve: 1, open: 0.08, trim: true }),
  outer('armour', 'Breastplate', { length: 0.80, sleeve: 0.34, trim: true, pattern: 'panel' }),
  outer('poncho', 'Poncho', { length: 1, sleeve: 0.30, pattern: 'hoops' }),
];

// ---------------------------------------------------------------------------
// headwear — the head's outer layer
// ---------------------------------------------------------------------------

function headwear(id, name, o) {
  return {
    id,
    name,
    layer: 'over',
    draw(skin, c) {
      const col = c.colour;
      const R = c.parts.head.overRects;
      const band = o.band === undefined ? 0.30 : o.band;
      overFaces(skin, R, (face, x, y) => {
        if (face === 'bottom') return false;
        if (face === 'top') return o.crown !== false;
        if (o.shape === 'band') return y > band - 0.12 && y < band;
        if (o.shape === 'bandana') return y < band && (face !== 'front' || y < band * 0.8);
        if (o.shape === 'cap') {
          // a peak over the eyes, and nothing at the back but the band
          if (face === 'front') return y < band;
          return y < band;
        }
        if (o.shape === 'horns') return false;
        return y < band;
      }, (face, u, v, w, h) => {
        const y = (v + 0.5) / h;
        if (o.trim && y > band - 0.12 && y < band) return shade(col, 0.7);
        return shade(col, 1 - y * 0.06);
      }, c.ink);

      // the peak of a cap, drawn onto the head's own top face in front
      if (o.shape === 'cap') {
        skin.mapRect(R.top, (u, v, cur, w, h) => (
          (v + 0.5) / h > (o.back ? 0.06 : 0.62) ? c.ink.lit(shade(col, 0.86), 'top') : null
        ));
      }
      if (o.shape === 'tall') {
        // a top hat: the brim on the top face and a second storey is not
        // possible, so it reads as a deep band with a brim line
        skin.mapRect(R.top, () => c.ink.lit(shade(col, 1.05), 'top'));
        for (const face of ['front', 'back', 'right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => (
            Math.abs((v + 0.5) / h - band) < 0.06 ? c.ink.lit(shade(col, 0.6), face) : null
          ));
        }
      }
      if (o.shape === 'crown') {
        for (const face of ['front', 'back', 'right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            const spike = Math.floor(x * 4) % 2 === 0;
            return y < (spike ? band : band * 0.55) ? c.ink.lit(shade(col, 1.1), face) : [0, 0, 0, 0];
          });
        }
      }
      if (o.shape === 'horns') {
        for (const face of ['front', 'back', 'right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            return y < 0.22 && (x < 0.20 || x > 0.80) ? c.ink.lit(col, face) : null;
          });
        }
        skin.mapRect(R.top, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          return (x < 0.22 || x > 0.78) && y > 0.28 && y < 0.72 ? c.ink.lit(col, 'top') : null;
        });
      }
      if (o.ears) {
        skin.mapRect(R.top, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          return (x < 0.30 || x > 0.70) && y > 0.20 && y < 0.60 ? c.ink.lit(shade(col, 0.9), 'top') : null;
        });
      }
    },
  };
}

export const HEADWEAR = [
  { id: 'none', name: 'None', layer: 'over', draw() {} },
  headwear('cap', 'Cap', { shape: 'cap', band: 0.30 }),
  headwear('capback', 'Backwards cap', { shape: 'cap', band: 0.30, back: true }),
  headwear('beanie', 'Beanie', { shape: 'beanie', band: 0.36, trim: true }),
  headwear('bobble', 'Bobble hat', { shape: 'beanie', band: 0.40, trim: true }),
  headwear('band', 'Headband', { shape: 'band', band: 0.34, crown: false }),
  headwear('bandana', 'Bandana', { shape: 'bandana', band: 0.28 }),
  headwear('hood', 'Hood', { shape: 'beanie', band: 0.46 }),
  headwear('tophat', 'Top hat', { shape: 'tall', band: 0.44 }),
  headwear('bowler', 'Bowler', { shape: 'tall', band: 0.30 }),
  headwear('crown', 'Crown', { shape: 'crown', band: 0.26, crown: false }),
  headwear('helm', 'Helmet', { shape: 'beanie', band: 0.52, trim: true }),
  headwear('hardhat', 'Hard hat', { shape: 'beanie', band: 0.34, trim: true }),
  headwear('horns', 'Horns', { shape: 'horns', band: 0, crown: false }),
  headwear('ears', 'Ears', { shape: 'none', band: 0, crown: false, ears: true }),
  headwear('turban', 'Turban', { shape: 'bandana', band: 0.44, trim: true }),
];

// ---------------------------------------------------------------------------
// gloves, footwear
// ---------------------------------------------------------------------------

function gloves(id, name, o) {
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      for (const key of ['armR', 'armL']) {
        for (const face of FACES) {
          skin.mapRect(c.parts[key].rects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h;
            if (face === 'top') return null;
            if (face === 'bottom') return c.ink.lit(o.open ? c.pal.skin : col, face);
            if (y < 1 - o.length) return null;
            if (o.open && y > 0.94) return null;
            const cuff = y < 1 - o.length + 0.07;
            return c.ink.grain(c.ink.lit(shade(col, cuff ? 1.12 : 1), face), 0.6);
          });
        }
      }
    },
  };
}

export const GLOVES = [
  { id: 'none', name: 'Bare hands', draw() {} },
  gloves('gloves', 'Gloves', { length: 0.20 }),
  gloves('fingerless', 'Fingerless', { length: 0.18, open: true }),
  gloves('long', 'Long gloves', { length: 0.42 }),
  gloves('gauntlets', 'Gauntlets', { length: 0.52 }),
  gloves('mittens', 'Mittens', { length: 0.26 }),
  gloves('wraps', 'Hand wraps', { length: 0.14, open: true }),
];

function footwear(id, name, o) {
  return {
    id,
    name,
    draw(skin, c) {
      const col = c.colour;
      for (const key of ['legR', 'legL']) {
        for (const face of FACES) {
          skin.mapRect(c.parts[key].rects[face], (u, v, cur, w, h) => {
            const y = (v + 0.5) / h, x = (u + 0.5) / w;
            if (face === 'top') return null;
            if (face === 'bottom') return c.ink.lit(shade(col, 0.68), face);
            if (y < 1 - o.height) return null;
            let out = col;
            if (o.sole && y > 0.94) out = shade(col, 0.7);
            if (o.stripe && Math.abs(y - (1 - o.height + 0.06)) < 0.04) out = shade(col, 1.35);
            if (o.laces && face === 'front' && Math.abs(x - 0.5) < 0.2 && y > 1 - o.height + 0.04 && y < 0.9) {
              out = shade(col, 1.25);
            }
            return c.ink.grain(c.ink.lit(out, face), 0.5);
          });
        }
      }
    },
  };
}

export const FOOTWEAR = [
  { id: 'none', name: 'Barefoot', draw() {} },
  footwear('trainers', 'Trainers', { height: 0.22, sole: true, stripe: true, laces: true }),
  footwear('hightops', 'High tops', { height: 0.34, sole: true, laces: true }),
  footwear('boots', 'Boots', { height: 0.42, sole: true, laces: true }),
  footwear('tallboots', 'Tall boots', { height: 0.62, sole: true }),
  footwear('wellies', 'Wellies', { height: 0.55, sole: true }),
  footwear('shoes', 'Shoes', { height: 0.18, sole: true }),
  footwear('sandals', 'Sandals', { height: 0.10, sole: true }),
  footwear('slippers', 'Slippers', { height: 0.16 }),
  footwear('skates', 'Skates', { height: 0.40, sole: true, stripe: true, laces: true }),
];

// ---------------------------------------------------------------------------
// face items — some against the skin (a beard), some over it (glasses)
// ---------------------------------------------------------------------------

function faceItem(id, name, o) {
  return {
    id,
    name,
    layer: o.over ? 'over' : 'base',
    draw(skin, c) {
      const col = o.useHair ? c.pal.hair : c.colour;
      const R = o.over ? c.parts.head.overRects : c.parts.head.rects;
      skin.mapRect(R.front, (u, v, cur, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        const on = o.mask(x, y);
        if (!on) return o.over ? [0, 0, 0, 0] : null;
        return c.ink.lit(typeof on === 'object' ? on : shade(col, 1), 'front');
      });
      if (o.sides) {
        for (const face of ['right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => {
            const x = (u + 0.5) / w, y = (v + 0.5) / h;
            const t = face === 'right' ? 1 - x : x;   // 0 at the front
            const on = o.sides(t, y);
            return on ? c.ink.lit(shade(col, 0.96), face) : (o.over ? [0, 0, 0, 0] : null);
          });
        }
      }
    },
  };
}

const EYE_ROW = [0.50, 0.66];      // where the generator puts eyes, in the face

export const FACE_ITEMS = [
  { id: 'none', name: 'None', draw() {} },
  faceItem('glasses', 'Glasses', {
    over: true,
    mask: (x, y) => y > EYE_ROW[0] && y < EYE_ROW[1]
      && (x < 0.44 || x > 0.56) && x > 0.06 && x < 0.94,
  }),
  faceItem('round', 'Round glasses', {
    over: true,
    mask: (x, y) => y > EYE_ROW[0] && y < EYE_ROW[1] && (
      (x > 0.12 && x < 0.34) || (x > 0.66 && x < 0.88) || (x > 0.44 && x < 0.56)),
  }),
  faceItem('shades', 'Sunglasses', {
    over: true,
    mask: (x, y) => y > EYE_ROW[0] - 0.04 && y < EYE_ROW[1] && x > 0.06 && x < 0.94,
  }),
  faceItem('eyepatch', 'Eyepatch', {
    over: true,
    mask: (x, y) => (y > EYE_ROW[0] - 0.06 && y < EYE_ROW[1] + 0.04 && x > 0.58 && x < 0.86)
      || (Math.abs(y - (EYE_ROW[0] - 0.10)) < 0.05 && x > 0.10),
  }),
  faceItem('monocle', 'Monocle', {
    over: true,
    mask: (x, y) => y > EYE_ROW[0] && y < EYE_ROW[1] && x > 0.60 && x < 0.86,
  }),
  faceItem('stubble', 'Stubble', {
    useHair: true,
    mask: (x, y) => y > 0.74 && (x > 0.14 && x < 0.86) && jitter(Math.round(x * 30), Math.round(y * 30), 3) > 0.42,
    sides: (t, y) => y > 0.74 && t < 0.5 && jitter(Math.round(t * 30), Math.round(y * 30), 3) > 0.5,
  }),
  faceItem('moustache', 'Moustache', {
    useHair: true,
    mask: (x, y) => y > 0.74 && y < 0.82 && x > 0.28 && x < 0.72,
  }),
  faceItem('goatee', 'Goatee', {
    useHair: true,
    mask: (x, y) => (y > 0.74 && y < 0.80 && x > 0.32 && x < 0.68) || (y > 0.86 && x > 0.36 && x < 0.64),
  }),
  faceItem('beard', 'Beard', {
    useHair: true,
    mask: (x, y) => y > 0.74 && x > 0.12 && x < 0.88,
    sides: (t, y) => y > 0.72 && t < 0.55,
  }),
  faceItem('fullbeard', 'Full beard', {
    useHair: true,
    mask: (x, y) => y > 0.66 && x > 0.08 && x < 0.92,
    sides: (t, y) => y > 0.62 && t < 0.7,
  }),
  faceItem('freckles', 'Freckles', {
    mask: (x, y) => y > 0.62 && y < 0.78 && (x < 0.36 || x > 0.64)
      && jitter(Math.round(x * 26), Math.round(y * 26), 9) > 0.72
      ? [176, 122, 84] : false,
  }),
  faceItem('blush', 'Blush', {
    mask: (x, y) => (y > 0.66 && y < 0.78 && (x < 0.26 || x > 0.74)) ? [214, 132, 122] : false,
  }),
  faceItem('warpaint', 'War paint', {
    mask: (x, y) => (Math.abs(y - 0.60) < 0.05 && x > 0.08 && x < 0.92) ? [190, 60, 54] : false,
  }),
  faceItem('mask', 'Face mask', {
    over: true,
    mask: (x, y) => y > 0.70 && x > 0.10 && x < 0.90,
  }),
  faceItem('scar', 'Scar', {
    mask: (x, y) => (x > 0.70 && x < 0.78 && y > 0.44 && y < 0.72) ? [186, 128, 108] : false,
  }),
];

// ---------------------------------------------------------------------------
// back items — painted on the back, because that is where a skin can put them
// ---------------------------------------------------------------------------

function backItem(id, name, o) {
  return {
    id,
    name,
    layer: 'over',
    draw(skin, c) {
      const col = c.colour;
      const R = c.parts.body.overRects;
      skin.mapRect(R.back, (u, v, cur, w, h) => {
        const x = (u + 0.5) / w, y = (v + 0.5) / h;
        const on = o.back(x, y);
        return on ? c.ink.lit(typeof on === 'object' ? on : shade(col, 1 - y * 0.08), 'back') : null;
      });
      if (o.straps) {
        skin.mapRect(R.front, (u, v, cur, w, h) => {
          const x = (u + 0.5) / w, y = (v + 0.5) / h;
          return y < 0.62 && (Math.abs(x - 0.26) < 0.08 || Math.abs(x - 0.74) < 0.08)
            ? c.ink.lit(shade(col, 0.9), 'front') : null;
        });
      }
      if (o.sides) {
        for (const face of ['right', 'left']) {
          skin.mapRect(R[face], (u, v, cur, w, h) => (
            o.sides((u + 0.5) / w, (v + 0.5) / h) ? c.ink.lit(shade(col, 0.92), face) : null
          ));
        }
      }
    },
  };
}

export const BACK_ITEMS = [
  { id: 'none', name: 'None', layer: 'over', draw() {} },
  backItem('backpack', 'Backpack', {
    back: (x, y) => x > 0.16 && x < 0.84 && y > 0.10 && y < 0.82,
    straps: true,
    sides: (x, y) => y > 0.10 && y < 0.82 && x > 0.3,
  }),
  backItem('satchel', 'Satchel', {
    back: (x, y) => x > 0.20 && x < 0.80 && y > 0.34 && y < 0.78,
    straps: true,
  }),
  backItem('wings', 'Wings', {
    back: (x, y) => (x < 0.34 || x > 0.66) && y > 0.06 && y < 0.70
      && Math.abs(x - 0.5) * 2 > y * 0.4,
  }),
  backItem('elytra', 'Elytra', {
    back: (x, y) => y > 0.06 && y < 0.86 && Math.abs(x - 0.5) > 0.08,
  }),
  backItem('quiver', 'Quiver', {
    back: (x, y) => x > 0.54 && x < 0.78 && y > 0.06 && y < 0.72,
    straps: true,
  }),
  backItem('shell', 'Shell', {
    back: (x, y) => Math.hypot((x - 0.5) * 1.4, y - 0.5) < 0.42,
    sides: (x, y) => y > 0.20 && y < 0.80 && x > 0.4,
  }),
  backItem('scarf', 'Scarf tails', {
    back: (x, y) => Math.abs(x - 0.5) < 0.18 && y > 0.04 && y < 0.72,
  }),
  backItem('jetpack', 'Jetpack', {
    back: (x, y) => (Math.abs(x - 0.34) < 0.12 || Math.abs(x - 0.66) < 0.12) && y > 0.06 && y < 0.78,
    straps: true,
  }),
];

// ---------------------------------------------------------------------------
// the wardrobe itself
// ---------------------------------------------------------------------------
//
// ORDER MATTERS and it is the order a person dresses in. Tops before
// outerwear, hair before hats, and the face last so a beard is not painted
// over by a collar. Anything that draws on the outer layer draws after
// everything that draws on the skin underneath it.

export const CATEGORIES = [
  { key: 'hair', name: 'Hair', items: HAIR, colour: 'hair', shows: 'head' },
  { key: 'top', name: 'Tops', items: TOPS, colour: 'shirt', shows: 'torso' },
  { key: 'bottom', name: 'Bottoms', items: BOTTOMS, colour: 'trousers', shows: 'legs' },
  { key: 'outer', name: 'Outerwear', items: OUTERWEAR, colour: 'outer', shows: 'torso' },
  { key: 'headwear', name: 'Headwear', items: HEADWEAR, colour: 'headwear', shows: 'head' },
  { key: 'gloves', name: 'Gloves', items: GLOVES, colour: 'gloves', shows: 'hands' },
  { key: 'footwear', name: 'Footwear', items: FOOTWEAR, colour: 'shoes', shows: 'legs' },
  { key: 'face', name: 'Face Items', items: FACE_ITEMS, colour: 'face', shows: 'head' },
  { key: 'back', name: 'Back Items', items: BACK_ITEMS, colour: 'back', shows: 'torso' },
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
 * already made from the photograph", which is the default for the three the
 * photograph can actually answer.
 */
export function dressUp(skin, wear, ctx) {
  for (const cat of CATEGORIES) {
    const it = item(cat.key, (wear || {})[cat.key]);
    if (!it || !it.draw) continue;
    const chosen = (ctx.colours || {})[cat.colour];
    const colour = chosen ? hexToRgb(chosen)
      : ctx.pal[cat.colour] || hexToRgb(EXTRA_COLOURS[cat.colour] || '#808080');
    it.draw(skin, { ...ctx, colour, cat: cat.key });
  }
}

/** Whether a category has anything on, for the little "worn" dots in the list. */
export function isWorn(wear, key) {
  const id = (wear || {})[key];
  return !!id && id !== 'none' && id !== 'auto';
}
