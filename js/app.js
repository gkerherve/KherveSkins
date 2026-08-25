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
import { Photo, autoFace } from './photo.js';
import { generate, blank, DEFAULTS } from './generate.js';
import { buildFigure, skinTexture, pose, orbit, pickTexel, scene as makeScene } from './model.js';
import { Cropper } from './cropper.js';
import { Painter } from './paint.js';
import * as store from './store.js';
import { parts, SIZES, BASE } from './layout.js';

const $ = (id) => document.getElementById(id);

const S = {
  photo: null,
  frame: null,
  opts: { ...DEFAULTS, colours: {} },
  skin: new Skin(BASE),
  base: null,          // an imported skin, when there is no photograph
  edits: new Map(),    // every texel laid by hand: "x,y" -> [r,g,b,a]
  pal: null,
  poseMode: 'walk',
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

let t0 = performance.now();
renderer.setAnimationLoop(() => {
  const t = (performance.now() - t0) / 1000;
  pose(fig, t, S.poseMode);
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
  const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { showTab('photo'); takePhoto(f); }
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
  ['shading', 'shading'], ['grain', 'grain'], ['sleeve', 'sleeve'], ['boot', 'boot'],
]) slider(id, key);
slider('levels', 'levels', (v) => (v ? String(v) : 'off'));

$('hairLayer').onchange = (e) => { S.opts.hairLayer = e.target.checked; queueRebuild(); keepPrefs(); };
$('ears').onchange = (e) => { S.opts.ears = e.target.checked; queueRebuild(); keepPrefs(); };
$('reseedBtn').onclick = () => { S.opts.seed = (Math.random() * 1e6) | 0; rebuild(); };

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
  keepPrefs();
}

function drawSizes() {
  const host = $('sizes');
  host.textContent = '';
  for (const n of SIZES) {
    const b = document.createElement('button');
    b.textContent = `${n}×${n}`;
    b.classList.toggle('on', n === S.skin.size);
    b.onclick = () => setSize(n);
    host.appendChild(b);
  }
  $('sizeNote').textContent = S.skin.size === BASE
    ? 'A face eight pixels across. The only size vanilla Java takes.'
    : `A face ${S.skin.size / 8} pixels across. Bedrock skin packs take this; `
      + 'vanilla Java does not, so the export offers a 64×64 as well.';
  const dl64 = $('dl64Btn');
  if (dl64) dl64.style.display = S.skin.size === BASE ? 'none' : '';
}

$('slimBtn').onclick = () => {
  S.opts.slim = !S.opts.slim;
  $('slimBtn').textContent = S.opts.slim ? 'slim arms' : 'classic arms';
  $('slimBtn').classList.toggle('on', S.opts.slim);
  painter.slim = S.opts.slim;
  rebuildFigure();
  rebuild();
  keepPrefs();
};

$('poseBtn').onclick = () => {
  S.poseMode = S.poseMode === 'walk' ? 'idle' : S.poseMode === 'idle' ? 'still' : 'walk';
  $('poseBtn').textContent = S.poseMode === 'walk' ? 'walking' : S.poseMode === 'idle' ? 'standing' : 'still';
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
$('undoBtn').onclick = () => { painter.undo(); refresh(); };
$('redoBtn').onclick = () => { painter.redo(); refresh(); };
$('fitBtn').onclick = () => painter.fit();
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
  S.opts = { ...DEFAULTS, colours: {}, slim: S.opts.slim, size: S.skin.size };
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
  store.prefs({ opts: { ...S.opts, colours: { ...S.opts.colours } } });
}

function loadPrefs() {
  const p = store.prefs();
  if (p && p.opts) S.opts = { ...DEFAULTS, ...p.opts, colours: { ...(p.opts.colours || {}) } };
  if (SIZES.includes(S.opts.size) && S.opts.size !== S.skin.size) {
    S.skin.resize(S.opts.size);
    painter.size = S.opts.size;
  }
  $('slimBtn').textContent = S.opts.slim ? 'slim arms' : 'classic arms';
  $('slimBtn').classList.toggle('on', S.opts.slim);
  $('hairLayer').checked = !!S.opts.hairLayer;
  $('ears').checked = S.opts.ears !== false;
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
drawSizes();
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
