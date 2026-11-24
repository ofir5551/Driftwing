/**
 * How a wisp planner leans its ribbons toward a journey's destination (world/Destinations.ts).
 * Pure: the route is x, z pairs from where the journey began to the landmark, and every
 * planner (and the generic patterns) asks the same things of it: which way to aim, whether the
 * cursor is on the route (and which way it runs there), whether this is the last stretch, and
 * how far the beacon is. One is shared by the ribbons and their level's planner (Wisps owns it),
 * so it can note every wisp laid and know whether one went through the beacon's light.
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
  /** Has a wisp been laid in the beacon's light (at the route's end) this journey? */
  threaded = false;

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
   * would, never doubling back to a landmark it has passed), unless no wisp went through the
   * beacon's light and it is `comeBack` metres past: then back toward it.
   */
  /** A new journey's route (or null: none). */
  setRoute(route: Float64Array | null): void {
    this.route = route;
    this.threaded = false;
  }

  /** A wisp was laid at (x, z): note whether it lies in the beacon's light (within `reach`). */
  note(x: number, z: number, reach: number): void {
    const d = this.endDist(x, z);
    if (d < reach) this.threaded = true;
  }

  /** Distance (m) from (x, z) to the route's end (the beacon), or Infinity with no route. */
  endDist(x: number, z: number): number {
    const R = this.route;
    if (!R) return Infinity;
    const n = R.length;
    return Math.hypot(R[n - 2] - x, R[n - 1] - z);
  }

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
      // Past the end: run on if a wisp went through the light (the bird will follow it there),
      // else, once well past, turn back for another pass.
      if (this.threaded || this.comeBack <= 0 || ex * ex + ez * ez < this.comeBack * this.comeBack)
        return null;
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
