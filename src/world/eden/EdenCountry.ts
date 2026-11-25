import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../../core/Config';
import type { DayCycle } from '../DayCycle';
import { commitInstances, markUsed } from '../instances';
import { withMist } from '../Mist';
import { hash2 } from '../noise';
import { getToonGradient } from '../Terrain';
import { colored } from '../Trees';
import { CELL, type Countryside, type Doves } from './countryside';
import type { EdenLayout } from './EdenLayout';
import { heartPoint } from './heart';

const toon = (): THREE.MeshToonMaterial =>
  withMist(
    new THREE.MeshToonMaterial({
      color: '#ffffff',
      vertexColors: true,
      gradientMap: getToonGradient(),
    }),
  );

const FLOWER = ['#f6c9cf', '#fdf6ee', '#f27a9b', '#f8dcc0', '#b59ae0'];
const ROAD_HALF = 4.2; // m from the road's centre to an arch's post
const pt = { x: 0, y: 0 };

/** A flower arch over a road: white posts, an arc of flowers, its lights apart (glow). */
function archGeometry(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const h = 4.2;
  for (const s of [-1, 1])
    parts.push(
      colored(
        new THREE.CylinderGeometry(0.16, 0.2, h, 6).translate(s * ROAD_HALF, h / 2, 0),
        '#fbf8f2',
      ),
    );
  parts.push(
    colored(new THREE.TorusGeometry(ROAD_HALF, 0.22, 5, 18, Math.PI).translate(0, h, 0), '#fbf8f2'),
  );
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    const x = Math.cos(a) * ROAD_HALF;
    const y = h + Math.sin(a) * ROAD_HALF;
    parts.push(
      colored(
        new THREE.IcosahedronGeometry(0.42 + (k % 3) * 0.1, 0).translate(x, y, (k % 2) * 0.2 - 0.1),
        FLOWER[k % FLOWER.length],
      ),
    );
    if (k % 2 === 1)
      glow.push(
        new THREE.IcosahedronGeometry(0.13, 0).translate(
          x * 0.9,
          h + Math.sin(a) * ROAD_HALF * 0.9,
          0.3,
        ),
      );
  }
  // Flowers climbing the posts.
  for (let k = 0; k < 8; k++)
    parts.push(
      colored(
        new THREE.IcosahedronGeometry(0.3, 0).translate(
          (k % 2 ? 1 : -1) * ROAD_HALF,
          0.6 + (k >> 1) * 0.9,
          0.2,
        ),
        FLOWER[(k + 2) % FLOWER.length],
      ),
    );
  return { body: merge(parts), glow: merge(glow) };
}

/** A string of fairy lights and bunting across the road between two poles. */
function lightsGeometry(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const h = 5.2;
  const w = ROAD_HALF + 0.8;
  for (const s of [-1, 1])
    parts.push(
      colored(new THREE.CylinderGeometry(0.1, 0.13, h, 5).translate(s * w, h / 2, 0), '#8a6a4e'),
    );
  const n = 14;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = (t * 2 - 1) * w;
    const y = h - 1.1 * Math.sin(t * Math.PI); // the string's sag
    glow.push(new THREE.IcosahedronGeometry(0.12, 0).translate(x, y - 0.12, 0));
    if (k < n && k % 2 === 0) {
      // A pennant hanging from the string.
      const flag = new THREE.BufferGeometry();
      flag.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([x, y, 0, x + 0.55, y, 0, x + 0.27, y - 0.75, 0], 3),
      );
      flag.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      flag.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      parts.push(colored(flag, FLOWER[(k / 2) % FLOWER.length]));
    }
  }
  return { body: merge(parts), glow: merge(glow) };
}

/** A blossom tree: a pale trunk and a cloud of pink blossom. */
function blossomGeometry(): THREE.BufferGeometry {
  return merge([
    colored(new THREE.CylinderGeometry(0.22, 0.38, 3.6, 5).translate(0, 1.8, 0), '#8c6b5a'),
    colored(
      new THREE.IcosahedronGeometry(2.3, 0).scale(1, 0.85, 1).translate(0, 4.8, 0),
      '#f5b3c6',
    ),
    colored(new THREE.IcosahedronGeometry(1.7, 0).translate(1.1, 5.6, 0.5), '#fbd3df'),
    colored(new THREE.IcosahedronGeometry(1.6, 0).translate(-1.0, 5.3, -0.6), '#f29db6'),
  ]);
}

/** A heart of cloud puffs, standing upright (x across, y up), about 2 m across: scaled. */
function heartCloudGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 22; k++) {
    heartPoint(k / 22, pt);
    parts.push(
      colored(
        new THREE.IcosahedronGeometry(0.34 + 0.05 * (k % 3), 1).translate(pt.x, pt.y, 0),
        k % 2 ? '#ffe4ec' : '#fff1f5',
      ),
    );
  }
  // Fill the middle.
  for (const [x, y, r] of [
    [-0.4, 0.35, 0.42],
    [0.4, 0.35, 0.42],
    [0, 0, 0.45],
    [0, -0.4, 0.33],
  ] as const)
    parts.push(colored(new THREE.IcosahedronGeometry(r, 1).translate(x, y, 0), '#ffeaf0'));
  return merge(parts);
}

/** A dove: a white body and two wings whose vertices carry how far out they are (aWing). */
function doveGeometry(): THREE.BufferGeometry {
  const body = new THREE.IcosahedronGeometry(0.28, 0).scale(0.7, 0.6, 1.5).toNonIndexed();
  const pos: number[] = [...(body.getAttribute('position').array as Float32Array)];
  const wing: number[] = new Array<number>(pos.length / 3).fill(0);
  for (const s of [-1, 1]) {
    // A swept triangle each side, out along x.
    const tri = [0, 0, 0.25, s * 1.1, 0.05, -0.15, 0, 0, -0.3];
    pos.push(...tri);
    wing.push(0, 1, 0);
    pos.push(0, 0, 0.25, 0, 0, -0.3, s * 1.1, 0.05, -0.15);
    wing.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  body.dispose();
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(flat);
  for (const p of new Set([...parts, ...flat])) if (p !== g) p.dispose();
  return g;
}

const ARCH_CAP = 160;
const TREE_CAP = 900;
const CLOUD_CAP = 40;
const DOVE_CAP = 260;

/**
 * Draws Eden's countryside round the bird: the cells within `decorCells` of its own, refilled
 * when it crosses into another cell (never per frame). Also the doves over the story's stops,
 * and the petals drifting in the air round the camera (in the shader: no CPU per frame).
 */
export class EdenCountry {
  readonly group = new THREE.Group();
  private readonly arches: THREE.InstancedMesh;
  private readonly archGlow: THREE.InstancedMesh;
  private readonly lights: THREE.InstancedMesh;
  private readonly lightGlow: THREE.InstancedMesh;
  private readonly trees: THREE.InstancedMesh;
  private readonly clouds: THREE.InstancedMesh;
  private readonly doves: THREE.InstancedMesh;
  private readonly doveCircle: THREE.InstancedBufferAttribute;
  private readonly doveMotion: THREE.InstancedBufferAttribute;
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  private readonly glowBase = new THREE.Color('#ffd9a0');
  private readonly cloudMat: THREE.MeshToonMaterial;
  private readonly doveMat: THREE.ShaderMaterial;
  private readonly petalMat: THREE.ShaderMaterial;
  private readonly siteDoves: Doves[];
  private ci = NaN;
  private cj = NaN;

  constructor(
    private readonly country: Countryside,
    layout: EdenLayout,
  ) {
    const a = archGeometry();
    const l = lightsGeometry();
    const body = toon();
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, cap: number, name: string) => {
      const mesh = new THREE.InstancedMesh(g, m, cap);
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false; // spread over kilometres
      mesh.castShadow = m === body;
      this.group.add(mesh);
      return mesh;
    };
    this.arches = inst(a.body, body, ARCH_CAP, 'flower arches');
    this.archGlow = inst(a.glow, this.glowMat, ARCH_CAP, 'arch lights');
    this.lights = inst(l.body, body, ARCH_CAP, 'bunting');
    this.lightGlow = inst(l.glow, this.glowMat, ARCH_CAP, 'fairy lights');
    this.trees = inst(blossomGeometry(), body, TREE_CAP, 'blossom trees');
    this.cloudMat = toon();
    this.cloudMat.emissive = new THREE.Color('#ffc8d6');
    this.cloudMat.emissiveIntensity = 0.35;
    this.clouds = inst(heartCloudGeometry(), this.cloudMat, CLOUD_CAP, 'heart clouds');
    this.clouds.castShadow = false;

    const dg = doveGeometry();
    this.doveCircle = new THREE.InstancedBufferAttribute(new Float32Array(DOVE_CAP * 4), 4);
    this.doveMotion = new THREE.InstancedBufferAttribute(new Float32Array(DOVE_CAP * 3), 3);
    dg.setAttribute('aCircle', this.doveCircle);
    dg.setAttribute('aMotion', this.doveMotion);
    this.doveMat = doveMaterial();
    this.doves = inst(dg, this.doveMat, DOVE_CAP, 'doves');
    this.doves.castShadow = false;

    // Two doves over each picture, a few over the venue.
    const L = layout;
    this.siteDoves = [
      { x: L.tal.x, y: L.tal.y + 28, z: L.tal.z, r: 14, speed: 0.45, phase: 0, count: 2 },
      { x: L.hadar.x, y: L.hadar.y + 28, z: L.hadar.z, r: 14, speed: -0.45, phase: 1, count: 2 },
      { x: L.venue.x, y: L.venue.y + 40, z: L.venue.z, r: 30, speed: 0.3, phase: 2, count: 6 },
    ];

    this.petalMat = petalMaterial();
    const n = Config.eden.petals;
    const pg = new THREE.BufferGeometry();
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seeds[i * 4] = hash2(i, 1, 81);
      seeds[i * 4 + 1] = hash2(i, 2, 82);
      seeds[i * 4 + 2] = hash2(i, 3, 83);
      seeds[i * 4 + 3] = hash2(i, 4, 84);
    }
    // Positions are made in the shader; three still wants a position attribute to count.
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const petals = new THREE.Points(pg, this.petalMat);
    petals.name = 'petals';
    petals.frustumCulled = false;
    this.group.add(petals);
  }

  /** Refill when the bird crosses into another cell. */
  update(px: number, pz: number): void {
    const ci = Math.floor(px / CELL);
    const cj = Math.floor(pz / CELL);
    if (ci === this.ci && cj === this.cj) return;
    this.ci = ci;
    this.cj = cj;
    const R = Config.eden.decorCells;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    let na = 0;
    let nl = 0;
    let nt = 0;
    let nc = 0;
    let nd = 0;
    const addDoves = (D: Doves) => {
      for (let k = 0; k < D.count && nd < DOVE_CAP; k++, nd++) {
        // Each a little apart round the circle, a little higher or lower.
        this.doveCircle.setXYZW(nd, D.x, D.y + ((k % 3) - 1) * 2, D.z, D.r + (k % 2) * 3);
        this.doveMotion.setXYZ(nd, D.speed, D.phase + k * 0.45, k * 1.7);
      }
    };
    for (const D of this.siteDoves) addDoves(D);
    for (let j = cj - R; j <= cj + R; j++)
      for (let i = ci - R; i <= ci + R; i++) {
        const c = this.country.cell(i, j);
        for (const A of c.arches) {
          q.setFromAxisAngle(up, A.yaw); // local z along the road: the span runs across it
          m.compose(p.set(A.x, A.y, A.z), q, sc);
          if (A.kind === 0 && na < ARCH_CAP) {
            this.arches.setMatrixAt(na, m);
            this.archGlow.setMatrixAt(na++, m);
          } else if (A.kind === 1 && nl < ARCH_CAP) {
            this.lights.setMatrixAt(nl, m);
            this.lightGlow.setMatrixAt(nl++, m);
          }
        }
        for (const G of c.groves) {
          const T = G.trees;
          for (let k = 0; k < T.length && nt < TREE_CAP; k += 3) {
            q.setFromAxisAngle(up, k * 1.3);
            const s = 0.85 + 0.3 * hash2(k, nt, 5);
            m.compose(p.set(T[k], T[k + 1] - 0.2, T[k + 2]), q, sc.set(s, s, s));
            this.trees.setMatrixAt(nt++, m);
          }
          sc.set(1, 1, 1);
        }
        for (const C of c.clouds) {
          if (nc >= CLOUD_CAP) break;
          // Turned to face the bird as it was when this cell came into view.
          q.setFromAxisAngle(up, Math.atan2(px - C.x, pz - C.z));
          m.compose(p.set(C.x, C.y, C.z), q, sc.set(C.scale, C.scale, C.scale * 0.6));
          this.clouds.setMatrixAt(nc++, m);
          sc.set(1, 1, 1);
        }
        for (const D of c.doves) addDoves(D);
      }
    commitInstances(this.arches, na);
    commitInstances(this.archGlow, na);
    commitInstances(this.lights, nl);
    commitInstances(this.lightGlow, nl);
    commitInstances(this.trees, nt);
    commitInstances(this.clouds, nc);
    this.doves.count = nd;
    markUsed(this.doveCircle, nd);
    markUsed(this.doveMotion, nd);
  }

  frame(time: number, day: DayCycle): void {
    const stars = day.palette.stars;
    const flicker = 0.93 + 0.07 * Math.sin(time * 5.1);
    this.glowMat.color
      .copy(this.glowBase)
      .multiplyScalar((0.85 + Config.eden.lightGlow * stars) * flicker);
    this.doveMat.uniforms.uTime.value = time;
    this.doveMat.uniforms.uLight.value = 1 - 0.55 * stars;
    this.petalMat.uniforms.uTime.value = time;
    this.petalMat.uniforms.uLight.value = 1 - 0.6 * stars;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

/** Doves on their circles, flapping now and then: everything placed in the vertex shader. */
function doveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aWing;
      attribute vec4 aCircle; // centre, radius
      attribute vec3 aMotion; // speed (rad/s, signed), phase, flap phase
      uniform float uTime;
      varying float vShade;
      void main() {
        float a = aMotion.y + aMotion.x * uTime;
        vec3 c = aCircle.xyz + vec3(sin(a) * aCircle.w, sin(uTime * 0.7 + aMotion.z) * 1.5, cos(a) * aCircle.w);
        // Heading along the circle (its tangent), banked a little into the turn.
        float yaw = a + sign(aMotion.x) * 1.5708;
        // Flap in bursts, glide between.
        float burst = smoothstep(0.2, 0.8, sin(uTime * 0.9 + aMotion.z));
        float flap = sin(uTime * 11.0 + aMotion.z * 3.0) * 0.55 * burst + 0.12;
        vec3 p = position;
        p.y += aWing * flap * abs(p.x);
        p *= 2.4;
        float bank = -sign(aMotion.x) * 0.3;
        float cb = cos(bank), sb = sin(bank);
        p = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
        float cy = cos(yaw), sy = sin(yaw);
        p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
        vShade = 0.82 + 0.18 * step(0.0, position.y) + 0.1 * aWing;
        gl_Position = projectionMatrix * viewMatrix * vec4(c + p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying float vShade;
      void main() {
        gl_FragColor = vec4(vec3(0.98, 0.97, 0.95) * vShade * uLight, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

/**
 * Petals drifting down and along the breeze in a box of air round the camera: each wraps
 * round the box (so the air is always full wherever the bird flies) and fades near its edge.
 */
function petalMaterial(): THREE.ShaderMaterial {
  const E = Config.eden;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: E.petalBox },
      uLight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uBox;
      varying float vFade;
      varying float vHue;
      varying float vTurn;
      void main() {
        vec3 drift = vec3(1.3, -0.9, 0.6) * (0.6 + aSeed.w) * uTime;
        drift.x += sin(uTime * 0.8 + aSeed.w * 20.0) * 1.5;
        vec3 w = aSeed.xyz * uBox + drift - cameraPosition;
        w = mod(w, uBox) - 0.5 * uBox + cameraPosition;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        vFade = 1.0 - smoothstep(0.3 * uBox, 0.5 * uBox, length(w - cameraPosition));
        vHue = aSeed.w;
        vTurn = uTime * (0.5 + aSeed.x) + aSeed.y * 6.28;
        gl_PointSize = clamp(200.0 / -mv.z, 0.0, 12.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying float vFade;
      varying float vHue;
      varying float vTurn;
      void main() {
        // A petal: an ellipse turning as it falls.
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vTurn), s = sin(vTurn);
        p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        float d = length(p * vec2(1.0, 2.1));
        if (d > 0.5 || vFade <= 0.0) discard;
        vec3 col = mix(vec3(0.98, 0.62, 0.72), vec3(1.0, 0.84, 0.88), step(0.55, vHue));
        gl_FragColor = vec4(col * uLight, vFade * (1.0 - smoothstep(0.4, 0.5, d)));
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}
