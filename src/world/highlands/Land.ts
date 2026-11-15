import * as THREE from 'three';
import { Config } from '../../core/Config';
import { clamp, smoothstep } from '../../core/math';
import { createChunkGeometry, type HeightField } from '../Terrain';
import { fieldCoords, type FieldCoords, type HighlandsLayout } from './HighlandsLayout';

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

/**
 * Terrain geometry with `aLand` per vertex: (signed metres from the river's centre line, the
 * farmed mask of the vertex's field and its eight neighbours). The road is painted from the
 * first (smooth: interpolating it is exact enough); the fields from the second, read flat.
 */
export function createLandGeometry(res: number): THREE.BufferGeometry {
  const g = createChunkGeometry(res);
  const n = res + 1;
  g.setAttribute('aLand', new THREE.BufferAttribute(new Float32Array(n * n * 2), 2));
  return g;
}

const fc: FieldCoords = { u: 0, w: 0 };

export function fillLand(
  layout: HighlandsLayout,
  g: THREE.BufferGeometry,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const a = g.getAttribute('aLand') as THREE.BufferAttribute;
  const A = a.array as Float32Array;
  const n = res + 1;
  const step = size / res;
  let lastI = NaN;
  let lastJ = NaN;
  let mask = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      fieldCoords(x, z, fc);
      const fi = Math.floor(fc.u);
      const fj = Math.floor(fc.w);
      if (fi !== lastI || fj !== lastJ) {
        mask = layout.farmMask(fi, fj);
        lastI = fi;
        lastJ = fj;
      }
      const k = (j * n + i) * 2;
      A[k] = clamp(layout.field.riverDist(x, z), -400, 400);
      A[k + 1] = mask;
    }
  a.needsUpdate = true;
}

const FIELD_COLORS = ['#e7c76a', '#8fc466', '#a98262', '#9cc46c', '#f0dd5a'].map(
  (h) => new THREE.Color(h),
);
const H = Config.highlands;
const uniforms = {
  uRoadOff: {
    get value() {
      return H.roadOffset;
    },
  },
  uRoadW: {
    get value() {
      return H.roadWidth;
    },
  },
  uFieldCell: {
    get value() {
      return H.fieldCell;
    },
  },
  uFieldRot: {
    get value() {
      return H.fieldAngle;
    },
  },
  uFieldCols: { value: FIELD_COLORS },
  uRoadCol: { value: new THREE.Color('#cfae80') },
};

const VERT_PARS = /* glsl */ `
attribute vec2 aLand;
varying float vRiver;
flat varying float vMask;
flat varying vec2 vCell;
varying vec3 vLandPos;
varying vec3 vLandN;
uniform float uFieldCell;
uniform float uFieldRot;`;

const VERT = /* glsl */ `
  vLandPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vLandN = normalize(mat3(modelMatrix) * objectNormal);
  vRiver = aLand.x;
  vMask = aLand.y;
  {
    float c = cos(uFieldRot);
    float s = sin(uFieldRot);
    vCell = floor(vec2(vLandPos.x * c - vLandPos.z * s, vLandPos.x * s + vLandPos.z * c) / uFieldCell);
  }`;

const FRAG_PARS = /* glsl */ `
varying float vRiver;
flat varying float vMask;
flat varying vec2 vCell;
varying vec3 vLandPos;
varying vec3 vLandN;
uniform float uRoadOff;
uniform float uRoadW;
uniform float uFieldCell;
uniform float uFieldRot;
uniform vec3 uFieldCols[5];
uniform vec3 uRoadCol;
float lHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lHash(i), lHash(i + vec2(1.0, 0.0)), u.x),
             mix(lHash(i + vec2(0.0, 1.0)), lHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const FRAG = /* glsl */ `
{
  float lUp = normalize(vLandN).y;
  float lDist = distance(vLandPos, cameraPosition);
  float lFine = 1.0 - smoothstep(140.0, 420.0, lDist); // rows fade before they shimmer
  float c = cos(uFieldRot);
  float s = sin(uFieldRot);
  vec2 fp = vec2(vLandPos.x * c - vLandPos.z * s, vLandPos.x * s + vLandPos.z * c) / uFieldCell;
  vec2 id = floor(fp);
  vec2 cf = fp - id;
  // Is this fragment's field farmed? Its bit in the provoking vertex's 3x3 mask (flat, exact):
  // whole fields are farmed or not, so no field fades out across a triangle.
  vec2 d = clamp(id - vCell, -1.0, 1.0);
  float bit = (d.y + 1.0) * 3.0 + d.x + 1.0;
  float farmed = mod(floor(vMask / exp2(bit) + 0.001), 2.0);
  float hn = id.x * id.x * 31.0 + id.y * id.y * 17.0 + id.x * id.y * 7.0 + id.x * 13.0 + id.y * 29.0;
  float kind = mod(mod(hn, 97.0), 6.0);
  float farmAmt = farmed * step(kind, 4.5) * smoothstep(0.8, 0.9, lUp) * smoothstep(0.5, 1.3, vLandPos.y);
  if (farmAmt > 0.0) {
    vec3 fc = kind < 0.5 ? uFieldCols[0] : kind < 1.5 ? uFieldCols[1] : kind < 2.5 ? uFieldCols[2]
      : kind < 3.5 ? uFieldCols[3] : uFieldCols[4];
    // Rows along the field; plough and crop rows show them strongly.
    float rowA = kind > 1.5 && kind < 3.5 ? 0.22 : kind < 0.5 ? 0.07 : 0.03;
    fc *= 1.0 + sin(fp.y * uFieldCell * 2.1 + lNoise(fp * 3.0) * 1.5) * rowA * lFine;
    fc *= 0.9 + 0.2 * lNoise(vLandPos.xz * 0.06 + id * 7.0);
    // A darker, greener margin (the hedge and the wall's foot) round every field.
    float edge = min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)) * uFieldCell;
    fc = mix(fc, diffuseColor.rgb * 0.8, (1.0 - smoothstep(0.8, 2.2, edge)) * 0.75);
    diffuseColor.rgb = mix(diffuseColor.rgb, fc, farmAmt);
  }
  // The road: dirt along one bank, two worn ruts and a grassy crown, on gentle, dry ground.
  float rd = abs(vRiver - uRoadOff);
  float road = (1.0 - smoothstep(uRoadW * 0.8, uRoadW * 1.15, rd)) * smoothstep(0.78, 0.9, lUp)
    * smoothstep(0.3, 0.9, vLandPos.y) * (1.0 - smoothstep(60.0, 75.0, vLandPos.y));
  if (road > 0.0) {
    vec3 rc = uRoadCol * (0.92 + 0.16 * lNoise(vLandPos.xz * 0.4));
    float rut = 1.0 - smoothstep(0.12, 0.35, abs(rd - uRoadW * 0.45));
    rc *= 1.0 - rut * 0.18 * lFine;
    rc = mix(rc, diffuseColor.rgb, (1.0 - smoothstep(0.15, 0.5, rd)) * 0.5 * lFine);
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, road);
  }
}`;

/**
 * Paints the fields and the road on the Highlands' terrain material (after the vertex colour,
 * before the painted ground detail, so they get its mottle too). Apply after withGroundDetail.
 */
export function withLand<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`);
  };
  m.customProgramCacheKey = () => `${prevKey}|land`;
  return m;
}
