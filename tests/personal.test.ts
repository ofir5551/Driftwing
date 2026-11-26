import { describe, expect, it } from 'vitest';
import { LEVEL_LIST, listedLevels } from '../src/levels';
import { PERSONAL_IDS } from '../src/levels/personal';

describe('personal stages', () => {
  it('are listed in personal.ts (the Pages loop and the service worker read it)', () => {
    const personal = LEVEL_LIST.filter((l) => l.personal).map((l) => l.id);
    expect([...PERSONAL_IDS].sort()).toEqual(personal.sort());
  });

  it('never appear in the players’ level list, only on dev', () => {
    expect(listedLevels(false).some((l) => l.personal)).toBe(false);
    expect(listedLevels(false).some((l) => l.id === 'eden')).toBe(false);
    expect(listedLevels(true).some((l) => l.id === 'eden')).toBe(true);
  });

  it('end on a destination of their own', () => {
    for (const l of LEVEL_LIST)
      if (l.personal) {
        expect(l.personal.finaleAt.startsWith(`${l.id}:`)).toBe(true);
        expect(l.personal.finaleAfter).toBeGreaterThan(0);
      }
  });
});
