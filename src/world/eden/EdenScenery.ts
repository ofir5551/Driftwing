import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../../core/Config';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { colored } from '../Trees';
import { hash2 } from '../noise';
import { VENUE, type EdenLayout, type Frame } from './EdenLayout';
import { EDEN_PHOTOS, photoUrl, type EdenPhoto } from './photos';
import { heartPoint } from './heart';
import { SkyWords } from './SkyWords';

const toon = (hex: string, vertexColors = false): THREE.MeshToonMaterial =>
  withMist(
    new THREE.MeshToonMaterial({
      color: vertexColors ? '#ffffff' : hex,
      vertexColors,
      gradientMap: getToonGradient(),
    }),
  );

/** Browser only: Vitest builds worlds in Node, with no images or canvas. */
const hasDom = typeof document !== 'undefined';

/** A picture as a texture, filled once its photo is unveiled (none in Node). */
function photoTexture(photo: EdenPhoto): THREE.Texture | null {
  if (!hasDom) return null;
  const t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  void photoUrl(photo).then((url) =>
    new THREE.ImageLoader().load(url, (img) => {
      t.image = img;
      t.needsUpdate = true;
    }),
  );
  return t;
}

/** A name painted on a cream plaque (the caption under a picture), and a date under it. */
function plaqueTexture(text: string, date?: string): THREE.Texture | null {
  if (!hasDom) return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fbf4e6';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#c9a24e';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#7a5a2a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (date) {
    g.font = 'italic 600 50px Georgia, "Times New Roman", serif';
    g.fillText(text, 256, 50);
    g.font = '500 30px Georgia, "Times New Roman", serif';
    g.fillText(date, 256, 96);
  } else {
    g.font = 'italic 600 64px Georgia, "Times New Roman", serif';
    g.fillText(text, 256, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) =>
  colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

/** Flowers: soft blobs in the wedding's colours. */
const FLOWER = ['#f6c9cf', '#fdf6ee', '#f2a7b3', '#f8dcc0'];

/**
 * Everything Eden adds to the Highlands: the three pictures on their easels, the venue (glass
 * hall under its white wave roof, round turquoise pool with a pier and boats, paving, the
 * ceremony's chairs and chuppah, an olive tree, tall trees, poolside lamps) and the sky
 * lanterns that rise over it once the couple are reached. Built once (it is one place).
 */
export class EdenScenery {
  readonly group = new THREE.Group();
  private readonly photoMats: THREE.MeshBasicMaterial[] = [];
  private readonly glassMat: THREE.MeshToonMaterial;
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  private readonly lampBase = new THREE.Color('#ffd9a0');
  private readonly warm = new THREE.Color('#ffb877');
  private readonly lanternMat: THREE.ShaderMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  /** 0..1 how far the lanterns have come up (eases to 1 once the couple are reached). */
  private lanterns = 0;
  private celebrating = false;
  private readonly words: SkyWords;

  constructor(private readonly layout: EdenLayout) {
    this.glassMat = toon('#a9d2d4');
    this.glassMat.emissive = new THREE.Color('#000000');
    this.lanternMat = this.makeLanternMaterial();
    EDEN_PHOTOS.forEach((p, i) => this.addFrame(layout.frames[i], p));
    this.addVenue();
    this.addHeartBeds();
    this.words = new SkyWords(layout);
    this.group.add(this.words.group);
  }

  /** The couple were reached: lanterns rise over the venue for the rest of the flight. */
  celebrate(): void {
    this.celebrating = true;
    this.words.start();
  }

  /** A new flight starts the story over (the lanterns wait for the couple again). */
  reset(): void {
    this.celebrating = false;
    this.words.reset();
  }

  frame(dt: number, time: number, day: DayCycle): void {
    const E = Config.eden;
    const stars = day.palette.stars;
    // The pictures take the daylight but never go dark: lamplight keeps them at night.
    const lit = 1 - 0.45 * stars;
    for (const m of this.photoMats) m.color.setScalar(lit);
    // The hall glows warm through its glass as the light goes.
    this.glassMat.emissive.copy(this.warm).multiplyScalar(0.55 * stars);
    const flicker = 0.92 + 0.08 * Math.sin(time * 7.3);
    this.lampMat.color.copy(this.lampBase).multiplyScalar((0.9 + E.lampGlow * stars) * flicker);
    // Lanterns: up after the couple are reached (easing in), and every night anyway (the
    // stars come out slowly enough to follow them as they are, paused or not).
    this.lanterns += ((this.celebrating ? 1 : 0) - this.lanterns) * Math.min(1, dt * 0.6);
    const night = Math.min(1, Math.max(0, (stars - 0.35) * 2));
    const u = this.lanternMat.uniforms;
    u.uTime.value = time;
    u.uOn.value = Math.max(this.lanterns, night);
    u.uGlow.value = E.lanternGlow * (0.7 + 0.5 * stars);
    this.words.frame(dt, time, stars);
  }

  dispose(): void {
    this.words.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
    this.geometries.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = m instanceof THREE.MeshToonMaterial;
    return mesh;
  }

  /** A picture on a white easel with a gold frame, flowers and its name on a plaque. */
  private addFrame(F: Frame, photo: EdenPhoto): void {
    const caption = photo.caption;
    const g = new THREE.Group();
    g.position.set(F.x, F.ground, F.z);
    g.rotation.y = F.yaw; // local +z faces the bird
    const w = F.half * 2;
    const h = F.y1 - F.y0;
    const foot = F.y0 - F.ground;
    const cy = foot + h / 2;
    const tex = photoTexture(photo);
    if (tex) this.textures.push(tex);
    const photoMat = new THREE.MeshBasicMaterial({ map: tex, color: '#ffffff' });
    if (!tex) photoMat.color.set('#e9dccb');
    this.photoMats.push(photoMat);
    const pic = this.mesh(new THREE.PlaneGeometry(w, h).translate(0, cy, 0.42), photoMat, 'photo');
    const b = 0.9; // frame border
    const gold = '#d9b45c';
    const parts = [
      // Frame, back board and easel legs.
      box(w + b * 2, b, 0.8, 0, foot + h + b / 2, 0, gold),
      box(w + b * 2, b, 0.8, 0, foot - b / 2, 0, gold),
      box(b, h, 0.8, -(w + b) / 2, cy, 0, gold),
      box(b, h, 0.8, (w + b) / 2, cy, 0, gold),
      box(w, h, 0.4, 0, cy, -0.1, '#f3ece0'),
      box(0.7, foot + h * 0.4, 0.7, -w * 0.32, (foot + h * 0.4) / 2, -0.5, '#fbf7f0'),
      box(0.7, foot + h * 0.4, 0.7, w * 0.32, (foot + h * 0.4) / 2, -0.5, '#fbf7f0'),
      box(0.6, foot + h * 0.8, 0.6, 0, (foot + h * 0.8) / 2, -2.6, '#fbf7f0').rotateX(-0.12),
    ];
    // Garlands: clusters of flowers at the bottom corners and along the top.
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const corner = i < 5 ? -1 : i > 10 ? 1 : 0;
      const x =
        corner === 0 ? (t - 0.5) * (w + b) : corner * (w / 2 + b / 2 - ((i % 5) / 4) * w * 0.18);
      const y = corner === 0 ? foot + h + b * 0.9 : foot - b * 0.4 + (i % 2) * 0.7;
      const r = 0.55 + (i % 3) * 0.15;
      parts.push(
        colored(
          new THREE.IcosahedronGeometry(r, 0).translate(x, y, 0.6),
          FLOWER[i % FLOWER.length],
        ),
      );
    }
    g.add(this.mesh(mergeGeometries(parts), toon('#ffffff', true), 'easel'));
    for (const p of parts) p.dispose();
    g.add(pic);
    const plaque = plaqueTexture(caption, photo.date);
    if (plaque) {
      this.textures.push(plaque);
      // As tall as the easel's foot allows, so a name reads from the air.
      const pw = Math.min(w * 0.7, (foot - 0.8) * 4, 14);
      g.add(
        this.mesh(
          new THREE.PlaneGeometry(pw, pw / 4).translate(0, foot * 0.5, 0.25),
          new THREE.MeshBasicMaterial({ map: plaque }),
          'plaque',
        ),
      );
    }
    this.group.add(g);
  }

  /**
   * Beds of roses planted as hearts: before each picture, between it and the bird coming in,
   * and on the venue's lawn by the beacon. The lobes point away from the bird, so each heart
   * reads upright on the way in.
   */
  private addHeartBeds(): void {
    const L = this.layout;
    const beds: { x: number; y: number; z: number; up: number; size: number }[] = [];
    for (const S of [L.tal, L.hadar]) {
      const fx = Math.sin(S.yaw);
      const fz = Math.cos(S.yaw);
      beds.push({ x: S.x + fx * 16, y: S.y, z: S.z + fz * 16, up: S.yaw + Math.PI, size: 6 });
    }
    const v = L.toWorld(VENUE.beacon.u, VENUE.beacon.v + 16);
    beds.push({ x: v.x, y: L.venue.y, z: v.z, up: L.venue.yaw + Math.PI, size: 9 });
    const ROSES = ['#e8506f', '#f27a9b', '#fdf6ee', '#f8c6d2'];
    const pt = { x: 0, y: 0 };
    const parts: THREE.BufferGeometry[] = [];
    for (const B of beds) {
      const c = Math.cos(B.up);
      const sn = Math.sin(B.up);
      const n = Math.round(B.size * 7);
      for (let k = 0; k < n; k++) {
        heartPoint(k / n, pt);
        // The heart's y (its lobes) along `up`, its x across.
        const x = B.x + (pt.x * c + pt.y * sn) * B.size;
        const z = B.z + (-pt.x * sn + pt.y * c) * B.size;
        parts.push(
          colored(
            new THREE.IcosahedronGeometry(0.55 + 0.12 * (k % 3), 0)
              .scale(1, 0.7, 1)
              .translate(x, B.y + 0.35, z),
            ROSES[k % ROSES.length],
          ),
        );
      }
    }
    this.group.add(this.mesh(mergeGeometries(parts), toon('#ffffff', true), 'heart beds'));
    for (const p of parts) p.dispose();
  }

  private addVenue(): void {
    const L = this.layout;
    const V = L.venue;
    const g = new THREE.Group();
    g.position.set(V.x, V.y, V.z);
    g.rotation.y = V.yaw; // local x is u, local z is v
    const P = VENUE.pool;

    // Paving round the pool and a terrace toward the hall, a white rim, and the water.
    const paving = this.mesh(
      new THREE.RingGeometry(P.r + 1.4, P.r + 9, 64).rotateX(-Math.PI / 2).translate(P.u, 0.1, P.v),
      toon('#d9d3c6'),
      'paving',
    );
    const terrace = this.mesh(
      new THREE.PlaneGeometry(46, 14).rotateX(-Math.PI / 2).translate(0, 0.12, -19),
      toon('#d9d3c6'),
      'terrace',
    );
    for (const m of [paving, terrace]) {
      const mat = m.material as THREE.MeshToonMaterial;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      m.castShadow = false;
      m.receiveShadow = true;
    }
    const rim = this.mesh(
      new THREE.TorusGeometry(P.r + 0.7, 0.7, 6, 72).rotateX(-Math.PI / 2).translate(P.u, 0.3, P.v),
      toon('#fbf8f2'),
      'pool rim',
    );
    const water = this.mesh(
      new THREE.CircleGeometry(P.r + 0.2, 72).rotateX(-Math.PI / 2).translate(P.u, 0.35, P.v),
      new THREE.MeshToonMaterial({
        color: '#3fc6cf',
        emissive: '#0d5a63',
        gradientMap: getToonGradient(),
      }),
      'pool',
    );
    water.castShadow = false;
    water.receiveShadow = true;
    g.add(paving, terrace, rim, water);

    // The pier and two little boats.
    const D = VENUE.pier;
    const white: THREE.BufferGeometry[] = [
      box(D.half * 2, 0.5, D.width * 2, 0, 0.75, 0, '#fbf8f2')
        .rotateY(D.turn)
        .translate(D.u, 0, D.v),
      box(5, 0.5, 3, 0, 0.75, 0, '#fbf8f2')
        .rotateY(D.turn)
        .translate(D.u - Math.cos(D.turn) * D.half, 0, D.v + Math.sin(D.turn) * D.half),
    ];
    for (const [u, v, turn] of [
      [8, 18, 0.4],
      [-14, 22, 2.2],
    ] as const) {
      white.push(
        colored(
          new THREE.SphereGeometry(1, 10, 6)
            .scale(1.3, 0.45, 2.8)
            .translate(0, 0.45, 0)
            .rotateY(turn)
            .translate(u, 0, v),
          '#fdfbf6',
        ),
      );
    }

    // The hall: glass between timber posts, a white wave roof with its sailed ends.
    const H = VENUE.hall;
    const glass = this.mesh(
      new THREE.BoxGeometry(H.halfU * 2, H.height, H.halfV * 2).translate(0, H.height / 2, H.v),
      this.glassMat,
      'hall glass',
    );
    const timber: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = -H.halfU + (i / 10) * H.halfU * 2;
      timber.push(box(0.5, H.height, 0.5, u, H.height / 2, H.v + H.halfV + 0.1, '#8a5a36'));
      timber.push(box(0.5, H.height, 0.5, u, H.height / 2, H.v - H.halfV - 0.1, '#8a5a36'));
    }
    timber.push(box(H.halfU * 2, 0.5, 0.6, 0, H.height * 0.55, H.v + H.halfV + 0.15, '#8a5a36'));
    // The terrace's pergola before the hall: slats on posts.
    for (let i = 0; i < 9; i++)
      timber.push(box(0.35, 0.35, 10, -12 + i * 3, 4.2, H.v + H.halfV + 5, '#a8784e'));
    for (const u of [-13, 13])
      for (const v of [H.v + H.halfV + 1, H.v + H.halfV + 9.5])
        timber.push(box(0.4, 4.2, 0.4, u, 2.1, v, '#a8784e'));
    g.add(glass, this.mesh(mergeGeometries(timber), toon('#ffffff', true), 'timber'));
    const roofMat = toon('#fbf8f2');
    roofMat.side = THREE.DoubleSide; // the shell is seen from above and from under its rim
    g.add(this.mesh(this.roofGeometry(), roofMat, 'wave roof'));

    // The ceremony: chairs in rows either side of an aisle, facing the chuppah.
    const C = VENUE.chairs;
    const chair = mergeGeometries([
      box(0.9, 0.12, 0.9, 0, 0.9, 0, '#ffffff'),
      box(0.9, 1.0, 0.12, 0, 1.4, 0.45, '#ffffff'),
      box(0.1, 0.9, 0.1, -0.38, 0.45, -0.38, '#f1ece4'),
      box(0.1, 0.9, 0.1, 0.38, 0.45, -0.38, '#f1ece4'),
      box(0.1, 0.9, 0.1, -0.38, 0.45, 0.38, '#f1ece4'),
      box(0.1, 0.9, 0.1, 0.38, 0.45, 0.38, '#f1ece4'),
    ]);
    this.geometries.push(chair);
    const count = C.rows * C.perSide * 2;
    const chairs = new THREE.InstancedMesh(chair, toon('#ffffff', true), count);
    chairs.name = 'chairs';
    chairs.castShadow = true;
    const m = new THREE.Matrix4();
    let n = 0;
    for (let r = 0; r < C.rows; r++)
      for (let side = -1; side <= 1; side += 2)
        for (let k = 0; k < C.perSide; k++) {
          const u = C.u + side * (C.aisle / 2 + 0.6 + k * C.gap);
          // Scaled up a touch so a row reads from the air.
          chairs.setMatrixAt(n++, m.makeScale(1.3, 1.3, 1.3).setPosition(u, 0, C.v + r * C.pitch));
        }
    chairs.instanceMatrix.needsUpdate = true;
    const runnerLen = C.rows * C.pitch + 10;
    const runner = this.mesh(
      new THREE.PlaneGeometry(C.aisle - 0.6, runnerLen)
        .rotateX(-Math.PI / 2)
        .translate(C.u, 0.14, C.v - 6 + runnerLen / 2 - 1),
      toon('#fbf6f0'),
      'aisle',
    );
    (runner.material as THREE.Material).polygonOffset = true;
    (runner.material as THREE.Material).polygonOffsetFactor = -2;
    runner.castShadow = false;
    g.add(chairs, runner);

    // The chuppah: four white posts, a draped canopy, flowers at its corners.
    const Ch = VENUE.chuppah;
    const ch: THREE.BufferGeometry[] = [];
    for (const a of [-1, 1])
      for (const b of [-1, 1])
        ch.push(
          box(
            0.3,
            Ch.height,
            0.3,
            Ch.u + a * Ch.half,
            Ch.height / 2,
            Ch.v + b * Ch.half,
            '#fbf8f2',
          ),
        );
    ch.push(
      colored(
        new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
          .scale(Ch.half * 1.25, 0.7, Ch.half * 1.25)
          .translate(Ch.u, Ch.height, Ch.v),
        '#fffdf8',
      ),
    );
    for (let i = 0; i < 12; i++) {
      const a = i < 6 ? -1 : 1;
      const b = i % 2 === 0 ? -1 : 1;
      const y = Ch.height - (i % 3) * 0.7;
      ch.push(
        colored(
          new THREE.IcosahedronGeometry(0.45 + (i % 3) * 0.1, 0).translate(
            Ch.u + a * Ch.half + (i % 3) * 0.2,
            y,
            Ch.v + b * Ch.half,
          ),
          FLOWER[i % FLOWER.length],
        ),
      );
    }

    // The olive tree by the paving, silver-green.
    const Ol = VENUE.olive;
    const olive: THREE.BufferGeometry[] = [
      colored(new THREE.CylinderGeometry(0.45, 0.8, 3.6, 6).translate(Ol.u, 1.8, Ol.v), '#6d5a48'),
    ];
    for (const [du, dy, dv, r] of [
      [0, 4.6, 0, 3.2],
      [2.2, 4.0, 1.2, 2.3],
      [-2.1, 4.2, -0.8, 2.4],
      [0.6, 5.6, -1.4, 2.0],
    ] as const)
      olive.push(
        colored(
          new THREE.IcosahedronGeometry(r, 1).scale(1, 0.72, 1).translate(Ol.u + du, dy, Ol.v + dv),
          '#9fae8a',
        ),
      );

    // Poolside lamps all round the paving.
    const lamps: THREE.BufferGeometry[] = [];
    const glows: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const u = P.u + Math.sin(a) * (P.r + 6.5);
      const v = P.v + Math.cos(a) * (P.r + 6.5);
      if (v < P.v - P.r + 2) continue; // none in front of the hall's terrace
      lamps.push(
        colored(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 5).translate(u, 1.6, v), '#3e3a36'),
      );
      glows.push(new THREE.IcosahedronGeometry(0.32, 1).translate(u, 3.35, v));
    }
    // Strings of lights across the pergola.
    for (let i = 0; i < 18; i++)
      glows.push(
        new THREE.IcosahedronGeometry(0.2, 0).translate(
          -12 + (i % 9) * 3,
          4.6,
          H.v + H.halfV + 3 + Math.floor(i / 9) * 4,
        ),
      );
    white.push(...ch);
    g.add(
      this.mesh(mergeGeometries(white), toon('#ffffff', true), 'pier, boats and chuppah'),
      this.mesh(mergeGeometries(olive), toon('#ffffff', true), 'olive'),
      this.mesh(mergeGeometries(lamps), toon('#ffffff', true), 'lamps'),
      this.mesh(mergeGeometries(glows), this.lampMat, 'lamp glow'),
    );
    for (const list of [white, olive, lamps, glows, timber]) for (const p of list) p.dispose();
    this.group.add(g);

    // Tall trees round the back (world coordinates).
    const trees: THREE.BufferGeometry[] = [];
    for (const t of L.venueTrees()) {
      if (t.cypress) {
        trees.push(
          colored(
            new THREE.ConeGeometry(1.8, t.h, 7).translate(t.x, V.y + t.h / 2 + 0.5, t.z),
            '#4f7a52',
          ),
        );
        continue;
      }
      trees.push(
        colored(
          new THREE.CylinderGeometry(0.4, 0.7, t.h * 0.55, 5).translate(t.x, V.y + t.h * 0.27, t.z),
          '#cfc2b0',
        ),
      );
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + t.x * 0.01;
        trees.push(
          colored(
            new THREE.IcosahedronGeometry(3.6 - k * 0.4, 1)
              .scale(1, 0.8, 1)
              .translate(
                t.x + Math.sin(a) * 2.2,
                V.y + t.h * (0.62 + k * 0.12),
                t.z + Math.cos(a) * 2.2,
              ),
            k === 1 ? '#7fa66c' : '#6e9a63',
          ),
        );
      }
    }
    this.group.add(this.mesh(mergeGeometries(trees), toon('#ffffff', true), 'venue trees'));
    for (const t of trees) t.dispose();

    this.addLanterns();
  }

  /**
   * The wave roof as one shell over its elliptical footprint, its top from `roofTop`, with a
   * fascia round the rim and the two sailed ends down to the ground (as the venue's shell).
   */
  private roofGeometry(): THREE.BufferGeometry {
    const L = this.layout;
    const R = VENUE.roof;
    const H = VENUE.hall;
    const y0 = L.venue.y;
    const rings = 14;
    const segs = 72;
    const pos: number[] = [];
    const idx: number[] = [];
    const at = (rho: number, th: number) => {
      const u = R.u + Math.cos(th) * R.a * rho;
      const v = R.v + Math.sin(th) * R.b * rho;
      const top = L.roofTop(u, v);
      return [u, (Number.isFinite(top) ? top : y0 + H.height) - y0, v];
    };
    for (let r = 0; r <= rings; r++)
      for (let s = 0; s <= segs; s++)
        pos.push(...at(Math.min(r / rings, 0.995), (s / segs) * Math.PI * 2));
    // The fascia: the rim, 1.4 m deep.
    const fasciaStart = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const [u, y, v] = at(0.995, (s / segs) * Math.PI * 2);
      pos.push(u, y, v, u, y - 1.4, v);
    }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    for (let s = 0; s < segs; s++) {
      const a = fasciaStart + s * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shell.setIndex(idx);
    // Sails: half-discs at either end, from the ground up under the rim.
    const parts = [shell];
    for (const side of [-1, 1]) {
      const u = R.u + side * (R.a - 5);
      const top = L.roofTop(u, R.v) - y0;
      parts.push(
        new THREE.CircleGeometry(1, 24, 0, Math.PI)
          .scale(R.b * 0.55, top, 1)
          .rotateY(Math.PI / 2)
          .translate(u, 0, R.v + 2),
      );
    }
    const flat = parts.map((p) => {
      const q = p.toNonIndexed();
      for (const name of Object.keys(q.attributes))
        if (name !== 'position') q.deleteAttribute(name);
      return q;
    });
    const g = mergeGeometries(flat);
    g.computeVertexNormals();
    for (const p of [...parts, ...flat]) p.dispose();
    return g;
  }

  /** Paper lanterns drifting up over the pool, each on its own slow spiral (in the shader). */
  private makeLanternMaterial(): THREE.ShaderMaterial {
    const E = Config.eden;
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOn: { value: 0 },
        uGlow: { value: E.lanternGlow },
        uRise: { value: E.lanternRise },
        uTop: { value: E.lanternTop },
        uColor: { value: new THREE.Color('#ffae5c') },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed; // angle, radius, phase 0..1
        uniform float uTime;
        uniform float uOn;
        uniform float uRise;
        uniform float uTop;
        varying float vFade;
        varying float vY;
        void main() {
          float h = mod(uTime * uRise * (0.8 + 0.4 * aSeed.z) + aSeed.z * uTop, uTop);
          float a = aSeed.x + uTime * 0.03 + h * 0.012;
          float r = aSeed.y + h * 0.18;
          // Fade in near the ground and out near the top; uOn grows them all from nothing.
          vFade = smoothstep(0.0, 12.0, h) * (1.0 - smoothstep(uTop * 0.7, uTop, h));
          vY = position.y;
          vec3 p = position * uOn * vFade;
          vec3 c = vec3(sin(a) * r, h + 4.0, cos(a) * r);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGlow;
        varying float vFade;
        varying float vY;
        void main() {
          // Brightest at the flame near the bottom; over 1, so bloom haloes it.
          float flame = 1.0 - smoothstep(-0.6, 0.7, vY);
          gl_FragColor = vec4(uColor * uGlow * (0.55 + 0.9 * flame), 1.0);
          #include <colorspace_fragment>
        }`,
    });
  }

  private addLanterns(): void {
    const E = Config.eden;
    const L = this.layout;
    const n = E.lanterns;
    const geo = new THREE.CylinderGeometry(0.8, 0.6, 1.6, 6);
    const seeds = new Float32Array(n * 3);
    // Angle, radius and height each from their own hash: tied to one another (the golden angle
    // with a golden-ratio phase) they lined up into a single helix.
    for (let i = 0; i < n; i++) {
      seeds[i * 3] = hash2(i, 1, 71) * Math.PI * 2;
      seeds[i * 3 + 1] = 6 + hash2(i, 2, 72) * 26;
      seeds[i * 3 + 2] = hash2(i, 3, 73);
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    this.geometries.push(geo);
    const mesh = new THREE.InstancedMesh(geo, this.lanternMat, n);
    mesh.name = 'sky lanterns';
    mesh.frustumCulled = false; // placed in the shader
    const pool = L.toWorld(VENUE.pool.u, VENUE.pool.v);
    mesh.position.set(pool.x, L.venue.y, pool.z);
    this.group.add(mesh);
  }
}
