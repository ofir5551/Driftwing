import * as THREE from 'three';
import { Config } from '../../core/Config';
import { HighlandsWorld } from '../../levels/Highlands';
import type { World } from '../../levels/World';
import type { FlightState } from '../../player/FlightModel';
import type { DayCycle } from '../DayCycle';
import type { DestinationSource } from '../Destinations';
import type { DiscoveryDef } from '../Discoveries';
import { createHeightField } from '../Terrain';
import { EdenLayout } from './EdenLayout';
import { EdenScenery } from './EdenScenery';
import { edenFinds } from './finds';
import { edenDestinations } from './journeys';
import { EdenWisps } from './EdenWisps';

/**
 * Tal and Hadar's wedding flight: the Highlands' country at golden hour, reshaped round three
 * stops (Tal's picture, Hadar's, then the venue), with Eden's scenery on top. Everything the
 * Highlands do (terrain, farms, forests, isles, mist) comes from a HighlandsWorld built on the
 * reshaped land; this adds the pictures, the venue and the story's journeys.
 */
export class EdenWorld implements World {
  readonly group = new THREE.Group();
  readonly layout: EdenLayout;
  readonly planner: EdenWisps;
  readonly discoveries: readonly DiscoveryDef[];
  readonly destinations: DestinationSource;
  private readonly land: HighlandsWorld;
  private readonly scenery: EdenScenery;

  constructor(seed: number) {
    this.layout = new EdenLayout(createHeightField(seed), seed);
    this.land = new HighlandsWorld(seed, this.layout.field);
    this.scenery = new EdenScenery(this.layout);
    this.discoveries = edenFinds(this.layout);
    this.planner = new EdenWisps((x, z) => this.wispFloor(x, z));
    this.destinations = this.story(edenDestinations(this.layout, this.land.destinations));
    this.group.add(this.land.group, this.scenery.group);
  }

  get field() {
    return this.land.field;
  }

  /** The Highlands' ground, and over the venue its roof, trees and chuppah. */
  flightGround(x: number, z: number): number {
    return Math.max(this.land.flightGround(x, z), this.layout.liftAt(x, z));
  }

  surfaceBelow(x: number, _y: number, z: number): number {
    return this.flightGround(x, z);
  }

  /** Ribbons keep over the ground and the venue, and over the pictures (never through one). */
  wispFloor(x: number, z: number): number {
    let f = this.flightGround(x, z);
    for (const F of this.layout.frames) {
      const d = Math.hypot(x - F.x, z - F.z);
      if (d < F.half + 14) f = Math.max(f, F.y1 + 6);
    }
    return f;
  }

  prime(px: number, pz: number): void {
    this.land.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.land.update(px, pz);
  }

  frame(dt: number, time: number, day: DayCycle): void {
    this.land.frame(dt, time, day);
    this.scenery.frame(dt, time, day);
  }

  assist(): void {}

  /** The isles, and the pictures: a soft glance off a frame, out the nearer face or over. */
  collide(s: FlightState): number {
    const isle = this.land.collide(s);
    const pushed = this.layout.pushFrame(s, Config.flight.clearance);
    if (pushed <= 0) return isle;
    s.speed *= 1 - 0.1 * (1 / 60);
    return Math.max(isle, pushed * 10);
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushFrame(p, margin);
  }

  thermalOk(x: number, z: number): boolean {
    // Not over the venue: a thermal column through the hall would look odd.
    const V = this.layout.venue;
    return Math.hypot(x - V.x, z - V.z) > V.flat;
  }

  arrived(id: string): void {
    if (id === 'eden:venue') this.scenery.celebrate();
  }

  get chunkCount(): number {
    return this.land.chunkCount;
  }

  get pending(): number {
    return this.land.pending;
  }

  dispose(): void {
    this.land.dispose();
    this.scenery.dispose();
  }

  /** The journeys, and a new flight (the story starting at Tal again) puts the lanterns away. */
  private story(src: DestinationSource): DestinationSource {
    return {
      next: (x, z, yaw, first, skip) => {
        if (first && skip.size === 0) this.scenery.reset();
        return src.next(x, z, yaw, first, skip);
      },
    };
  }
}
