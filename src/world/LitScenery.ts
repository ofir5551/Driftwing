import type * as THREE from 'three';

/** Built-in materials that take scene lights (and so sun shadows). */
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

function visit(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || mesh.receiveShadow) return;
  const mat = mesh.material;
  if (Array.isArray(mat) ? mat.some(isLit) : isLit(mat)) mesh.receiveShadow = true;
}

/**
 * Lets every lit mesh of a level receive the sun's shadows (trees shading a roof, a hill
 * shading the trees), without each level opting its meshes in. Levels stream meshes in (islands,
 * pooled chunks), so Game runs this on a level switch and then about once a second; meshes
 * already done are skipped. Custom shader materials (water, the cloud sea, facades) are left
 * alone: they don't take scene lights.
 */
export function prepareScenery(root: THREE.Object3D): void {
  root.traverse(visit);
}
