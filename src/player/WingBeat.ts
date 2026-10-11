import { Config } from '../core/Config';
import { clamp, expDecay, lerp, smoothstep } from '../core/math';

const TAU = Math.PI * 2;
/** Phase lag (rad) of the hand behind the arm, so wingtips whip a beat after the shoulder. */
const HAND_LAG = 0.9;

/**
 * Pure wingbeat scheduler (no Three, no DOM). Real gliding birds don't hold their wings still:
 * they flap in short bursts between glides, more often when slow or climbing and never in a
 * dive. This drives those cosmetic bursts and the stronger stroke of a player flap; Bird turns
 * the outputs into joint angles.
 *
 * Strokes are sin-shaped from the glide pose (up first, then the downstroke), so a stroke starts
 * and ends exactly on the glide pose and bursts blend in and out without snapping.
 */
export class WingBeat {
  /** 0..1 position within the current stroke. */
  phase = 0;
  /** 0..1 envelope blending the stroke over the glide pose. */
  weight = 0;
  /** Current stroke amplitude (1 = full player flap). */
  amp = 0;
  beatsLeft = 0;
  /** Outputs, already scaled by weight * amp: arm offset (+up), lagged hand offset, upstroke fold. */
  arm = 0;
  hand = 0;
  fold = 0;
  private period = Config.bird.flapPeriod;
  private ampTarget = 0;
  private glideLeft: number;
  private lastSinceFlap = -Infinity;

  constructor(private readonly rand: () => number = Math.random) {
    this.glideLeft = lerp(Config.bird.idleGapMin, Config.bird.idleGapMax, rand());
  }

  /** How much the bird "wants" to flap: slow or nose-up flight, 0..1. */
  static need(speed: number, pitch: number): number {
    const c = Config.flight;
    return Math.max(smoothstep(c.cruiseSpeed, c.minSpeed, speed), smoothstep(0.05, 0.45, pitch));
  }

  /**
   * `sinceFlap` is the flight model's time since the last player flap. It only ever grows
   * except when a flap fires; interpolation and dt clamping can nudge it back by under a step,
   * so a fresh flap is a drop well beyond that.
   */
  update(dt: number, sinceFlap: number, speed: number, pitch: number, tuck: number): void {
    const B = Config.bird;
    if (sinceFlap + 0.1 < this.lastSinceFlap) {
      // Finish a stroke that is already past its downstroke, then give one full-strength beat.
      this.beatsLeft = this.beatsLeft > 0 && this.phase > 0.5 ? 2 : 1;
      this.period = B.flapPeriod;
      this.ampTarget = 1;
      if (this.weight < 0.3) {
        // From a glide: start a fresh stroke. The envelope still eases it in, so no snap.
        this.phase = 0;
        this.amp = 1;
      }
      this.glideLeft = Math.max(this.glideLeft, B.idleGapMin);
    }
    this.lastSinceFlap = sinceFlap;

    if (this.beatsLeft === 0) {
      this.glideLeft -= dt;
      if (this.glideLeft <= 0) {
        const need = WingBeat.need(speed, pitch);
        if (tuck < 0.4) {
          const t = clamp(need * 0.6 + this.rand() * 0.5, 0, 1);
          this.beatsLeft = Math.round(lerp(B.idleBeatsMin, B.idleBeatsMax, t));
          this.period = B.idleBeatPeriod;
          this.ampTarget = B.idleAmplitude * (0.85 + need * 0.3);
          this.phase = 0;
          this.glideLeft = lerp(B.idleGapMax, B.idleGapMin, need) * (0.7 + this.rand() * 0.6);
        } else {
          // Wings are tucked for a dive: check again shortly instead of beating mid-stoop.
          this.glideLeft = 0.5;
        }
      }
    }

    const active = this.beatsLeft > 0;
    this.weight += ((active ? 1 : 0) - this.weight) * expDecay(B.blendRate, dt);
    this.amp += (this.ampTarget - this.amp) * expDecay(12, dt);
    if (active) {
      this.phase += dt / this.period;
      while (this.phase >= 1 && this.beatsLeft > 0) {
        this.phase -= 1;
        this.beatsLeft--;
      }
      if (this.beatsLeft === 0) this.phase = 0; // sin(0) == sin(TAU): no jump on the last wrap
    }

    const k = this.weight * this.amp;
    const a = this.phase * TAU;
    this.arm = Math.sin(a) * k;
    this.hand = Math.sin(a - HAND_LAG) * k;
    // The upstroke is where the arm rises (cos > 0): birds fold the hand back to cut drag.
    this.fold = Math.max(0, Math.cos(a)) * k;
  }
}
