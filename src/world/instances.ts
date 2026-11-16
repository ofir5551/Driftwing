import type * as THREE from 'three';

/**
 * Mark the first `n` items of an instanced attribute for upload. Setting `needsUpdate` alone
 * sends the whole buffer, and the instanced meshes are sized for the worst case (thousands of
 * trees and props): every refill then uploaded megabytes to draw a few hundred instances, a
 * hitch on a phone each time the chunk set changed.
 */
export function markUsed(attr: THREE.BufferAttribute, n: number): void {
  attr.clearUpdateRanges();
  if (n <= 0) return;
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

/** End a refill: draw `n` instances and upload just their matrices (and colours). */
export function commitInstances(mesh: THREE.InstancedMesh, n: number): void {
  mesh.count = n;
  markUsed(mesh.instanceMatrix, n);
  if (mesh.instanceColor) markUsed(mesh.instanceColor, n);
}
