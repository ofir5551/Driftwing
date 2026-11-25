import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Config } from '../src/core/Config';
import { Flock, type FlockGround, type FlockPose } from '../src/world/Flock';
import { slot, toWorld } from '../src/world/formation';

const flat: FlockGround = { flightGround: () => 0, pushPoint: () => {} };
const pose: FlockPose = { x: 100, y: 40, z: -20, yaw: 0.7, pitch: 0, bank: 0, speed: 26 };
const m = new THREE.Matrix4();
const p = new THREE.Vector3();

function birdAt(f: Flock, i: number): THREE.Vector3 {
  f.mesh.getMatrixAt(i, m);
  return p.setFromMatrixPosition(m).clone();
}

describe('the flock', () => {
  it('flies the kept birds in their slots round the bird', () => {
    const f = new Flock();
    f.setBirds([0, 1, 2]);
    f.update(1 / 60, 10, pose, flat);
    expect(f.mesh.count).toBe(3);
    const off = new Float32Array(3);
    toWorld(slot(1, 10, { ahead: 0, right: 0, up: 0 }), pose.yaw, pose.pitch, off, 0);
    const b = birdAt(f, 1);
    expect(b.x).toBeCloseTo(pose.x + off[0], 3);
    expect(b.y).toBeCloseTo(pose.y + off[1], 3);
    expect(b.z).toBeCloseTo(pose.z + off[2], 3);
  });

  it('a perched stray joins from its cairn and settles into its place', () => {
    const f = new Flock();
    f.setBirds([0, 1]);
    f.update(1 / 60, 0, pose, flat);
    f.perchAt(130, 5, 10, 0, 3);
    f.update(1 / 60, 0, pose, flat);
    expect(f.mesh.count).toBe(3); // two fliers and the perched one
    expect(f.join(pose.x, pose.y, pose.z)).toBe(3);
    f.update(0, 0, pose, flat);
    const start = birdAt(f, 2);
    expect(start.distanceTo(new THREE.Vector3(130, 5, 10))).toBeLessThan(0.01);
    for (let t = 0; t < 6; t += 1 / 60) f.update(1 / 60, 0, pose, flat);
    const off = new Float32Array(3);
    toWorld(slot(2, 0, { ahead: 0, right: 0, up: 0 }), pose.yaw, 0, off, 0);
    const end = birdAt(f, 2);
    expect(
      end.distanceTo(new THREE.Vector3(pose.x + off[0], pose.y + off[1], pose.z + off[2])),
    ).toBeLessThan(0.2);
    expect(f.mesh.count).toBe(3);
  });

  it('flies only the newest birds once the flock is bigger than a screen holds', () => {
    const f = new Flock();
    const all = Array.from({ length: Config.flock.visible + 5 }, (_, i) => i % 8);
    f.setBirds(all);
    f.update(1 / 60, 0, pose, flat);
    expect(f.mesh.count).toBe(Config.flock.visible);
    f.perchAt(0, 0, 0, 0, 1);
    f.join(pose.x, pose.y, pose.z);
    f.update(1 / 60, 0, pose, flat);
    expect(f.mesh.count).toBe(Config.flock.visible);
  });

  it('keeps every bird off the ground', () => {
    const f = new Flock();
    f.setBirds([0, 1, 2, 3, 4, 5]);
    const ground: FlockGround = { flightGround: () => 39, pushPoint: () => {} };
    f.update(1 / 60, 0, { ...pose, pitch: -0.6 }, ground);
    for (let i = 0; i < 6; i++)
      expect(birdAt(f, i).y).toBeGreaterThanOrEqual(39 + Config.flock.clearance - 1e-4);
  });
});
