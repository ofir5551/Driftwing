import { Config } from './Config';

/**
 * Score, flow and lantern progression. Pure logic (no DOM/Three) so it is unit-tested.
 *
 * Flow is a 0..1 meter that rewards rhythm: each pickup adds to it, more if it continues a
 * chain (pickups less than `chainWindow` apart). After a grace period it drains slowly. It never
 * punishes: losing flow only means fewer bonus points and a calmer soundtrack.
 */

export class Progress {
  count = 0;
  score = 0;
  flow = 0;
  chain = 0;
  lanterns = 0;
  /** Lit lanterns the bird has flown through. */
  reached = 0;
  /** Tricks landed. */
  tricks = 0;
  best = 0;
  private sincePickup = 99;
  /** The last two tricks, newest first (variety scoring). */
  private readonly recent = ['', ''];

  /** Register a pickup. Returns points awarded and whether a lantern milestone was reached. */
  collect(): { points: number; lantern: boolean } {
    const t = Config.flow;
    this.chain = this.sincePickup < t.chainWindow ? this.chain + 1 : 1;
    this.sincePickup = 0;
    this.flow = Math.min(1, this.flow + t.gain + Math.min(this.chain, 12) * t.chainBonus);
    const points = Math.round(t.basePoints * (1 + this.flow * t.flowMultiplier));
    this.count++;
    this.score += points;
    this.best = Math.max(this.best, this.score);
    const lantern = this.count % t.wispsPerLantern === 0;
    if (lantern) this.lanterns++;
    return { points, lantern };
  }

  /**
   * A landed trick: flow and points like a few wisps, scaled by its size (`scale`) and by
   * variety (repeating the last trick pays half, one unlike the last two pays more). It keeps
   * the chain alive but isn't a wisp, so lanterns still come from wisps alone.
   */
  trick(kind: string, scale: number): { points: number; variety: number } {
    const t = Config.flow;
    const [last, before] = this.recent;
    const variety = kind === last ? t.trickRepeat : kind !== before ? t.trickVariety : 1;
    this.recent[1] = last;
    this.recent[0] = kind;
    this.tricks++;
    const m = variety * scale;
    this.sincePickup = 0;
    this.flow = Math.min(1, this.flow + t.trickGain * m);
    const points = Math.round(
      t.basePoints * t.trickPoints * m * (1 + this.flow * t.flowMultiplier),
    );
    this.score += points;
    this.best = Math.max(this.best, this.score);
    return { points, variety };
  }

  /**
   * A lit lantern reached: flow refills to the brim and pays a bonus at the full multiplier.
   * It keeps the chain alive, like a trick. Purely a reward: ignoring a lantern costs nothing.
   */
  reachLantern(): number {
    const t = Config.flow;
    this.reached++;
    this.sincePickup = 0;
    this.flow = 1;
    const points = Math.round(t.basePoints * Config.lantern.points * (1 + t.flowMultiplier));
    this.score += points;
    this.best = Math.max(this.best, this.score);
    return points;
  }

  update(dt: number): void {
    this.sincePickup += dt;
    if (this.sincePickup > Config.flow.chainWindow) this.chain = 0;
    if (this.sincePickup > Config.flow.grace)
      this.flow = Math.max(0, this.flow - Config.flow.decay * dt);
  }

  /** Seconds since the last pickup (HUD fades out when idle). */
  get idle(): number {
    return this.sincePickup;
  }

  reset(): void {
    this.count = this.score = this.flow = this.chain = this.lanterns = this.reached = 0;
    this.tricks = 0;
    this.recent[0] = this.recent[1] = '';
    this.sincePickup = 99;
  }
}
