// A flat front view of the figure, for the wardrobe's thumbnails.
//
// Minecraft's own creator shows each haircut on a little head and each top on
// a little torso, and it is right to: a grid of sixty-fourths of a PNG tells
// you nothing, and rendering a hundred items in three dimensions to fill a
// scrolling grid is a lot of GPU for a picture the size of a postage stamp.
//
// So this is the paper doll — the front faces of the model, laid out the way
// a person stands, drawn straight off the skin's own canvas with smoothing
// off.
//
// The HEAD is drawn as a box rather than a square, and that is not decoration.
// A bob and a crew cut have the same front face; what separates them is what
// hangs down the SIDES. A cap and a beanie have the same band; what separates
// them is the peak, and a peak is on the TOP face. Shown flat, half the
// wardrobe is twenty identical brown rectangles — which is exactly what the
// first version of this grid looked like.

import { parts } from './layout.js';

// where each part's front face goes in a 16 x 32 figure, in sixty-fourths
const PLACE = {
  head: [4, 0, 8, 8],
  body: [4, 8, 8, 12],
  armR: [0, 8, 4, 12],
  armL: [12, 8, 4, 12],
  legR: [4, 20, 4, 12],
  legL: [8, 20, 4, 12],
};

const SIDE = 3.2;      // how much of the head's side and top to show

// what each category wants to show off
export const CROPS = {
  head: [0, -4, 13, 13],
  torso: [-1, -1, 18, 23],
  legs: [2, 17, 12, 16],
  hands: [-1, 11, 18, 12],
  all: [-1, -4, 18, 37],
  back: [-1, -1, 18, 23],
};

/**
 * Draw the figure onto a canvas.
 *
 * The overlay goes on after the base for every part, so a hat covers hair and
 * a jacket covers a shirt — the same order the model renders them in, which
 * is the only way the thumbnail and the figure can agree.
 */
export function drawDoll(ctx, skin, slim = false, crop = CROPS.all, back = false) {
  const [cx, cy, cw, ch] = crop;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const z = Math.min(W / cw, H / ch);
  const ox = (W - cw * z) / 2 - cx * z;
  const oy = (H - ch * z) / 2 - cy * z;
  const src = skin.flush();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);

  const P = {};
  for (const p of parts(slim, skin.size)) P[p.key] = p;

  const put = (rect, dx, dy, dw, dh) => {
    ctx.drawImage(src, rect[0], rect[1], rect[2], rect[3],
      ox + dx * z, oy + dy * z, dw * z, dh * z);
  };

  for (const layer of ['rects', 'overRects']) {
    for (const key of Object.keys(PLACE)) {
      const p = P[key];
      if (!p) continue;
      const R = p[layer];
      let [dx, dy, dw, dh] = PLACE[key];
      // a slim arm is three wide, and its shoulder moves in with it
      if (slim && (key === 'armR' || key === 'armL')) {
        dw = 3;
        if (key === 'armR') dx = 1;
      }
      // the outer layer stands a little proud, which is what makes a hat a
      // hat rather than a repaint
      const g = layer === 'overRects' ? (key === 'head' ? 0.5 : 0.25) : 0;
      if (key === 'head') {
        // the top and one side, so a silhouette is a silhouette
        put(back ? R.left : R.right, dx - SIDE - g, dy - g, SIDE + g, dh + g * 2);
        put(R.top, dx - SIDE - g, dy - SIDE - g, dw + SIDE + g * 2, SIDE + g);
      }
      put(back ? R.back : R.front, dx - g, dy - g, dw + g * 2, dh + g * 2);
    }
  }
}

/** A small canvas with the figure on it, ready to go in a grid. */
export function dollThumb(skin, slim, crop, px = 96, back = false) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  drawDoll(c.getContext('2d'), skin, slim, crop, back);
  return c;
}
