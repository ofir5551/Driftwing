import type * as THREE from 'three';
import { withCloudShadow } from './CloudShadow';

/** Built-in materials that take scene lights (and so sun, cloud and cast shadows). */
export function isLit(m: THREE.Material): boolean {
  const t = m.type;
  return (
    t === 'MeshToonMaterial' ||
    t === 'MeshLambertMaterial' ||
    t === 'MeshPhongMaterial' ||
    t === 'MeshStandardMaterial' ||
    t === 'MeshPhysicalMaterial'
  );
}

function prepareMaterial(m: THREE.Material): void {
  if (!isLit(m) || m.userData.cloudShadow) return;
  m.userData.cloudShadow = true;
  withCloudShadow(m);
  m.needsUpdate = true; // recompiles only if it was already drawn (a mesh streamed in late)
}

function visit(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || mesh.userData.litScenery) return;
  mesh.userData.litScenery = true;
  const mat = mesh.material;
  if (Array.isArray(mat)) {
    for (const m of mat) prepareMaterial(m);
    if (mat.some(isLit)) mesh.receiveShadow = true;
  } else {
    prepareMaterial(mat);
    if (isLit(mat)) mesh.receiveShadow = true;
  }
}

/**
 * Gives every lit mesh of a level the shared lighting, without each level opting its meshes
 * in: it receives the sun's shadows (trees shading a roof or the ground under them) and its
 * material gets the drifting cloud shadows. Levels stream meshes in (islands, pooled chunks), so
 * Game runs this on a level switch and then about once a second; meshes already seen are
 * skipped. Custom shader materials (water, the cloud sea, facades) are left alone: they don't
 * take scene lights.
 */
export function prepareScenery(root: THREE.Object3D): void {
  root.traverse(visit);
}
