import * as THREE from 'three';
import { markUsed } from '../instances';
import { DECK_STRIDE, type CityLayout } from './CityLayout';

/** Most deck surfaces drawn at once (a bridge is one; the bayside road's is one per 6 m). */
const MAX_DECKS = 512;
/** Vertices per deck: the road's top, then a skirt down each long side. */
const VERTS = 12;
const INDICES = 18;
/** The skirts reach this far below the deck's lower end (into the slab under it). */
const SKIRT = 0.3;

/** Vertex colour of the ground at a point (CityWorld's `groundColor`), linear. */
export type DeckColor = (x: number, z: number, y: number, out: THREE.Color) => void;

const col = new THREE.Color();
const ATTRS = ['position', 'normal', 'color', 'aRoad', 'aEdge'];

/**
 * The bridges' road surfaces, drawn with the city ground's own material: its street pass paints
 * from world position, so the lanes, sidewalks, crossings, tram rails, promenade paving and
 * lamplight pools continue over each bridge exactly as they run up to it. Each deck is a quad
 * sloped from one end's height to the other's (so it meets the road at both banks) with a short
 * skirt down each side to the slab under it. One mesh, refilled with the chunk set (not per
 * frame) into preallocated buffers.
 */
export class BridgeDecks {
  readonly mesh: THREE.Mesh;
  private readonly pos = new Float32Array(MAX_DECKS * VERTS * 3);
  private readonly nrm = new Float32Array(MAX_DECKS * VERTS * 3);
  private readonly rgb = new Float32Array(MAX_DECKS * VERTS * 3);
  private readonly road = new Float32Array(MAX_DECKS * VERTS);
  private readonly edge = new Float32Array(MAX_DECKS * VERTS * 2);
  private count = 0;

  constructor(
    private readonly city: CityLayout,
    material: THREE.Material,
    private readonly color: DeckColor,
  ) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.rgb, 3));
    g.setAttribute('aRoad', new THREE.BufferAttribute(this.road, 1));
    g.setAttribute('aEdge', new THREE.BufferAttribute(this.edge, 2));
    const idx = new Uint16Array(MAX_DECKS * INDICES);
    for (let d = 0; d < MAX_DECKS; d++) {
      const v = d * VERTS;
      // Top (0 1 2 3: -along -across, +along -across, +along +across, -along +across), then
      // the -across skirt (4..7) and the +across skirt (8..11), each top edge then bottom edge.
      idx.set(
        [
          v,
          v + 1,
          v + 2,
          v,
          v + 2,
          v + 3,
          v + 4,
          v + 6,
          v + 5,
          v + 4,
          v + 7,
          v + 6,
          v + 8,
          v + 9,
          v + 10,
          v + 8,
          v + 10,
          v + 11,
        ],
        d * INDICES,
      );
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = 'city-decks';
    this.mesh.frustumCulled = false; // refilled in place round the bird
  }

  /** Start a refill. */
  begin(): void {
    this.count = 0;
  }

  /** Add the decks in a list of DECK_STRIDE records. */
  add(D: readonly number[]): void {
    for (let k = 0; k < D.length && this.count < MAX_DECKS; k += DECK_STRIDE) {
      const d = this.count++;
      const [cx, cz, dx, dz, ha, hw, yA, yB] = [
        D[k],
        D[k + 1],
        D[k + 2],
        D[k + 3],
        D[k + 4],
        D[k + 5],
        D[k + 6],
        D[k + 7],
      ];
      // Across: (dz, -dx), the same handedness `deckAt` measures t in.
      const nx = dz;
      const nz = -dx;
      const low = Math.min(yA, yB) - SKIRT;
      const v = d * VERTS;
      const corner = (
        i: number,
        s: number,
        t: number,
        y: number,
        ox: number,
        oy: number,
        oz: number,
      ) => {
        const x = cx + dx * s + nx * t;
        const z = cz + dz * s + nz * t;
        const o = (v + i) * 3;
        this.pos[o] = x;
        this.pos[o + 1] = y;
        this.pos[o + 2] = z;
        this.nrm[o] = ox;
        this.nrm[o + 1] = oy;
        this.nrm[o + 2] = oz;
        this.color(x, z, y, col);
        this.rgb[o] = col.r;
        this.rgb[o + 1] = col.g;
        this.rgb[o + 2] = col.b;
        this.road[v + i] = this.city.hasStreets(x, z) ? 1 : 0;
        // Metres from the seawall as on the ground; the river banks are far (the deck is road).
        this.edge[(v + i) * 2] = Math.max(-60, Math.min(200, this.city.shoreDist(x, z)));
        this.edge[(v + i) * 2 + 1] = 50;
      };
      corner(0, -ha, -hw, yA, 0, 1, 0);
      corner(1, ha, -hw, yB, 0, 1, 0);
      corner(2, ha, hw, yB, 0, 1, 0);
      corner(3, -ha, hw, yA, 0, 1, 0);
      corner(4, -ha, -hw, yA, -nx, 0, -nz);
      corner(5, ha, -hw, yB, -nx, 0, -nz);
      corner(6, ha, -hw, low, -nx, 0, -nz);
      corner(7, -ha, -hw, low, -nx, 0, -nz);
      corner(8, -ha, hw, yA, nx, 0, nz);
      corner(9, ha, hw, yB, nx, 0, nz);
      corner(10, ha, hw, low, nx, 0, nz);
      corner(11, -ha, hw, low, nx, 0, nz);
    }
  }

  /** Upload what was added. */
  end(): void {
    const g = this.mesh.geometry;
    const n = this.count * VERTS;
    for (const name of ATTRS) markUsed(g.getAttribute(name) as THREE.BufferAttribute, n);
    g.setDrawRange(0, this.count * INDICES);
    this.mesh.visible = this.count > 0;
  }

  /** Decks drawn (debug / tests). */
  get drawn(): number {
    return this.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
