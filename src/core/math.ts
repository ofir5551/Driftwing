/** Small pure math helpers shared by flight, camera and audio. No allocations. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach: fraction of the gap closed after dt at `rate` (1/s). */
export const expDecay = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Shortest signed angle from a to b, in (-PI, PI]. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** Mutable spring state, reused across frames to avoid allocations. */
export interface Spring {
  x: number;
  v: number;
}

/**
 * Exact critically damped spring step (closed-form solution, so it is unconditionally stable
 * for any dt). `omega` is the natural frequency: roughly, the spring settles within ~4/omega s.
 * Critical damping is the fastest approach that never overshoots, which is what makes steering
 * feel smooth and "forgiving" rather than twitchy or wobbly.
 */
export function springStep(s: Spring, target: number, omega: number, dt: number): void {
  const exp = Math.exp(-omega * dt);
  const delta = s.x - target;
  const tmp = (s.v + omega * delta) * dt;
  s.v = (s.v - omega * tmp) * exp;
  s.x = target + (delta + tmp) * exp;
}
