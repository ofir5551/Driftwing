import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { DoubleTap, Flick, nearest, padPress } from '../src/core/Gestures';

describe('DoubleTap', () => {
  it('fires on two presses of one direction inside the window', () => {
    const d = new DoubleTap();
    expect(d.press('left', 1)).toBe(false);
    expect(d.press('left', 1 + Config.input.doubleTap * 0.8)).toBe(true);
  });

  it('ignores slow presses, mixed directions, and starts over after firing', () => {
    const d = new DoubleTap();
    d.press('up', 0);
    expect(d.press('up', Config.input.doubleTap * 1.5)).toBe(false);
    d.press('left', 10);
    expect(d.press('right', 10.1)).toBe(false);
    d.press('down', 20);
    expect(d.press('down', 20.1)).toBe(true);
    expect(d.press('down', 20.2)).toBe(false); // a third tap is a new first tap
  });
});

describe('Flick', () => {
  const stroke = (f: Flick, dx: number, dy: number, seconds: number, steps = 6) => {
    let out = null;
    f.start(200, 300, 0);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      out = f.move(200 + dx * k, 300 + dy * k, seconds * k) ?? out;
    }
    return out;
  };

  it('a fast long stroke flicks in its dominant direction (screen y is down)', () => {
    const d = Config.input.flickDistance * 1.2;
    const t = Config.input.flickTime * 0.8;
    expect(stroke(new Flick(), d, 10, t)).toBe('right');
    expect(stroke(new Flick(), -d, 10, t)).toBe('left');
    expect(stroke(new Flick(), 10, -d, t)).toBe('up');
    expect(stroke(new Flick(), 10, d, t)).toBe('down');
  });

  it('steering-speed drags never flick', () => {
    const d = Config.input.flickDistance * 1.2;
    expect(stroke(new Flick(), d, 0, Config.input.flickTime * 3, 20)).toBe(null);
    expect(stroke(new Flick(), Config.input.flickDistance * 0.6, 0, 0.05)).toBe(null);
  });

  it('one stroke fires once', () => {
    const f = new Flick();
    const d = Config.input.flickDistance * 1.1;
    let fired = 0;
    f.start(0, 0, 0);
    for (let i = 1; i <= 8; i++) if (f.move((d / 6) * i, 0, 0.02 * i)) fired++;
    expect(fired).toBe(1);
  });
});

describe('padPress', () => {
  const at = (deg: number, dist = 50) => {
    const out = { x: 9, y: 9 };
    const a = (deg * Math.PI) / 180;
    // Angles counter-clockwise from right with y up; the pad gets screen px (y down).
    padPress(Math.cos(a) * dist, -Math.sin(a) * dist, 10, out);
    return [out.x, out.y];
  };

  it('presses nothing inside the dead zone', () => {
    expect(at(30, 5)).toEqual([0, 0]);
  });

  it('presses one arrow near an axis, with steering y up', () => {
    expect(at(0)).toEqual([1, 0]);
    expect(at(90)).toEqual([0, 1]);
    expect(at(180)).toEqual([-1, 0]);
    expect(at(270)).toEqual([0, -1]);
    expect(at(15)).toEqual([1, 0]);
    expect(at(80)).toEqual([0, 1]);
  });

  it('presses both arrows between them: eight equal sectors', () => {
    expect(at(45)).toEqual([1, 1]);
    expect(at(135)).toEqual([-1, 1]);
    expect(at(225)).toEqual([-1, -1]);
    expect(at(315)).toEqual([1, -1]);
    expect(at(25)).toEqual([1, 1]);
    expect(at(65)).toEqual([1, 1]);
    expect(at(20)).toEqual([1, 0]);
    expect(at(70)).toEqual([0, 1]);
  });
});

describe('nearest', () => {
  // A side cluster: a tall turn button on the outside, up and down stacked inside it.
  const xs = [30, 100, 100];
  const ys = [55, 24, 86];
  it('picks the button under the thumb, and the closest once it slides off', () => {
    expect(nearest(xs, ys, 30, 55)).toBe(0);
    expect(nearest(xs, ys, 100, 30)).toBe(1);
    expect(nearest(xs, ys, 95, 80)).toBe(2);
    expect(nearest(xs, ys, 140, -60)).toBe(1); // far above and inside: still up
    expect(nearest(xs, ys, -40, 55)).toBe(0); // off the outer edge: still the turn
  });
});
