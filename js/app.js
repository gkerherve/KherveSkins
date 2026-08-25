// The programme itself: what is wired to what.
//
// The shape of it is one loop, and it is worth having in mind before reading
// any of the rest:
//
//     a photograph  ->  a frame (the head box and its two lines)
//                   ->  generate() writes the whole 64x64
//                   ->  anything painted by hand is laid back on top
//                   ->  the figure and the flat image both redraw
//
// Every slider in the app does the same thing: change one number and run
// that loop again. Which is why painting has to survive it — a face you have
// spent five minutes fixing must not be wiped out because you nudged the
// contrast afterwards. `S.edits` is the whole of that promise: a record of
// every texel laid by hand, replayed after every rebuild.

import * as THREE from 'three';
import { Skin, loadImage, rgbToHex } from './pixels.js';
import { Photo, autoFace, heuristicFace } from './photo.js';
import { generate, blank, DEFAULTS } from './generate.js';
import { buildFigure, skinTexture, pose, orbit, pickTexel, scene as makeScene } from './model.js';
import { Cropper } from './cropper.js';
import { Painter } from './paint.js';
import * as store from './store.js';
import { parts, regions, SIZES, BASE } from './layout.js';
import { CATEGORIES, DEFAULT_WEAR, EXTRA_COLOURS } from './wardrobe.js';
import { drawDoll, CROPS } from './doll.js';
import { silhouette, carve, report, headOf } from './carve.js';
import { facesFromViews, primeHeuristic } from './faces3d.js';
import { assignAngles, checkSet } from './turns.js';
import { buildVoxels, previewVolume } from './voxel.js';
import { fitToSkin } from './fit.js';

const $ = (id) => document.getElementById(id);

// the head path wants a frame NOW, and the browser's own face detector is
// asynchronous; ours is not, so hand it over
primeHeuristic(heuristicFace);

const S = {
  photo: null,
  frame: null,
  opts: { ...DEFAULTS, colours: {}, wear: { ...DEFAULT_WEAR } },
  skin: new Skin(BASE),
  base: null,          // an imported skin, when there is no photograph
  edits: new Map(),    // every texel laid by hand: "x,y" -> [r,g,b,a]
  pal: null,
  poseMode: 'idle',
  spin: false,
  modelPaint: false,
  name: 'my-skin',
};

// ---------------------------------------------------------------------------
// the figure
// ---------------------------------------------------------------------------

const stage = $('stage');
const renderer = new THREE.WebGLRenderer({
  antialias: true, alpha: true, preserveDrawingBuffer: true,
});
renderer.setClearAlpha(0);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
stage.appendChild(renderer.domElement);

const scene = makeScene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
const target = new THREE.Vector3(0, 1.02, 0);
const view = orbit(renderer.domElement, camera, target, { dist: 3.6 });

let texture = skinTexture(S.skin);
let fig = buildFigure(texture, S.opts.slim, S.skin.size);
scene.add(fig.group);

/**
 * Throw the figure away and build another.
 *
 * The TEXTURE goes with it, and that is not tidiness. A canvas that changes
 * size under a Three texture does not reliably reach the card again — the
 * geometry gets its new UVs, the picture stays the old one, and a 256 skin
 * renders as the same eight blocks it had at 64. One fresh texture per
 * rebuild costs nothing and cannot be wrong.
 */
function rebuildFigure() {
  scene.remove(fig.group);
  fig.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  for (const m of Object.values(fig.materials)) m.dispose();
  texture.dispose();
  texture = skinTexture(S.skin);
  fig = buildFigure(texture, S.opts.slim, S.skin.size);
  scene.add(fig.group);
}

function fitStage() {
  const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(fitStage).observe(stage);
fitStage();

/**
 * Where he is looking.
 *
 * The pointer, wherever it is on the page — and worked out properly rather
 * than by mapping the mouse's x to a yaw, because the figure turns. A point
 * is unprojected from the cursor into the world, the direction from his head
 * to that point is taken, and the head is aimed along it; so when you spin
 * him round to look at his back, he keeps watching you over his shoulder
 * instead of snapping to some fixed screen direction.
 *
 * Eased rather than snapped. A head that arrives instantly reads as a
 * mechanism; one that takes a fifth of a second reads as attention.
 */
// Where he looks when nothing is asking him to look anywhere: level, at the
// viewer. Screen centre is his CHEST — the camera frames the whole figure —
// so resting the gaze there has him studying his own shirt.
const REST = new THREE.Vector2(0, 0.42);
const gaze = { want: REST.clone(), at: REST.clone(), on: true };
const gazePoint = new THREE.Vector3();
const headAt = new THREE.Vector3();

addEventListener('pointermove', (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  gaze.want.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
});
// the pointer gone from the window is not the pointer at the top left corner
addEventListener('pointerout', (e) => { if (!e.relatedTarget) gaze.want.copy(REST); });
addEventListener('blur', () => gaze.want.copy(REST));

function aimHead() {
  if (!gaze.on || !fig.parts.head) return;
  gaze.at.lerp(gaze.want, 0.16);
  // Along the cursor's ray, at ROUGHLY THE FIGURE'S OWN DISTANCE. Unproject
  // to any old depth and the point ends up far down the view axis, where the
  // corner of the screen and the middle of it are nearly the same direction
  // — and he stares straight ahead however far the pointer moves.
  gazePoint.set(gaze.at.x, gaze.at.y, 0.5).unproject(camera)
    .sub(camera.position).normalize().multiplyScalar(view.state.dist * 0.85)
    .add(camera.position);
  fig.parts.head.joint.getWorldPosition(headAt);
  const dx = gazePoint.x - headAt.x;
  const dy = gazePoint.y - headAt.y;
  const dz = gazePoint.z - headAt.z;
  const flat = Math.hypot(dx, dz) || 1e-4;
  // he faces -Z, so a yaw of nought already looks the way -Z points
  let yaw = Math.atan2(-dx, -dz);
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  // Rotating a head that faces -Z about +X by a POSITIVE angle tips its face
  // upward. So the pointer below the head — dy negative — wants a negative
  // rotation, which is the angle itself and not its negation. Getting this
  // backwards is not subtle: he looks at the ceiling when you point at the
  // floor.
  const pitch = Math.atan2(dy, flat);
  const clamp = (v, m) => (v < -m ? -m : v > m ? m : v);
  fig.parts.head.joint.rotation.y = clamp(yaw, 1.15);
  fig.parts.head.joint.rotation.x = clamp(pitch * 0.85, 0.45);
}

let t0 = performance.now();
renderer.setAnimationLoop(() => {
  const t = (performance.now() - t0) / 1000;
  pose(fig, t, S.poseMode);
  aimHead();
  if (S.spin) { view.state.spin += 0.012; view.apply(); }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// the loop: rebuild, then lay the hand-painting back on
// ---------------------------------------------------------------------------

let queued = false;
function queueRebuild() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; rebuild(); });
}

function rebuild() {
  if (S.photo && S.frame) {
    S.pal = generate(S.skin, S.photo, S.frame, S.opts);
  } else if (S.base) {
    S.skin.restore(S.base);
    S.pal = null;
  } else {
    S.pal = blank(S.skin, S.opts);
  }
  replay();
  refresh();
  drawSwatches();
}

/** Every texel somebody laid by hand, put back where they put it. */
function replay() {
  for (const [key, c] of S.edits) {
    const [x, y] = key.split(',');
    S.skin.set(+x, +y, c);
  }
}

function refresh() {
  S.skin.flush();
  texture.needsUpdate = true;
  if (painter) painter.redraw();
}

function noteEdit(x, y, c) {
  S.edits.set(`${x},${y}`, c.slice ? c.slice() : [...c]);
}

// ---------------------------------------------------------------------------
// the photograph
// ---------------------------------------------------------------------------

const crop = $('crop');
const cropper = new Cropper(crop, (f) => {
  S.frame = f;
  $('tilt').value = f.tilt.toFixed(2);
  $('tiltOut').textContent = f.tilt.toFixed(2);
  queueRebuild();
});

function say(id, msg, cls = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `say ${cls}`;
}

async function takePhoto(fileOrUrl) {
  try {
    say('photoSay', 'reading…');
    const img = await loadImage(fileOrUrl);
    S.photo = new Photo(img);
    S.base = null;
    cropper.setPhoto(S.photo);
    S.frame = await autoFace(S.photo);
    cropper.setFrame(S.frame);
    $('dropNote').style.display = 'none';
    $('tilt').value = S.frame.tilt.toFixed(2);
    $('tiltOut').textContent = S.frame.tilt.toFixed(2);
    rebuild();
    say('photoSay', 'found a head — check the box and the two lines', 'good');
  } catch (e) {
    say('photoSay', e.message || 'could not read that', 'bad');
  }
}

$('pickBtn').onclick = () => $('fileIn').click();
$('camBtn').onclick = () => $('camIn').click();
$('fileIn').onchange = (e) => e.target.files[0] && takePhoto(e.target.files[0]);
$('camIn').onchange = (e) => e.target.files[0] && takePhoto(e.target.files[0]);

addEventListener('dragover', (e) => { e.preventDefault(); });
addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer.files || [])].filter((x) => x.type.startsWith('image/'));
  if (!files.length) return;
  // more than one picture, or the 3D tab already open, means a capture; one
  // picture on any other tab means a portrait
  const onThree = document.querySelector('.panel[data-panel="three"]').classList.contains('on');
  if (files.length > 1 || onThree) {
    showTab('three');
    $('howto').hidden = true;
    $('capture').hidden = false;
    addTurns(files);
  } else {
    showTab('photo');
    takePhoto(files[0]);
  }
});
addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
  if (item) { showTab('photo'); takePhoto(item.getAsFile()); }
});

$('autoBtn').onclick = async () => {
  if (!S.photo) return say('photoSay', 'no photograph yet', 'bad');
  S.frame = await autoFace(S.photo);
  cropper.setFrame(S.frame);
  rebuild();
  say('photoSay', 'looked again', 'good');
};

$('resetFrameBtn').onclick = () => {
  if (!S.photo) return;
  const side = Math.min(S.photo.w, S.photo.h) * 0.5;
  const box = { x: S.photo.w / 2 - side / 2, y: S.photo.h * 0.40 - side / 2, w: side, h: side * 1.15 };
  S.frame = { ...box, eye: box.y + box.h * 0.56, mouth: box.y + box.h * 0.80, tilt: 0 };
  cropper.setFrame(S.frame);
  rebuild();
};

$('tilt').oninput = (e) => {
  if (!S.frame) return;
  S.frame.tilt = +e.target.value;
  $('tiltOut').textContent = (+e.target.value).toFixed(2);
  cropper.draw();
  queueRebuild();
};

// ---------------------------------------------------------------------------
// the sliders
// ---------------------------------------------------------------------------

function slider(id, key, fmt) {
  const el = $(id), out = $(`${id}Out`);
  if (!el) return null;
  el.value = S.opts[key];
  const show = () => { out.textContent = fmt ? fmt(+el.value) : String(+el.value); };
  show();
  el.addEventListener('input', () => {
    S.opts[key] = +el.value;
    show();
    queueRebuild();
    keepPrefs();
  });
  return el;
}

for (const [id, key] of [
  ['eyeRow', 'eyeRow'], ['mouthRow', 'mouthRow'], ['zoomX', 'zoomX'],
  ['shiftX', 'shiftX'], ['shiftY', 'shiftY'],
  ['bright', 'bright'], ['contrast', 'contrast'], ['satur', 'satur'],
  ['warmth', 'warmth'], ['detail', 'detail'], ['features', 'features'],
]) slider(id, key);
slider('levels', 'levels', (v) => (v ? String(v) : 'off'));

/**
 * How finely the whole skin is painted.
 *
 * This is the one control that changes what the tool can DO rather than what
 * it makes. At 64 a face is eight pixels across and the answer is a
 * suggestion of somebody; at 256 it is thirty-two and it is a portrait. The
 * cost is that only 64 goes into vanilla Java — so the export offers both,
 * and the note under the buttons says so rather than letting anybody find
 * out at the upload page.
 */
function setSize(n) {
  if (n === S.skin.size) return;
  const k = n / S.skin.size;
  // hand-painting comes with it: one texel becomes a block of them going up,
  // and going down a block becomes one. Anybody who has fixed an eye and then
  // asked for more pixels wants their eye still there.
  const next = new Map();
  for (const [key, c] of S.edits) {
    const [x, y] = key.split(',').map(Number);
    if (k >= 1) {
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) next.set(`${x * k + i},${y * k + j}`, c);
      }
    } else {
      next.set(`${Math.floor(x * k)},${Math.floor(y * k)}`, c);
    }
  }
  S.edits = next;
  S.opts.size = n;
  S.skin.resize(n);
  if (S.base) S.base = S.skin.snapshot();
  painter.size = n;
  rebuildFigure();
  rebuild();
  painter.fit();
  drawSizes();
  fillParts();
  refreshTwigs();
  keepPrefs();
}

function drawSizes() {
  const host = $('sizes');
  if (!host) return;                 // the Style branch is not open
  host.textContent = '';
  for (const n of SIZES) {
    const b = document.createElement('button');
    b.textContent = `${n}×${n}`;
    b.classList.toggle('on', n === S.skin.size);
    b.onclick = () => setSize(n);
    host.appendChild(b);
  }
  if ($('sizeNote')) $('sizeNote').textContent = S.skin.size === BASE
    ? 'A face eight pixels across. The only size vanilla Java takes.'
    : `A face ${S.skin.size / 8} pixels across. Bedrock skin packs take this; `
      + 'vanilla Java does not, so the export offers a 64×64 as well.';
  const dl64 = $('dl64Btn');
  if (dl64) dl64.style.display = S.skin.size === BASE ? 'none' : '';
}

function setSlim(slim) {
  S.opts.slim = !!slim;
  $('slimBtn').textContent = S.opts.slim ? 'slim arms' : 'classic arms';
  $('slimBtn').classList.toggle('on', S.opts.slim);
  painter.slim = S.opts.slim;
  rebuildFigure();
  rebuild();
  fillParts();
  keepPrefs();
}
$('slimBtn').onclick = () => setSlim(!S.opts.slim);

$('poseBtn').onclick = () => {
  S.poseMode = S.poseMode === 'idle' ? 'walk' : S.poseMode === 'walk' ? 'still' : 'idle';
  $('poseBtn').textContent = S.poseMode === 'walk' ? 'walking'
    : S.poseMode === 'idle' ? 'standing' : 'still';
};
$('lookBtn').onclick = (e) => {
  gaze.on = !gaze.on;
  e.target.classList.toggle('on', gaze.on);
  if (!gaze.on) fig.parts.head.joint.rotation.set(0, 0, 0);
};
$('spinBtn').onclick = (e) => { S.spin = !S.spin; e.target.classList.toggle('on', S.spin); };
$('frontBtn').onclick = () => view.reset();
$('modelPaintBtn').onclick = (e) => {
  S.modelPaint = !S.modelPaint;
  e.target.classList.toggle('on', S.modelPaint);
  $('stageInfo').textContent = S.modelPaint
    ? 'tap him to paint · drag to turn'
    : 'drag to turn · pinch or scroll to zoom';
};

// ---------------------------------------------------------------------------
// the colours the photograph gave us
// ---------------------------------------------------------------------------

const SWATCH_ROWS = [
  ['hair', 'hair'], ['skin', 'complexion'], ['shirt', 'shirt'],
  ['trousers', 'trousers'], ['shoes', 'shoes'],
];
const WHENCE = {
  photo: 'read off the photograph',
  yours: 'yours',
  made: 'not in the photograph — invented',
};

function drawSwatches() {
  const host = $('swatches');
  if (!host) return;                 // the Style branch is not open
  host.textContent = '';
  for (const [key, label] of SWATCH_ROWS) {
    const chosen = S.opts.colours[key];
    const cur = chosen || (S.pal && S.pal[key] ? rgbToHex(S.pal[key]) : '#888888');
    const whence = chosen ? 'yours' : (S.pal && S.pal.src ? S.pal.src[key] : 'made');
    const row = document.createElement('div');
    row.className = 'swatch';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = cur;
    const who = document.createElement('span');
    who.className = 'who';
    who.innerHTML = `${label}<small>${WHENCE[whence] || ''}</small>`;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = cur;
    input.oninput = () => { S.opts.colours[key] = input.value; rebuild(); keepPrefs(); };
    const undo = document.createElement('button');
    undo.className = 'small';
    undo.textContent = '↺';
    undo.title = 'back to what the photograph said';
    undo.style.flex = 'none';
    undo.onclick = () => { delete S.opts.colours[key]; rebuild(); keepPrefs(); };
    row.append(chip, who, input, undo);
    host.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// the guided capture, and the carve
// ---------------------------------------------------------------------------
//
// Four photographs, taken to a script, and out of them the person's actual
// shape. The script is not decoration: shape-from-silhouette assumes one
// still camera and one axis of rotation, so every instruction on that card is
// load-bearing, and the checks after each shot are there because a capture
// that has gone wrong is much cheaper to notice now than after the carve.

/**
 * The turns.
 *
 * Four is the minimum a hull needs and EIGHT is what makes it look like a
 * person. Two reasons, and the second is the one you can see: with four
 * views the cross-section of every carve is a square, so a shoulder comes
 * out with corners on it; and every extra outline is another chance for a
 * cube to be voted back in when one shot has a bad edge.
 *
 * The four squares are asked for first because they are the ones that
 * matter; the four diagonals are offered after, as the thing that turns a
 * decent carve into a good one.
 */
/**
 * The capture, as a bag of photographs rather than a list of slots.
 *
 * Nine named slots was the wrong shape for a method that gets better with
 * every extra view. Hand it twenty at once, in the order they were taken, and
 * let `turns.js` work out what angle each one is: the sequence is the turn,
 * the one with the most face in it is the front, and everything else follows.
 */
const cap = {
  plate: null,
  turns: [],        // { photo, sil, thumb, name }
  angles: [],       // the same, with an angle on each
  front: -1,        // -1 means "you work it out"
  flip: undefined,
  vol: null,
  mesh: null,
  wanted: null,
  headOnly: false,
  faceTouched: false,
};

/**
 * A thumbnail with the outline the program FOUND drawn on it.
 *
 * The single most useful thing in this tab. A capture that has gone wrong is
 * invisible in the photograph and obvious the moment you see what was taken
 * to be a person — a shadow at the feet, half a wall, a missing head. Without
 * this, a bad carve is a mystery; with it, it is a glance.
 */
function thumbOf(photo, sil) {
  const c = document.createElement('canvas');
  c.width = 108; c.height = 144;
  const cx = c.getContext('2d');
  cx.drawImage(photo.canvas, 0, 0, c.width, c.height);
  if (!sil) return c.toDataURL('image/png');
  const img = cx.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const sx = Math.min(sil.mw - 1, Math.round(x * sil.mw / c.width));
      const sy = Math.min(sil.mh - 1, Math.round(y * sil.mh / c.height));
      if (sil.mask[sy * sil.mw + sx]) continue;
      const k = (y * c.width + x) * 4;
      const g = (img.data[k] + img.data[k + 1] + img.data[k + 2]) / 3;
      img.data[k] = g * 0.30 + 10;
      img.data[k + 1] = g * 0.32 + 14;
      img.data[k + 2] = g * 0.38 + 24;
    }
  }
  cx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Work out every silhouette again — which the plate arriving changes. */
function reread() {
  const plate = cap.plate ? cap.plate.photo : null;
  for (const t of cap.turns) {
    t.sil = silhouette(t.photo, plate);
    t.thumb = thumbOf(t.photo, t.sil);
  }
  cap.angles = assignAngles(cap.turns, { front: cap.front, flip: cap.flip });
  drawShots();
}

function drawShots() {
  const prow = $('plateRow');
  prow.textContent = '';
  if (cap.plate) {
    const cell = document.createElement('div');
    cell.className = 'shot done';
    const img = document.createElement('img');
    img.src = cap.plate.thumb;
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = 'the empty room';
    const kill = document.createElement('button');
    kill.className = 'kill';
    kill.textContent = '×';
    kill.onclick = () => { cap.plate = null; reread(); };
    cell.append(img, who, kill);
    prow.appendChild(cell);
  }

  const host = $('shots');
  host.textContent = '';
  cap.angles.forEach((t, i) => {
    const cell = document.createElement('div');
    cell.className = `shot done${t.front ? ' front' : ''}`;
    const img = document.createElement('img');
    img.src = t.thumb;
    const deg = document.createElement('div');
    deg.className = 'deg';
    deg.textContent = t.front ? 'front' : `${Math.round(t.angle)}°`;
    const kill = document.createElement('button');
    kill.className = 'kill';
    kill.textContent = '×';
    kill.onclick = (e) => {
      e.stopPropagation();
      cap.turns.splice(i, 1);
      if (cap.front >= cap.turns.length) cap.front = -1;
      reread();
    };
    cell.append(img, deg, kill);
    cell.title = `${t.name} — tap to make this the front`;
    cell.onclick = () => { cap.front = i; reread(); };
    host.appendChild(cell);
  });

  const n = cap.turns.length;
  $('buildBtn').disabled = n < 3;
  $('dirRow').hidden = n < 3;
  $('flipBtn').textContent = cap.flip ? '⟲ the other way' : '⟳ as taken';
  if (!n) {
    say('capSay', '', '');
  } else {
    const chk = checkSet(cap.angles);
    const notes = [...chk.notes];

    // A plate of a different shape is not a plate. Every pixel is compared
    // against the wrong pixel, the whole frame comes back as a person, and the
    // carve is a block — with nothing on screen to say why. Cheap to catch.
    if (cap.plate) {
      const p = cap.plate.photo;
      const odd = cap.turns.some((t) => Math.abs(
        (t.photo.w / t.photo.h) - (p.w / p.h)) > 0.04);
      if (odd) notes.unshift('the empty room is a different shape from the turns — '
        + 'it has to be the same camera, held the same way');
    }

    // Head and shoulders? Then there is no body to carve, and saying so beats
    // handing back a Minecraft man whose legs were guessed from a chin.
    if (!cap.faceTouched) {
      const was = $('faceOnly').checked;
      $('faceOnly').checked = chk.portrait;
      if (chk.portrait && !was) {
        notes.unshift('these are head-and-shoulders photographs, so'
          + ' “just the head” is on — untick it if you meant the whole man');
      }
    }
    say('capSay', `${n} photograph${n === 1 ? '' : 's'}`
      + (notes.length ? ` — ${notes.join('; ')}` : ', and they look usable'),
    notes.length ? '' : 'good');
  }
}

/** Read a pile of files in, one after another, without locking the page up. */
async function addTurns(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, {
    numeric: true, sensitivity: 'base',
  }));
  say('capSay', `reading ${list.length}…`);
  for (const f of list) {
    try {
      const img = await loadImage(f);
      // Smaller than a face photograph on purpose. The carve is seventy-odd
      // cubes tall, so nothing here needs a thousand pixels — and twenty
      // photographs at full size is a hundred and thirty megabytes of image
      // data on a phone, which is where an app is killed rather than slowed.
      cap.turns.push({ photo: new Photo(img, 680), name: f.name || `photo ${cap.turns.length + 1}` });
    } catch { /* not an image this browser can read */ }
    await new Promise((r) => setTimeout(r, 0));
  }
  cap.front = -1;
  cap.flip = undefined;
  reread();
}

async function setPlate(file) {
  try {
    const img = await loadImage(file);
    const photo = new Photo(img, 680);
    cap.plate = { photo, thumb: thumbOf(photo, null) };
    reread();
    say('capSay', 'the room is on file — every outline just got sharper', 'good');
  } catch (e) {
    say('capSay', e.message || 'could not read that', 'bad');
  }
}

$('startCap').onclick = () => {
  $('howto').hidden = true;
  $('capture').hidden = false;
  $('built').hidden = true;
  drawShots();
};
$('plateBtn').onclick = () => $('plateIn').click();
$('plateCam').onclick = () => $('plateCamIn').click();
$('turnsBtn').onclick = () => $('turnsIn').click();
$('turnsCam').onclick = () => $('turnsCamIn').click();
$('plateIn').onchange = (e) => { if (e.target.files[0]) setPlate(e.target.files[0]); e.target.value = ''; };
$('plateCamIn').onchange = (e) => { if (e.target.files[0]) setPlate(e.target.files[0]); e.target.value = ''; };
$('turnsIn').onchange = (e) => { addTurns(e.target.files); e.target.value = ''; };
$('turnsCamIn').onchange = (e) => { addTurns(e.target.files); e.target.value = ''; };
$('flipBtn').onclick = () => {
  cap.flip = !cap.flip;
  reread();
};
$('capReset').onclick = () => {
  cap.plate = null;
  cap.turns = [];
  cap.angles = [];
  cap.front = -1;
  cap.flip = undefined;
  cap.vol = null;
  cap.faceTouched = false;
  $('faceOnly').checked = false;
  drawShots();
  say('capSay', '', '');
};
$('againBtn').onclick = () => { $('built').hidden = true; $('capture').hidden = false; };

$('faceOnly').onchange = () => { cap.faceTouched = true; };

$('buildBtn').onclick = () => {
  cap.headOnly = $('faceOnly').checked;
  const whole = cap.angles
    .filter((t) => t.sil && t.sil.area > 0.008)
    .map((t) => ({ photo: t.photo, sil: t.sil, angle: t.angle, name: t.name }));
  if (whole.length < 3) {
    say('capSay', 'three usable photographs at least — a front, a side and a back', 'bad');
    return;
  }
  cap.whole = whole;
  // Head only: the same outlines, cut off at the neck. Nothing else changes —
  // the volume is simply hung on a head's height instead of a person's, so
  // every cube it has goes on the part anybody recognises.
  const views = cap.headOnly
    ? whole.map((v) => ({ ...v, sil: headOf(v.sil) }))
    : whole;
  say('capSay', `carving from ${views.length}…`);
  // a head is wider for its height than a body is, so the block it is carved
  // out of is a different shape
  const vol = cap.headOnly
    ? carve(views, { ny: 56, nx: 52, nz: 52 })
    : carve(views, { ny: 76, nx: 44, nz: 44 });
  const rep = report(views, vol);
  cap.vol = vol;
  $('capture').hidden = true;
  $('built').hidden = false;
  $('spinVol').value = 20;
  previewVolume($('volView'), vol, 20 * Math.PI / 180);
  $('builtTitle').textContent = cap.headOnly ? 'Your head, in cubes' : 'You, in cubes';
  $('toMcBtn').textContent = cap.headOnly
    ? 'Put this head on him' : 'Turn this into a Minecraft man';
  $('toMcNote').textContent = cap.headOnly
    ? 'The six squares of the head are taken straight from the photographs — the '
      + 'one shot most nearly square-on to each — rather than through the cubes, '
      + 'which would blur them twice. Everything below the neck is left as it is.'
    : '';
  const cubes = vol.count();
  say('builtSay', rep.notes.length
    ? `${cubes} cubes from ${views.length} photographs — but: ${rep.notes.join('; ')}`
    : `${cubes} cubes, from ${views.length} photographs`,
  rep.notes.length ? '' : 'good');
};

$('spinVol').oninput = (e) => {
  $('spinVolOut').textContent = e.target.value;
  if (cap.vol) previewVolume($('volView'), cap.vol, (+e.target.value) * Math.PI / 180);
};

/** Stand the carved person next to the figure, or take them away again. */
$('showVolBtn').onclick = () => {
  if (cap.mesh) {
    scene.remove(cap.mesh.mesh);
    cap.mesh.dispose();
    cap.mesh = null;
    fig.group.position.x = 0;
    $('showVolBtn').textContent = 'Show it beside the figure';
    return;
  }
  if (!cap.vol) return;
  cap.mesh = buildVoxels(cap.vol, { height: 2 });
  cap.mesh.mesh.position.x = 0.7;
  fig.group.position.x = -0.7;
  scene.add(cap.mesh.mesh);
  $('showVolBtn').textContent = 'Take it away';
};

/**
 * The carved person, made into a Minecraft man.
 *
 * This is where the two halves of the program meet: everything downstream —
 * the wardrobe, the painter, the export — works on a skin, and out of here
 * comes a skin like any other.
 */
$('toMcBtn').onclick = () => {
  if (!cap.vol) return;

  // --- the head on its own -------------------------------------------------
  //
  // Kept as hand-painting rather than replacing the skin, because that is
  // exactly what it is: texels somebody put there deliberately, which have to
  // survive every later rebuild the same way a brush stroke does. The body
  // keeps its photograph, its clothes and its colours.
  if (cap.headOnly) {
    const used = facesFromViews(S.skin, cap.whole, { ...S.opts, slim: S.opts.slim });
    if (!used) { say('builtSay', 'could not find a head in those', 'bad'); return; }
    const head = parts(S.opts.slim, S.skin.size).find((p) => p.key === 'head');
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back']) {
      for (const rect of [head.rects[face], head.overRects[face]]) {
        for (let v = 0; v < rect[3]; v++) {
          for (let u = 0; u < rect[2]; u++) {
            noteEdit(rect[0] + u, rect[1] + v, S.skin.get(rect[0] + u, rect[1] + v));
          }
        }
      }
    }
    refresh();
    showTab('paint');
    const where = Object.entries(used)
      .map(([f, w]) => `${f} ${w.off}° off`).join(', ');
    say('builtSay', `head done — ${where}`, 'good');
    return;
  }

  // --- the whole man -------------------------------------------------------
  S.photo = null;
  S.frame = null;
  S.edits.clear();
  cropper.setPhoto(null);
  cropper.setFrame(null);
  $('dropNote').style.display = '';
  const L = fitToSkin(S.skin, cap.vol, {
    slim: S.opts.slim,
    skinTone: S.pal && S.pal.skin ? S.pal.skin : null,
  });
  const armNote = L.fusedArms
    ? ' — your arms were against your sides, so they have been placed by '
      + 'proportion; hold them a little clear and they will be measured'
    : '';
  S.base = S.skin.snapshot();
  S.pal = null;
  refresh();
  drawSwatches();
  refreshTwigs();
  showTab('paint');
  say('builtSay',
    `made — neck at ${L.neck}, hips at ${L.hip} of ${L.height} cubes tall${armNote}`,
    L.fusedArms ? '' : 'good');
};

// ---------------------------------------------------------------------------
// the wardrobe
// ---------------------------------------------------------------------------
//
// Two screens, like Minecraft's own: a list of categories, and a grid of
// things inside one of them. The grid's pictures are built HERE rather than
// stored, because every item is a function and a hundred stored PNGs would be
// a hundred things to keep in step with the code that draws them.

const thumbCache = new Map();

/** What the thumbnails should be built against: the wearer, not a mannequin. */
function thumbKey() {
  const c = S.opts.colours || {};
  return [S.opts.slim, rgbOf('skin'), rgbOf('hair'), rgbOf('shirt'), rgbOf('trousers'),
    rgbOf('shoes'), c.outer, c.headwear, c.gloves, c.face, c.back].join('|');
}

function rgbOf(key) {
  const chosen = (S.opts.colours || {})[key];
  if (chosen) return chosen;
  return S.pal && S.pal[key] ? rgbToHex(S.pal[key]) : '';
}

/**
 * One item's picture.
 *
 * Built on a 64 whatever the working size is — it is forty pixels on screen
 * and nobody is counting texels in it — and against the palette in use, so
 * the hair in the grid is YOUR hair colour and choosing between two of them
 * is a fair comparison.
 */
function thumbFor(cat, it) {
  const key = `${thumbKey()}|${cat.key}|${it.id}`;
  const had = thumbCache.get(key);
  if (had) return had;
  const s = new Skin(BASE);
  const wear = { ...S.opts.wear, [cat.key]: it.id };
  // Whatever would COVER the thing being chosen comes off first. A hood is
  // outerwear and it sits on the head, so a coat left on turns fifty
  // haircuts into fifty identical hoods — which is exactly what it did.
  if (cat.shows === 'head') wear.outer = 'none';
  if (cat.key === 'hair') { wear.headwear = 'none'; wear.face = 'none'; }
  if (cat.key === 'headwear') wear.face = 'none';
  if (cat.key === 'top') { wear.outer = 'none'; wear.back = 'none'; }
  if (cat.key === 'bottom') wear.footwear = 'none';
  if (cat.key === 'gloves') wear.outer = 'none';
  blank(s, {
    ...S.opts, size: BASE, wear, grain: 0.12,
    colours: {
      ...S.opts.colours,
      hair: rgbOf('hair') || '#40342a',
      skin: rgbOf('skin') || '#e0ac7e',
      shirt: rgbOf('shirt') || '#3b6ea5',
      trousers: rgbOf('trousers') || '#33405e',
      shoes: rgbOf('shoes') || '#2b2521',
    },
  });
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  drawDoll(c.getContext('2d'), s, S.opts.slim, CROPS[cat.shows] || CROPS.all, cat.key === 'back');
  const url = c.toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}

/**
 * The wardrobe, as a tree.
 *
 * Every category is a branch you open in place rather than a page you go to
 * and come back from — so a haircut and a hat can be open at once, and
 * choosing between them does not mean two taps of navigation each time. What
 * is open is remembered, because the thing you were fiddling with is the
 * thing you want to still be fiddling with after a rebuild.
 */
const openBranches = new Set(['hair']);

function drawTree() {
  const host = $('tree');
  host.textContent = '';
  host.appendChild(branch({
    key: '__style',
    name: 'Style',
    value: () => `${S.skin.size}px · ${S.opts.slim ? 'slim' : 'classic'}`,
    body: styleBody,
  }));
  for (const cat of CATEGORIES) {
    host.appendChild(branch({
      key: cat.key,
      name: cat.name,
      cat,
      value: () => {
        const id = (S.opts.wear || {})[cat.key];
        if (!id || id === 'auto') return 'from the photo';
        const it = cat.items.find((x) => x.id === id);
        return it ? it.name : 'none';
      },
      body: () => rackBody(cat),
    }));
  }
}

function branch(spec) {
  const wrap = document.createElement('div');
  wrap.className = `branch${openBranches.has(spec.key) ? ' open' : ''}`;
  wrap.dataset.key = spec.key;

  const head = document.createElement('button');
  head.className = 'twig';
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '\u25B8';
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = spec.name;
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = spec.value();
  head.append(caret, nm, val);
  if (spec.cat) {
    const dot = document.createElement('span');
    dot.className = 'swatchdot';
    dot.style.background = rgbOf(spec.cat.colour) || EXTRA_COLOURS[spec.cat.colour] || '#888';
    head.appendChild(dot);
  }

  const leafy = document.createElement('div');
  leafy.className = 'leafy';

  head.onclick = () => {
    const open = wrap.classList.toggle('open');
    if (open) {
      openBranches.add(spec.key);
      if (!leafy.childElementCount) leafy.appendChild(spec.body());
    } else {
      openBranches.delete(spec.key);
    }
  };
  if (openBranches.has(spec.key)) leafy.appendChild(spec.body());

  wrap.append(head, leafy);
  return wrap;
}

/** Refresh only the little grey labels, without closing anything. */
function refreshTwigs() {
  for (const wrap of document.querySelectorAll('#tree .branch')) {
    const key = wrap.dataset.key;
    const val = wrap.querySelector('.val');
    const dot = wrap.querySelector('.swatchdot');
    if (key === '__style') {
      val.textContent = `${S.skin.size}px · ${S.opts.slim ? 'slim' : 'classic'}`;
      continue;
    }
    const cat = CATEGORIES.find((c) => c.key === key);
    if (!cat) continue;
    const id = (S.opts.wear || {})[key];
    const it = cat.items.find((x) => x.id === id);
    val.textContent = !id || id === 'auto' ? 'from the photo' : (it ? it.name : 'none');
    if (dot) dot.style.background = rgbOf(cat.colour) || EXTRA_COLOURS[cat.colour] || '#888';
  }
}

function styleBody() {
  const node = $('styleTpl').content.firstElementChild.cloneNode(true);
  // the controls inside are wired by id, so they have to be in the document
  // before anything looks for them
  // a timer rather than an animation frame: frames do not tick in a hidden
  // tab or in a headless check, and a control that is only wired up when
  // something happens to repaint is a control that is sometimes dead
  setTimeout(() => {
    wireStyle();
    drawSizes();
    drawSwatches();
  }, 0);
  return node;
}

function rackBody(cat) {
  const wrap = document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'rackbar';
  const note = document.createElement('span');
  note.textContent = `${cat.items.length} to choose from`;
  const colour = document.createElement('input');
  colour.type = 'color';
  colour.title = 'colour';
  colour.value = rgbOf(cat.colour) || EXTRA_COLOURS[cat.colour] || '#888888';
  colour.oninput = () => {
    S.opts.colours[cat.colour] = colour.value;
    rebuild();
    fillGrid(grid, cat);
    refreshTwigs();
    keepPrefs();
  };
  bar.append(note, colour);
  const grid = document.createElement('div');
  grid.className = 'grid';
  wrap.append(bar, grid);
  fillGrid(grid, cat);
  return wrap;
}

/**
 * Fill one rack.
 *
 * The pictures are built a few at a time across animation frames rather than
 * all at once. Fifty haircuts is fifty little skins generated and drawn, and
 * done in one go that is half a second in which nothing on the page responds
 * — which reads as the app having crashed rather than as it thinking.
 */
function fillGrid(grid, cat) {
  grid.textContent = '';
  const chosen = (S.opts.wear || {})[cat.key];
  const list = [...cat.items];
  if (['top', 'bottom', 'footwear', 'hair'].includes(cat.key)) {
    list.unshift({ id: 'auto', name: 'From the photo' });
  }
  const cells = list.map((it) => {
    const cell = document.createElement('div');
    cell.className = `wear${it.id === chosen ? ' on' : ''}`;
    const img = document.createElement('img');
    img.alt = it.name;
    img.width = 64;
    img.height = 64;
    const b = document.createElement('b');
    b.textContent = it.name;
    cell.append(img, b);
    cell.onclick = () => {
      S.opts.wear = { ...S.opts.wear, [cat.key]: it.id };
      rebuild();
      for (const other of grid.children) other.classList.remove('on');
      cell.classList.add('on');
      refreshTwigs();
      keepPrefs();
    };
    grid.appendChild(cell);
    return { it, img };
  });
  // A token rather than `grid.isConnected`: this runs while the rack is still
  // being BUILT, before it has been put in the document, so "is it attached"
  // is false on the first pass and the loop stops after five pictures. The
  // token answers the question actually being asked — is this still the fill
  // that grid wants, or has something refilled it since.
  const token = String(Date.now()) + Math.random();
  grid.dataset.fill = token;
  let i = 0;
  const chunk = () => {
    if (grid.dataset.fill !== token) return;
    const until = Math.min(i + 5, cells.length);
    for (; i < until; i++) cells[i].img.src = thumbFor(cat, cells[i].it);
    if (i < cells.length) setTimeout(chunk, 0);
  };
  chunk();
}

let styleWired = false;
function wireStyle() {
  if (styleWired || !$('photoBody')) return;
  styleWired = true;
  for (const [id, key] of [['sleeve', 'sleeve'], ['boot', 'boot'],
    ['shading', 'shading'], ['grain', 'grain']]) slider(id, key);
  $('hairLayer').onchange = (e) => { S.opts.hairLayer = e.target.checked; queueRebuild(); keepPrefs(); };
  $('ears').onchange = (e) => { S.opts.ears = e.target.checked; queueRebuild(); keepPrefs(); };
  $('reseedBtn').onclick = () => { S.opts.seed = (Math.random() * 1e6) | 0; rebuild(); };
  $('photoBody').onchange = (e) => { S.opts.photoBody = e.target.checked; rebuild(); keepPrefs(); };
  $('photoBody').checked = S.opts.photoBody !== false;
  $('hairLayer').checked = !!S.opts.hairLayer;
  $('ears').checked = S.opts.ears !== false;
  for (const b of document.querySelectorAll('#buildSeg button')) {
    b.classList.toggle('on', (b.dataset.slim === '1') === !!S.opts.slim);
    b.onclick = () => {
      setSlim(b.dataset.slim === '1');
      for (const o of document.querySelectorAll('#buildSeg button')) o.classList.toggle('on', o === b);
      refreshTwigs();
    };
  }
}

// ---------------------------------------------------------------------------
// the painter
// ---------------------------------------------------------------------------

const board = $('board');
const painter = new Painter(board, S.skin, {
  slim: S.opts.slim,
  onEdit: () => { S.skin.flush(); texture.needsUpdate = true; },
  onWrite: noteEdit,
  onPick: (hex) => { $('brushColour').value = hex; rememberColour(hex); },
  getExtra: () => new Map(S.edits),
  setExtra: (m) => { if (m) S.edits = new Map(m); },
});

for (const b of document.querySelectorAll('#tools button')) {
  b.onclick = () => {
    painter.tool = b.dataset.tool;
    $('navHint').textContent = b.dataset.tool === 'pan'
      ? 'Drag to move the picture about. Pick another tool to paint again.'
      : 'Drag with two fingers, the middle button or the right button to move about — or turn on Move. Wheel or pinch to zoom.';
    for (const o of document.querySelectorAll('#tools button')) o.classList.toggle('on', o === b);
  };
}
for (const b of document.querySelectorAll('#layerSeg button')) {
  b.onclick = () => {
    painter.layer = b.dataset.layer;
    for (const o of document.querySelectorAll('#layerSeg button')) o.classList.toggle('on', o === b);
    painter.redraw();
  };
}
$('brushColour').oninput = (e) => { painter.colour = e.target.value; rememberColour(e.target.value); };
$('brushSize').oninput = (e) => {
  painter.brush = +e.target.value;
  $('brushSizeOut').textContent = e.target.value;
};
$('mirror').onchange = (e) => { painter.mirror = e.target.checked; painter.redraw(); };

/**
 * Getting about the flat image.
 *
 * The old version had one way in and out: pinch, on a picture where a single
 * finger paints. On a phone that is a fight, and with a mouse there was no
 * pan at all. Now there are four ways to move — two fingers, the middle
 * button, the right button, and a Move tool for anybody who would rather not
 * remember any of that — and a list of every part of the body to jump to,
 * which is the one that actually gets used: nobody hunts for the left
 * calf's back, they choose it.
 */
$('zoomIn').onclick = () => painter.zoomBy(1.35);
$('zoomOut').onclick = () => painter.zoomBy(1 / 1.35);
$('fitBtn2').onclick = () => painter.fit();

function fillParts() {
  const sel = $('goPart');
  const at = sel.value;
  sel.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Jump to…';
  sel.appendChild(none);
  const seen = new Set();
  for (const r of regions(S.opts.slim, S.skin.size)) {
    if (r.layer !== 'base') continue;
    const key = `${r.part}:${r.face}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const o = document.createElement('option');
    o.value = key;
    o.textContent = `${r.name} — ${r.face}`;
    sel.appendChild(o);
  }
  if (at) sel.value = at;
}

$('goPart').onchange = (e) => {
  const [part, face] = e.target.value.split(':');
  if (!part) return;
  const r = regions(S.opts.slim, S.skin.size)
    .find((q) => q.part === part && q.face === face && q.layer === 'base');
  if (r) painter.focus(r.rect);
};
$('undoBtn').onclick = () => { painter.undo(); refresh(); };
$('redoBtn').onclick = () => { painter.redo(); refresh(); };

$('revertBtn').onclick = () => {
  if (!S.edits.size) return;
  painter.begin();
  S.edits.clear();
  painter.painting = false;
  rebuild();
};
$('clearPartBtn').onclick = () => {
  const names = parts(S.opts.slim).map((p) => `${p.key} (${p.name})`).join(', ');
  const which = prompt(`Which part? ${names}`, 'head');
  if (!which) return;
  const key = which.trim().split(' ')[0];
  if (!parts(S.opts.slim).some((p) => p.key === key)) return;
  painter.clearPart(key);
  refresh();
};

board.addEventListener('pointermove', () => { $('hoverSay').textContent = painter.describe(); });

const recent = [];
function rememberColour(hex) {
  if (recent[0] === hex) return;
  recent.unshift(hex);
  recent.splice(9);
  const host = $('recent');
  host.textContent = '';
  for (const c of recent) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.onclick = () => { painter.colour = c; $('brushColour').value = c; };
    host.appendChild(b);
  }
}

// painting straight onto the figure — the same edit, made where you can see
// that it is wrong
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!S.modelPaint) return;
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  const hit = pickTexel(fig, camera, ndc, painter.layer);
  if (!hit) return;
  painter.begin();
  painter.put(hit.x, hit.y, painter.tool === 'erase' || e.shiftKey);
  painter.painting = false;
  refresh();
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); painter.undo(); refresh(); }
  else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault(); painter.redo(); refresh();
  }
});

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

function showTab(which) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === which);
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.dataset.panel === which);
  if (which === 'paint') requestAnimationFrame(() => { sizeBoards(); painter.fit(); });
  if (which === 'wear') refreshTwigs();
  if (which === 'photo') requestAnimationFrame(() => { sizeBoards(); cropper.fit(); cropper.draw(); });
}
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => showTab(b.dataset.tab);

/** Give both flat canvases the pixels the screen actually has. */
function sizeBoards() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  for (const [c, ratio] of [[crop, 0.78], [board, 1]]) {
    const w = c.clientWidth;
    if (!w) continue;
    const h = Math.round(w * ratio);
    c.style.height = `${h}px`;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  }
}
addEventListener('resize', () => {
  // the ResizeObserver above is the usual path; this one is for the cases it
  // does not cover — a headless check with no animation frames, and a phone
  // turned on its side, where the observer can lag a frame behind the layout
  fitStage();
  sizeBoards();
  cropper.fit(); cropper.draw();
  painter.fit();
});

// ---------------------------------------------------------------------------
// out
// ---------------------------------------------------------------------------

$('name').oninput = (e) => { S.name = e.target.value; };

$('dlBtn').onclick = () => {
  const name = store.tidyName(S.name);
  store.download(name, S.skin.toDataURL());
  say('saveSay', `${name}.png — upload that at minecraft.net`, 'good');
};

$('dl64Btn').onclick = () => {
  const name = store.tidyName(S.name);
  store.download(`${name}-64`, S.skin.toDataURLAt(BASE));
  say('saveSay', `${name}-64.png — that one goes into Java`, 'good');
};

$('shareBtn').onclick = async () => {
  const name = store.tidyName(S.name);
  const blob = await S.skin.toBlob();
  const ok = await store.share(name, blob, 'A Minecraft skin');
  if (!ok) {
    store.download(name, S.skin.toDataURL());
    say('saveSay', 'this browser cannot share files — downloaded instead', 'good');
  }
};

$('copyBtn').onclick = async () => {
  const ok = await store.copyImage(await S.skin.toBlob());
  say('saveSay', ok ? 'copied' : 'this browser will not copy images', ok ? 'good' : 'bad');
};

$('shotBtn').onclick = () => {
  const was = S.spin;
  S.spin = false;
  const url = store.shot(renderer, scene, camera, 720);
  S.spin = was;
  store.download(`${store.tidyName(S.name)}-picture`, url);
  say('saveSay', 'a picture of him, for the listing', 'good');
};

$('diskBtn').onclick = async () => {
  const name = store.tidyName(S.name);
  const path = await store.toDisk(name, {
    png: S.skin.toDataURL(),
    slim: S.opts.slim,
    size: S.skin.size,
    opts: { ...S.opts, colours: { ...S.opts.colours } },
  });
  say('saveSay', path ? `written to ${path}` : 'no server to write to — use Download', path ? 'good' : 'bad');
};

$('keepBtn').onclick = () => {
  const name = store.tidyName(S.name, store.shelf().map((s) => s.name).filter((n) => n !== S.name));
  store.keep({
    name,
    png: S.skin.toDataURL(),
    slim: S.opts.slim,
    size: S.skin.size,
    opts: { ...S.opts, colours: { ...S.opts.colours } },
  });
  S.name = name;
  $('name').value = name;
  drawShelf();
  say('saveSay', `kept as ${name}`, 'good');
};

$('newBtn').onclick = () => {
  S.photo = null; S.frame = null; S.base = null;
  S.edits.clear();
  S.opts = {
    ...DEFAULTS, colours: {}, slim: S.opts.slim, size: S.skin.size,
    wear: { ...DEFAULT_WEAR },
  };
  cropper.setPhoto(null);
  cropper.setFrame(null);
  $('dropNote').style.display = '';
  rebuild();
  say('saveSay', 'blank again', '');
};

$('importBtn').onclick = () => $('skinIn').click();
$('skinIn').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const img = await loadImage(f);
    S.skin.fromImage(img);
    S.opts.size = S.skin.size;
    S.base = S.skin.snapshot();
    S.photo = null; S.frame = null;
    S.edits.clear();
    cropper.setPhoto(null); cropper.setFrame(null);
    $('dropNote').style.display = '';
    S.name = store.tidyName(f.name.replace(/\.png$/i, ''));
    $('name').value = S.name;
    painter.size = S.skin.size;
    rebuildFigure();
    refresh();
    painter.fit();
    drawSizes();
    drawSwatches();
    refreshTwigs();
    say('saveSay', 'opened — paint away', 'good');
  } catch (err) {
    say('saveSay', err.message || 'could not read that', 'bad');
  }
};

function drawShelf() {
  const host = $('shelf');
  host.textContent = '';
  const list = store.shelf();
  if (!list.length) {
    host.innerHTML = '<div class="hint">Nothing kept yet.</div>';
    return;
  }
  for (const row of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.src = row.png;
    img.alt = row.name;
    const b = document.createElement('b');
    b.textContent = row.name;
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.onclick = (e) => { e.stopPropagation(); store.forget(row.name); drawShelf(); };
    card.onclick = async () => {
      const img2 = await loadImage(row.png);
      S.skin.fromImage(img2);
      S.opts.size = S.skin.size;
      S.base = S.skin.snapshot();
      S.photo = null; S.frame = null;
      S.edits.clear();
      cropper.setPhoto(null); cropper.setFrame(null);
      $('dropNote').style.display = '';
      S.opts = { ...S.opts, ...(row.opts || {}), slim: !!row.slim, size: S.skin.size };
      S.name = row.name;
      $('name').value = row.name;
      painter.slim = S.opts.slim;
      painter.size = S.skin.size;
      rebuildFigure();
      refresh();
      painter.fit();
      drawSizes();
      drawSwatches();
      refreshTwigs();
      say('saveSay', `opened ${row.name}`, 'good');
    };
    card.append(img, b, x);
    host.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// what is remembered between visits: the settings, never the skins
// ---------------------------------------------------------------------------

function keepPrefs() {
  store.prefs({ opts: { ...S.opts, colours: { ...S.opts.colours }, wear: { ...S.opts.wear } } });
}

function loadPrefs() {
  const p = store.prefs();
  if (p && p.opts) {
    S.opts = {
      ...DEFAULTS, ...p.opts,
      colours: { ...(p.opts.colours || {}) },
      wear: { ...DEFAULT_WEAR, ...(p.opts.wear || {}) },
    };
  }
  if (SIZES.includes(S.opts.size) && S.opts.size !== S.skin.size) {
    S.skin.resize(S.opts.size);
    painter.size = S.opts.size;
  }
  $('slimBtn').textContent = S.opts.slim ? 'slim arms' : 'classic arms';
  $('slimBtn').classList.toggle('on', S.opts.slim);
  for (const id of ['eyeRow', 'mouthRow', 'zoomX', 'shiftX', 'shiftY', 'bright', 'contrast',
    'satur', 'warmth', 'detail', 'features', 'shading', 'grain', 'sleeve', 'boot', 'levels']) {
    const el = $(id);
    if (!el) continue;
    el.value = S.opts[id];
    const out = $(`${id}Out`);
    if (out) out.textContent = id === 'levels' && !S.opts[id] ? 'off' : String(S.opts[id]);
  }
}

// ---------------------------------------------------------------------------
// go
// ---------------------------------------------------------------------------

loadPrefs();
painter.slim = S.opts.slim;
drawTree();
fillParts();
rebuildFigure();
sizeBoards();
cropper.draw();
painter.fit();
rebuild();
drawShelf();
rememberColour('#c23a2e');
showTab('photo');

// The test hooks, in the family's usual style: everything a check needs to
// drive this without a mouse, and a way to get a picture back out.
Object.assign(window, {
  __skin: S.skin,
  __state: () => ({
    hasPhoto: !!S.photo,
    frame: S.frame,
    opts: S.opts,
    pal: S.pal,
    edits: S.edits.size,
    slim: S.opts.slim,
  }),
  __rebuild: rebuild,
  __load: takePhoto,
  __setFrame: (f) => { S.frame = { ...S.frame, ...f }; cropper.setFrame(S.frame); rebuild(); },
  __texel: (x, y) => S.skin.get(x, y),
  __size: (n) => (n ? (setSize(n), S.skin.size) : S.skin.size),
  __wear: (cat, id) => {
    if (cat) { S.opts.wear = { ...S.opts.wear, [cat]: id }; rebuild(); }
    return { ...S.opts.wear };
  },
  __cats: () => CATEGORIES.map((c) => ({ key: c.key, n: c.items.length })),
  __openCat: (k) => {
    const wrap = document.querySelector(`#tree .branch[data-key="${k}"]`);
    if (wrap && !wrap.classList.contains('open')) wrap.querySelector('.twig').click();
    return !!wrap;
  },
  __cap: cap,
  async __plate(url) {
    await setPlate(url);
    return !!cap.plate;
  },
  async __turns(urls) {
    for (const u of urls) {
      const img = await loadImage(u);
      cap.turns.push({ photo: new Photo(img, 680), name: String(u) });
    }
    cap.front = -1;
    cap.flip = undefined;
    reread();
    return cap.angles.map((t) => Math.round(t.angle));
  },
  __front: (i) => { cap.front = i; reread(); return cap.angles.findIndex((t) => t.front); },
  __flip: () => { cap.flip = !cap.flip; reread(); return !!cap.flip; },
  __build: () => { $('buildBtn').click(); return cap.vol ? cap.vol.count() : 0; },
  __toMc: () => { $('toMcBtn').click(); return true; },
  __faceOnly: (on) => {
    if (on === undefined) return $('faceOnly').checked;
    $('faceOnly').checked = !!on; cap.faceTouched = true;
    return $('faceOnly').checked;
  },
  __png: () => S.skin.toDataURL(),
  __view: view,
  __fig: () => fig,
  __painter: painter,
  __cropper: cropper,
  /** Lay one texel by hand, exactly as a click would. */
  __paint(x, y, hex) {
    painter.begin();
    if (hex) painter.colour = hex;
    painter.put(x, y, false);
    painter.painting = false;
    refresh();
  },
  __gfx: { renderer, scene, camera, THREE },
  __fit: () => { fitStage(); sizeBoards(); painter.fit(); cropper.fit(); cropper.draw(); },
  /** Draw one frame on demand — a headless check has no animation loop. */
  __render(yaw, pitch, dist) {
    if (yaw !== undefined) view.state.yaw = yaw;
    if (pitch !== undefined) view.state.pitch = pitch;
    if (dist !== undefined) view.state.dist = dist;
    view.state.spin = 0;
    view.apply();
    pose(fig, 0, 'still');
    // the loop aims his head after posing it; a hook that skips that draws a
    // different figure from the one on screen, which is the one thing a test
    // hook must never do
    aimHead();
    S.skin.flush();
    texture.needsUpdate = true;
    renderer.render(scene, camera);
  },
  /** What colour is at a point of the picture, 0..1 across and down. */
  __at(u, v) {
    const c = document.createElement('canvas');
    c.width = renderer.domElement.width;
    c.height = renderer.domElement.height;
    const cx = c.getContext('2d');
    cx.drawImage(renderer.domElement, 0, 0);
    const d = cx.getImageData(Math.round(u * (c.width - 1)), Math.round(v * (c.height - 1)), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  },
  async capture(name = 'shot') {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    try {
      await fetch(`/shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
      return name;
    } catch {
      return url;
    }
  },
  async captureSkin(name = 'skin') {
    const url = S.skin.toDataURL();
    try {
      await fetch(`/shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
      return name;
    } catch {
      return url;
    }
  },
});
