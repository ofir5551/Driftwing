import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

describe('scaffold', () => {
  it('imports three', () => {
    expect(new THREE.Vector3(1, 2, 3).length()).toBeCloseTo(Math.sqrt(14));
  });
});
