// Showing the carved person.
//
// Only the SKIN of the volume is drawn — a cube with something on all six
// sides is inside the person and nobody will ever see it. That is the
// difference between a couple of thousand boxes and two hundred thousand,
// and it is why this spins on a phone.
//
// One instanced mesh, one colour per instance. The figure it stands beside is
// six boxes and a texture; this is a few thousand boxes and no texture at
// all, and they share a scene, a camera and an orbit.

import * as THREE from 'three';

/**
 * Build a mesh of the carved person, standing on the same ground as the
 * Minecraft figure and the same height, so the two can be compared by
 * flicking between them rather than by remembering.
 */
export function buildVoxels(vol, opts = {}) {
  const cubes = vol.surface();
  const unit = (opts.height || 2) / vol.ny;
  const geo = new THREE.BoxGeometry(unit, unit, unit);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cubes.length));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(Math.max(1, cubes.length) * 3), 3,
  );

  const m = new THREE.Matrix4();
  const halfX = (vol.nx - 1) / 2, halfZ = (vol.nz - 1) / 2;
  const c = new THREE.Color();
  cubes.forEach(([x, y, z], i) => {
    m.makeTranslation(
      (x - halfX) * unit,
      // the volume is stored with the crown at row nought, the way a
      // photograph is; the world has the floor at nought
      (vol.ny - 1 - y) * unit + unit / 2,
      (z - halfZ) * unit,
    );
    mesh.setMatrixAt(i, m);
    const [r, g, b] = vol.colourAt(x, y, z);
    c.setRGB((r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2);
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.count = cubes.length;
  return { mesh, cubes: cubes.length, dispose() { geo.dispose(); mat.dispose(); } };
}

/** A flat picture of the volume from one side, for the capture card. */
export function previewVolume(canvas, vol, angle = 0) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const z = Math.min(W / vol.nx, H / vol.ny) * 0.92;
  const ox = (W - vol.nx * z) / 2, oy = (H - vol.ny * z) / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const halfX = (vol.nx - 1) / 2, halfZ = (vol.nz - 1) / 2;
  // painter's algorithm: the far cubes first
  const cubes = vol.surface().map(([x, y, zz]) => {
    const dx = x - halfX, dz = zz - halfZ;
    return { x: dx * cos - dz * sin, y, depth: dx * sin + dz * cos, c: vol.colourAt(x, y, zz) };
  }).sort((a, b) => b.depth - a.depth);
  for (const q of cubes) {
    ctx.fillStyle = `rgb(${q.c[0] | 0},${q.c[1] | 0},${q.c[2] | 0})`;
    ctx.fillRect(ox + (q.x + halfX) * z, oy + q.y * z, z + 1, z + 1);
  }
}
