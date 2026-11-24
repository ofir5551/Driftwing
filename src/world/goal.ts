/**
 * How a wisp planner leans its ribbons toward a journey's destination (world/Destinations.ts).
 * Pure: the route is x, z pairs from where the journey began to the landmark, and every
 * planner (and the generic patterns) asks the same three things of it: which way to aim, whether
 * the cursor is on the route (and which way it runs there), and whether this is the last stretch.
 */
export class GoalLean {
  /** The current destination's route, or null when no journey is on. */
  route: Float64Array | null = null;
  /** From the last `heading`: is the cursor within `onRoute` metres of the route? */
  onRoute = false;
  /** From the last `heading`: is it on the last `approach` points (the run in to the landmark)? */
  approaching = false;
  /** From the last `heading`: the route's own direction at its point nearest the cursor. */
  routeDir = 0;

  /**
   * @param ahead route points (40 m apart) past the nearest one to aim at
   * @param approach how many of the last route points count as the run in
   * @param near metres off the route that still count as on it
   * @param comeBack metres past the route's end beyond which the ribbon turns back to it (0:
   *   never). The ribbon runs ~400 m ahead of the bird, so passing the end is usual just before
   *   an arrival; only well past it has the ribbon missed.
   */
  constructor(
    private readonly ahead = 8,
    private readonly approach = 17,
    private readonly near = 250,
    private readonly comeBack = 0,
  ) {}

  /**
   * Heading from (x, z) to the point a little way along the route past its nearest point, or
   * null with no route or once that nearest point is its end (the ribbon then runs on as it
   * would, never doubling back to a landmark it has passed), unless it is `comeBack` metres past.
   */
  heading(x: number, z: number): number | null {
    const R = this.route;
    this.onRoute = this.approaching = false;
    if (!R) return null;
    const last = R.length / 2 - 1;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i <= last; i++) {
      const d = (R[i * 2] - x) ** 2 + (R[i * 2 + 1] - z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= last) {
      const ex = R[last * 2] - x;
      const ez = R[last * 2 + 1] - z;
      if (this.comeBack <= 0 || ex * ex + ez * ez < this.comeBack * this.comeBack) return null;
      this.approaching = true;
      return Math.atan2(ex, ez);
    }
    this.onRoute = bd < this.near * this.near;
    this.approaching = this.onRoute && bi >= last - this.approach;
    this.routeDir = Math.atan2(R[bi * 2 + 2] - R[bi * 2], R[bi * 2 + 3] - R[bi * 2 + 1]);
    const k = Math.min(bi + this.ahead, last);
    return Math.atan2(R[k * 2] - x, R[k * 2 + 1] - z);
  }
}
