// The man himself, in three dimensions.
//
// A skin is only ever judged wrapped round a body, so the preview is not a
// nicety — it is the only honest view of the thing being made. The 64x64 next
// to it is the working drawing.
//
// The whole file turns on one agreement with `layout.js`: the figure faces
// -Z, so a camera at -Z is a portrait, and his right hand is at +X. Get that
// backwards and everything still renders, inside out, with his parting on
// the wrong side — which is exactly the kind of wrong that survives a dozen
// screenshots because nobody can say why it looks odd.

import * as THREE from 'three';
import { parts, OVER_GROW, BASE } from './layout.js';

const PX = 1 / 16;   // one sixty-fourth of a skin, in world units

// Half a percent of overlap between neighbouring boxes.
//
// Minecraft's parts touch EXACTLY — the body ends where the legs begin — and
// against an opaque world that is invisible. Photographed against nothing,
// which is what the listing shot is, the antialiasing at a shared edge lets
// the background through as a hairline crack down the middle of him. Half a
// percent closes it and is far too small to see anywhere else.
const WELD = 1.005;

// BoxGeometry gives its faces in the order +x, -x, +y, -y, +z, -z. With the
// figure facing -Z that reads: his right, his left, the top, the underneath,
// the back, the front.
const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'back', 'front'];

// A twentieth of a texel, held back from every edge of every rectangle.
//
// Without it the far edge of a face samples at exactly the rectangle's
// boundary, and nearest-neighbour rounds that INTO THE NEXT RECTANGLE — so
// the sleeve's outline is drawn in one column of the trouser leg that
// happens to sit beside it in the image. It shows up as a dashed grey hem
// along one edge of a limb and it is invisible until somebody photographs
// the model against a colour that is not the page.
const BLEED = 0.05;   // in texels; divided by the skin's size below

/**
 * Point one box's faces at their rectangles in the 64x64.
 *
 * The four upright faces take their rectangle the way you would read it. The
 * top and the bottom are turned through half a circle, because Three unwraps
 * a box as though it faced +Z and this one faces the other way. That single
 * flip is the difference between a hat that sits on a head and a hat printed
 * back to front.
 */
function setBoxUV(geo, rects, size) {
  const uv = geo.attributes.uv;
  const e = BLEED / size;
  FACE_ORDER.forEach((face, i) => {
    const [rx, ry, rw, rh] = rects[face];
    const u0 = rx / size + e, u1 = (rx + rw) / size - e;
    const v0 = 1 - ry / size - e, v1 = 1 - (ry + rh) / size + e;
    const tl = [u0, v0], tr = [u1, v0], bl = [u0, v1], br = [u1, v1];
    const turn = face === 'top' || face === 'bottom';
    const c = turn ? [br, bl, tr, tl] : [tl, tr, bl, br];
    for (let k = 0; k < 4; k++) uv.setXY(i * 4 + k, c[k][0], c[k][1]);
  });
  uv.needsUpdate = true;
}

/**
 * Build the figure.
 *
 * Each limb hangs in a group placed at its JOINT, not its middle, so a swing
 * is one rotation and never a rotation plus a correction. The overlay is a
 * second, slightly larger box in the same group — near enough to read as the
 * same body, far enough not to fight it for the same pixel.
 */
export function buildFigure(texture, slim = false, size = BASE) {
  const group = new THREE.Group();
  const made = {};
  const base = new THREE.MeshLambertMaterial({ map: texture });
  const over = new THREE.MeshLambertMaterial({
    map: texture, transparent: true, alphaTest: 0.02, depthWrite: true, side: THREE.DoubleSide,
  });

  for (const p of parts(slim, size)) {
    const [w, h, d] = p.size;
    const joint = new THREE.Group();
    joint.position.set(p.pivot[0] * PX, p.pivot[1] * PX, p.pivot[2] * PX);

    const g = new THREE.BoxGeometry(w * PX * WELD, h * PX * WELD, d * PX * WELD);
    setBoxUV(g, p.rects, size);
    const mesh = new THREE.Mesh(g, base);
    mesh.position.set(
      (p.at[0] - p.pivot[0]) * PX,
      (p.at[1] - p.pivot[1]) * PX,
      (p.at[2] - p.pivot[2]) * PX,
    );
    mesh.userData = { part: p.key, layer: 'base', rects: p.rects, size: p.size };
    joint.add(mesh);

    const grow = OVER_GROW[p.key] || 0.5;
    const g2 = new THREE.BoxGeometry((w + grow) * PX, (h + grow) * PX, (d + grow) * PX);
    setBoxUV(g2, p.overRects, size);
    const shell = new THREE.Mesh(g2, over);
    shell.position.copy(mesh.position);
    shell.renderOrder = 1;
    shell.userData = { part: p.key, layer: 'over', rects: p.overRects, size: p.size };
    joint.add(shell);

    group.add(joint);
    made[p.key] = { joint, mesh, shell, def: p };
  }
  return { group, parts: made, materials: { base, over }, slim, size };
}

/** The texture the figure wears — nearest-neighbour, or it is not pixel art. */
export function skinTexture(skin) {
  const tex = new THREE.CanvasTexture(skin.flush());
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Move him.
 *
 * `walk` is the pose everybody judges a skin in, because it is the pose
 * everybody else's skin is in when you meet them. `spin` turns him on the
 * spot, which is how you notice the back of the head is wrong.
 */
export function pose(fig, t, mode = 'walk') {
  const P = fig.parts;
  const set = (k, x, z = 0) => {
    if (!P[k]) return;
    P[k].joint.rotation.x = x;
    P[k].joint.rotation.z = z;
  };
  if (mode === 'walk') {
    const s = Math.sin(t * 4.6);
    const c = Math.cos(t * 4.6);
    set('legR', s * 0.72);
    set('legL', -s * 0.72);
    set('armR', -s * 0.62, Math.cos(t * 2.3) * 0.05 + 0.05);
    set('armL', s * 0.62, -Math.cos(t * 2.3) * 0.05 - 0.05);
    P.head.joint.rotation.y = Math.sin(t * 1.1) * 0.16;
    P.head.joint.rotation.x = c * 0.02;
    fig.group.position.y = Math.abs(Math.sin(t * 4.6)) * 0.012;
  } else if (mode === 'idle') {
    set('legR', 0); set('legL', 0);
    const b = Math.sin(t * 1.6);
    set('armR', b * 0.06, 0.06 + Math.sin(t * 1.3) * 0.02);
    set('armL', -b * 0.06, -0.06 - Math.sin(t * 1.3) * 0.02);
    P.head.joint.rotation.y = Math.sin(t * 0.5) * 0.22;
    P.head.joint.rotation.x = 0;
    fig.group.position.y = Math.sin(t * 1.6) * 0.004;
  } else {
    for (const k of ['legR', 'legL', 'armR', 'armL']) set(k, 0, k.startsWith('arm') ? (k.endsWith('R') ? 0.04 : -0.04) : 0);
    P.head.joint.rotation.set(0, 0, 0);
    fig.group.position.y = 0;
  }
}

/**
 * A hand-rolled orbit, rather than the one in the addons folder.
 *
 * Two reasons, and the second is the real one: it is one fewer file to have
 * cached before this works on a train, and a phone deserves pinch-to-zoom
 * that does not also try to pan, which is a fight with the stock controls
 * that nobody wins.
 */
export function orbit(dom, camera, target, opts = {}) {
  const state = {
    yaw: opts.yaw === undefined ? Math.PI : opts.yaw,
    pitch: opts.pitch === undefined ? 0.10 : opts.pitch,
    dist: opts.dist === undefined ? 3.4 : opts.dist,
    min: opts.min || 1.4,
    max: opts.max || 9,
    spin: 0,
  };
  const pointers = new Map();
  let lastPinch = 0;

  const apply = () => {
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    camera.position.set(
      target.x + state.dist * cp * Math.sin(state.yaw + state.spin),
      target.y + state.dist * sp,
      target.z + state.dist * cp * Math.cos(state.yaw + state.spin),
    );
    camera.lookAt(target);
  };

  const down = (e) => {
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastPinch = 0;
  };
  const move = (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1 && !state.locked) {
      state.yaw -= (now.x - prev.x) * 0.008;
      state.pitch = Math.max(-1.35, Math.min(1.35, state.pitch + (now.y - prev.y) * 0.006));
    }
    pointers.set(e.pointerId, now);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch) state.dist = Math.max(state.min, Math.min(state.max, state.dist * lastPinch / d));
      lastPinch = d;
    }
    apply();
  };
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinch = 0;
  };
  const wheel = (e) => {
    e.preventDefault();
    state.dist = Math.max(state.min, Math.min(state.max, state.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    apply();
  };

  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', move);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', wheel, { passive: false });
  apply();
  return {
    state,
    apply,
    /** true while a finger or the mouse is down, so painting can stand off */
    busy: () => pointers.size > 0,
    reset() {
      state.yaw = Math.PI; state.pitch = 0.10; state.dist = 3.4; state.spin = 0;
      apply();
    },
  };
}

/**
 * Which texel of the 64x64 is under a click on the figure.
 *
 * The point of this is that a face is easier to fix where you can see it is
 * wrong. Clicking a cheek in the preview and clicking the same cheek in the
 * flat 64x64 are the same edit; only one of them requires knowing that the
 * cheek lives at (11, 12).
 */
export function pickTexel(fig, camera, ndc, layer = 'both') {
  const size = fig.size || BASE;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const meshes = [];
  for (const p of Object.values(fig.parts)) {
    if (layer !== 'over') meshes.push(p.mesh);
    if (layer !== 'base') meshes.push(p.shell);
  }
  const hits = ray.intersectObjects(meshes, false);
  for (const hit of hits) {
    if (!hit.uv) continue;
    const x = Math.floor(hit.uv.x * size);
    const y = Math.floor((1 - hit.uv.y) * size);
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    return { x, y, ...hit.object.userData, point: hit.point };
  }
  return null;
}

/** A scene ready to show a figure in: two lights and nothing else. */
export function scene() {
  const s = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1.55);
  key.position.set(-0.6, 1.1, -1.2);
  s.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(1.0, 0.4, 0.9);
  s.add(fill);
  s.add(new THREE.AmbientLight(0xffffff, 0.72));
  return s;
}
