/**
 * What's new, for players: every release that changed something a player can see or feel,
 * newest first. The first entry's version is the game's version (package.json must match; a
 * test checks). Pure: Settings saves the last version a player has seen, the Menu draws it.
 *
 * Adding to it (see CLAUDE.md): a player-facing change adds a line to the top entry while that
 * version is unreleased on `main`; once it has shipped, start a new entry above it and bump
 * package.json (minor for something new to fly or see, patch for fixes and small tweaks).
 * Write for players, in the game's voice: what they will notice, not how it was built.
 */

export interface ChangelogEntry {
  /** Semver, `major.minor.patch`. */
  version: string;
  /** The day it reached players, `YYYY-MM-DD`. */
  date: string;
  /** A few words for the release. */
  title: string;
  items: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.7.1',
    date: '2026-11-27',
    title: 'A flock for every land',
    items: [
      'Each level now gathers its own flock: the birds you meet in a land stay and fly with you there.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-26',
    title: 'Journeys and a flock',
    items: [
      'Journeys in every level: a beacon rises over a landmark ahead. Fly through its light to arrive.',
      'A stray bird waits on a lit cairn at each journey’s end and joins your flock, which stays with you from flight to flight.',
      'Sea of Clouds: dive into the cloud sea and glide through it for a breath.',
      'Coral Atolls: glide under deep water for a breath, the reef in sight.',
      'Lanterns hold notes: reach one to read its message.',
      'Fullscreen at launch, with how to install Driftwing as an app on your phone or computer.',
      'What’s new: this list, and the version on the title. A glow tells you when there is more.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-18',
    title: 'Lived-in worlds',
    items: [
      'Every level is lived-in: villages, farms, boats, flocks and wildlife along the way.',
      'Soft sun shadows, drifting cloud shadows, light shafts and grass.',
      'Smoother on phones.',
      'Neon Bay: real bridges, a bayside road and a promenade where the city meets the sea.',
      'Sea of Clouds: the cloud sea heaves and drifts, and its banks change shape.',
      'Boost with one hand: tap to boost. The loop is gone.',
      'Pause and Rest fade back to the title.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-13',
    title: 'Lagoons and a ringed moon',
    items: [
      'New level: Coral Atolls, turquoise lagoons, palm islets and coral reefs.',
      'New level: Ringmoon Shallows, a jade sea of leaning spires under a ringed giant.',
      'Hidden discoveries to find in every level.',
      'A calmer title, gentle first-flight hints and a quieter HUD.',
      'A compact pause menu, left-handed controls and a level row you can swipe.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-11',
    title: 'Birds and the Sea of Clouds',
    items: [
      'Birds: pick your bird, its plumage and its wingtip trail.',
      'Three new birds to earn: the nimble Swallow, the Crane for long glides and thermals, and the blazing Phoenix.',
      'New level: Sea of Clouds, granite spires above a sea of cloud at sunrise.',
      'Install Driftwing as an app and fly offline.',
      'Neon Bay: wisp runs turn and change lanes, so the city asks for steering.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-31',
    title: 'The journey',
    items: [
      'New level: Red Canyons, desert canyons, stone arches and mesas.',
      'Light you gather adds up over every flight and opens new places along the journey.',
      'Rest: end a flight and see how it went.',
      'More painterly worlds, and a finer bird with arched wings and tail streamers.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-24',
    title: 'City of Gold',
    items: [
      'New level: City of Gold, Jerusalem’s stone and hills.',
      'More ways to steer by touch: a D-pad, side arrows, or split pads under each thumb.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-16',
    title: 'First flight',
    items: [
      'Glide over the Highlands, Neon Bay, Jade River and the Aurora Fjords.',
      'Tricks: barrel rolls and dive-bombs.',
      'Lit lanterns to fly through.',
      'Fullscreen, and a second finger to boost.',
    ],
  },
];

/** The game's version: the newest entry's. */
export const VERSION: string = CHANGELOG[0].version;

const parse = (v: string): number[] => v.split('.').map((n) => Number(n) || 0);

/** Negative if `a` is older than `b`, positive if newer, 0 if the same. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The entries a player who last saw `seen` hasn't seen yet (none if `seen` is current). */
export function unseen(seen: string, log: readonly ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return log.filter((e) => compareVersions(e.version, seen) > 0);
}

/**
 * The version a player last saw, from what was saved. Nothing saved: a new player has seen
 * everything (nothing to announce), while someone who played before versions were saved last
 * saw the release before the first one with this list (0.6.0), so that one shows as new.
 */
export function seenVersion(saved: string | null, playedBefore: boolean): string {
  if (saved && /^\d+\.\d+\.\d+$/.test(saved)) return saved;
  return playedBefore ? '0.6.0' : VERSION;
}

/** `2026-11-26` as "26 Nov 2026" (fixed English months: no locale surprises). */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  return `${d} ${months[(m ?? 1) - 1] ?? ''} ${y}`;
}
