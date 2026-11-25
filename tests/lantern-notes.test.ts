import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import {
  LANTERN_NOTES,
  NOTE_MAX,
  NotePicker,
  QUOTE_MAX,
  parseSeenNotes,
} from '../src/world/LanternNotes';
import { mulberry32 } from '../src/world/noise';

describe('lantern notes', () => {
  it('has 100 notes and 4 quotes, distinct, each short enough for a phone', () => {
    const quotes = LANTERN_NOTES.filter((n) => n.kind === 'quote');
    expect(LANTERN_NOTES.length - quotes.length).toBe(100);
    expect(quotes.length).toBe(4);
    expect(new Set(LANTERN_NOTES.map((n) => n.text)).size).toBe(LANTERN_NOTES.length);
    for (const n of LANTERN_NOTES) {
      // Every quote names its author; no other note does.
      expect(Boolean(n.by), n.text).toBe(n.kind === 'quote');
      const max = n.kind === 'quote' ? QUOTE_MAX : NOTE_MAX;
      expect(n.text.length, n.text).toBeLessThanOrEqual(max);
    }
  });

  it('never repeats a note within the gap', () => {
    const picker = new NotePicker(LANTERN_NOTES);
    const rand = mulberry32(7);
    const gap = Config.lantern.noteGap;
    const shown: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = picker.pick(gap, Config.lantern.noteRare, rand).text;
      expect(shown.slice(-gap)).not.toContain(t);
      shown.push(t);
    }
  });

  it('carries the gap across flights through what was seen', () => {
    const first = new NotePicker(LANTERN_NOTES);
    const rand = mulberry32(3);
    for (let i = 0; i < 20; i++) first.pick(30, 0.5, rand);
    const seen = parseSeenNotes(JSON.parse(JSON.stringify(first.seen)));
    const next = new NotePicker(LANTERN_NOTES, seen);
    for (let i = 0; i < 10; i++) expect(seen).not.toContain(next.pick(30, 0.5, rand).text);
  });

  it('shows notes from other birds less often than the rest', () => {
    const picker = new NotePicker(LANTERN_NOTES);
    const rand = mulberry32(11);
    let birds = 0;
    const n = 20000;
    for (let i = 0; i < n; i++)
      if (picker.pick(30, Config.lantern.noteRare, rand).kind === 'bird') birds++;
    const share = LANTERN_NOTES.filter((x) => x.kind === 'bird').length / LANTERN_NOTES.length;
    expect(birds / n).toBeLessThan(share * 0.8);
    expect(birds / n).toBeGreaterThan(0);
  });

  it('drops saved texts that are no longer notes, and junk', () => {
    expect(parseSeenNotes({ a: 1 })).toEqual([]);
    expect(parseSeenNotes(['gone', 3, LANTERN_NOTES[0].text])).toEqual([
      'gone',
      LANTERN_NOTES[0].text,
    ]);
    expect(new NotePicker(LANTERN_NOTES, ['gone']).seen).toEqual([]);
  });

  it('still picks when the gap is larger than the list', () => {
    const few = LANTERN_NOTES.slice(0, 3);
    const picker = new NotePicker(few);
    const rand = mulberry32(1);
    let last = '';
    for (let i = 0; i < 20; i++) {
      const t = picker.pick(30, 0.5, rand).text;
      expect(t).not.toBe(last);
      last = t;
    }
  });
});
