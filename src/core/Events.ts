import type { LevelId } from '../levels/World';
import type { TrickKind } from '../player/Tricks';

/** Tiny typed event bus so audio, FX and UI react to gameplay without importing each other. */
export interface GameEvents {
  flap: { x: number; y: number; z: number };
  wingbeat: { x: number; y: number; z: number };
  contact: { kind: 'ground' | 'water'; x: number; y: number; z: number; strength: number };
  wisp: { x: number; y: number; z: number; count: number; flow: number; chain: number };
  lantern: { x: number; y: number; z: number; index: number };
  /** The bird flew through a lit lantern's light. */
  lanternReached: { x: number; y: number; z: number; points: number };
  thermal: { inside: boolean };
  /**
   * The bird glided into a soft surface (the cloud sea, deep water) or came back out; strength
   * in m/s; `water` when it is water.
   */
  cloud: { inside: boolean; x: number; y: number; z: number; strength: number; water: boolean };
  /** A trick began (the motion and its music start together). */
  trickStart: { kind: TrickKind; x: number; y: number; z: number };
  /** A trick landed (scored only while playing). */
  trick: { kind: TrickKind; size: number; points: number };
  level: { id: LevelId };
  /** A level's hidden find was made (only while playing, each once). */
  discovery: { id: string; name: string; x: number; y: number; z: number };
  /** A journey began: a beacon rose over its destination (only while playing). */
  destination: { name: string; x: number; y: number; z: number; first: boolean };
  /** The bird reached the journey's destination (only while playing). */
  arrival: { id: string; name: string; x: number; y: number; z: number; tint: number };
  /** Journey milestones just opened (names, lowest first). */
  unlock: { names: readonly string[] };
}

type Handler<T> = (payload: T) => void;

export class Events {
  private handlers: { [K in keyof GameEvents]?: Handler<GameEvents[K]>[] } = {};

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): void {
    const list = (this.handlers[type] ??= []) as Handler<GameEvents[K]>[];
    list.push(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const list = this.handlers[type];
    if (list) for (const fn of list) fn(payload);
  }
}
