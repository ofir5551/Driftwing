import * as THREE from 'three';
import { Config } from '../../core/Config';
import { clamp, smoothstep } from '../../core/math';
import type { HeightField } from '../Terrain';

// Ground palette (sRGB; the toon material and fog tint it per time of day).
const sand = new THREE.Color('#ead7a6');
const lakebed = new THREE.Color('#6f9c9a');
const pebble = new THREE.Color('#c9bfae');
const grass = new THREE.Color('#a6d07c');
const meadow = new THREE.Color('#dbdc8c');
const forestC = new THREE.Color('#6fa36e');
const rock = new THREE.Color('#a497a9');
const high = new THREE.Color('#efe6f2');
const tmp = new THREE.Color();

/**
 * The Highlands' ground colour: the default palette with narrow beaches (the flood plains sit
 * only a couple of metres up and must stay grass), sand or pebbles by the tint noise, pebbly
 * lake and river beds, rock on the bluffs the rivers cut.
 */
export function landColor(
  field: HeightField,
  x: number,
  z: number,
  y: number,
  slope: number,
  out: THREE.Color,
): THREE.Color {
  const t = field.tint(x, z);
  if (y < Config.world.waterLevel - 0.3) {
    out.copy(lakebed).lerp(pebble, smoothstep(-3, -0.3, y));
  } else {
    tmp.copy(grass).lerp(meadow, clamp(t * 0.8 + 0.35, 0, 1));
    tmp.lerp(forestC, field.forest(x, z) * 0.85);
    out
      .copy(sand)
      .lerp(pebble, smoothstep(-0.2, 0.5, t))
      .lerp(tmp, smoothstep(0.2, 1.5, y));
    out.lerp(rock, smoothstep(0.4, 0.72, slope + smoothstep(50, 90, y) * 0.15));
    out.lerp(high, smoothstep(105, 140, y + t * 12));
  }
  // Soft banding every 22 m, as the default: brush strokes on the hills.
  const band = Math.sin((y / 22) * Math.PI * 2 + t * 3) * 0.5 + 0.5;
  out.multiplyScalar(0.93 + smoothstep(0.3, 0.7, band) * 0.07);
  return out;
}
