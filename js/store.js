// Keeping skins, and getting them out.
//
// The point of the whole program is a 64x64 PNG in somebody else's hands, so
// the way out matters as much as the way in. There are three, and which one
// is right depends entirely on what you are sitting in front of:
//
//   download  — Windows, and the file goes where files go
//   share     — Android, where "download" means a folder nobody visits and
//               the useful move is handing the PNG straight to the Minecraft
//               app, or to whoever is buying it
//   the shelf — this machine's own list, in the browser's storage, so an
//               unfinished face is still there tomorrow
//
// And one more when the little Python server is running: straight into the
// repo's `skins/` folder, which is what makes a batch of them a body of work
// rather than forty files called `skin (3).png`.

const KEY = 'kherveskins.shelf.v1';
const PREFS = 'kherveskins.prefs.v1';

/** Everything on the shelf, newest first. */
export function shelf() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.sort((a, b) => b.at - a.at) : [];
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 120)));
}

/** Put one on the shelf, replacing any with the same name. */
export function keep(entry) {
  const list = shelf().filter((s) => s.name !== entry.name);
  const row = { ...entry, at: Date.now() };
  list.unshift(row);
  try {
    write(list);
  } catch {
    // a full shelf is not a reason to lose today's work: drop the oldest
    // half and try once more
    write(list.slice(0, Math.max(1, Math.floor(list.length / 2))));
  }
  return row;
}

export function forget(name) {
  write(shelf().filter((s) => s.name !== name));
}

export function recall(name) {
  return shelf().find((s) => s.name === name) || null;
}

/** The sliders, remembered between visits. Not the skins — those are above. */
export function prefs(next) {
  if (next === undefined) {
    try {
      return JSON.parse(localStorage.getItem(PREFS) || '{}');
    } catch {
      return {};
    }
  }
  localStorage.setItem(PREFS, JSON.stringify(next));
  return next;
}

/** A name that is a filename, and is not already taken. */
export function tidyName(name, taken = []) {
  let base = String(name || 'skin').trim().replace(/[^\w \-]+/g, '').replace(/\s+/g, '-');
  if (!base) base = 'skin';
  base = base.slice(0, 40);
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 500; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

/** Windows, and anywhere else with a downloads folder. */
export function download(name, dataURL) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = `${name}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Android's proper way out: hand the file to another app. */
export async function share(name, blob, text) {
  if (!navigator.canShare) return false;
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: name, text: text || '' });
    return true;
  } catch (e) {
    return e && e.name === 'AbortError' ? true : false;
  }
}

/** The clipboard, for pasting into whatever is open. */
export async function copyImage(blob) {
  if (!navigator.clipboard || !globalThis.ClipboardItem) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Into the repo's own `skins/` folder, when the Python server is serving.
 *
 * Fails quietly and on purpose: opened as a plain file, or served by
 * something that is not `serve.py`, there is nowhere to put it, and that is
 * not an error worth a red box — the download button is right there.
 */
export async function toDisk(name, payload) {
  try {
    const res = await fetch(`/skin?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

/** What the server has, if it is the kind of server that has any. */
export async function fromDisk() {
  try {
    const res = await fetch('skins/index.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const names = await res.json();
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
}

/** One saved skin off the disk. */
export async function readDisk(name) {
  try {
    const res = await fetch(`skins/${encodeURIComponent(name)}.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * A picture of the man, rather than the skin he is wearing.
 *
 * Nobody buys a 64x64 they cannot read. This is the listing shot: the figure
 * on nothing, big enough to be a thumbnail anywhere, with the background
 * left transparent so it drops onto whatever page it ends up on.
 */
export function shot(renderer, sceneObj, camera, size = 640) {
  const before = { w: renderer.domElement.width, h: renderer.domElement.height };
  const ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const oldAspect = camera.aspect;
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  const clear = renderer.getClearAlpha();
  renderer.setClearAlpha(0);
  renderer.render(sceneObj, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setClearAlpha(clear);
  camera.aspect = oldAspect;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(ratio);
  renderer.setSize(before.w / ratio, before.h / ratio, false);
  return url;
}

/** A data URL back into a Blob, which is what sharing and pasting want. */
export async function toBlob(dataURL) {
  const res = await fetch(dataURL);
  return res.blob();
}
