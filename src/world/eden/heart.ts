/**
 * The heart shape Eden draws everywhere (the lake, the groves, the clouds, the flower beds).
 * Pure. In its own frame, x across and y toward the lobes: about 2 wide and 2 tall, centred.
 */

/** A point on the outline at t in 0..1 (once round), written into out (x, y). */
export function heartPoint(t: number, out: { x: number; y: number }): void {
  const a = t * Math.PI * 2;
  const s = Math.sin(a);
  // The classic parametric heart (16 sin^3, 13 cos - 5 cos 2 - 2 cos 3 - cos 4), scaled to ~2.
  out.x = (16 * s * s * s) / 17;
  out.y =
    (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17 + 0.1;
}

/**
 * Below 0 inside the heart, above 0 outside, about 0 on the outline (the implicit heart
 * (x^2 + y^2 - 1)^3 - x^2 y^3, fitted to the outline above). Not a distance, but smooth and
 * monotone enough across the edge to blend a bank with.
 */
export function heartField(x: number, y: number): number {
  // Fitted (least squares over the outline) so the outline lies on the zero contour.
  const X = x * 1.21;
  const Y = y * 1.39 + 0.12;
  const q = X * X + Y * Y - 1;
  return q * q * q - X * X * Y * Y * Y;
}
