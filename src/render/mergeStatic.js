// Fewer draw calls for things that never move: every plain mesh under `group` that shares a material (and the same shadow flags)
// becomes ONE mesh, with each piece's place baked in. The picture is the same; the graphics chip gets one job instead of dozens.
// Left alone: sprites, instanced / skinned meshes, see-through surfaces (their draw order matters), meshes with several materials
// or an own draw order, and anything a caller marks `userData.keepSeparate`.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map();
  const meshes = [];
  group.traverse((o) => {
    if (o === group || !o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const m = o.material;
    if (Array.isArray(m) || !m || m.transparent || o.renderOrder !== 0 || o.userData.keepSeparate || !o.visible) return;
    if (!o.geometry.getAttribute('position')) return;
    meshes.push(o);
    const key = `${m.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  const oldGeos = new Set();
  const made = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    // (the pieces must carry the same attributes, all indexed: keep what every piece has)
    const names = [...Object.keys(list[0].geometry.attributes)].filter((n) => list.every((o) => o.geometry.attributes[n]));
    const geos = list.map((o) => {
      const g = o.geometry.clone();
      if (!g.index) { const n = g.getAttribute('position').count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
      for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      g.morphAttributes = {};
      g.clearGroups();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.name = 'merged';
    for (const o of list) { oldGeos.add(o.geometry); o.parent.remove(o); }
    made.push(mesh);
  }
  for (const m of made) group.add(m);
  for (const g of oldGeos) g.dispose();
  // (groups left empty by the move go away too)
  const prune = (o) => { for (const c of [...o.children]) { prune(c); if (c.isGroup && c.children.length === 0) o.remove(c); } };
  prune(group);
  return group;
}
