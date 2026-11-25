/**
 * What a lantern holds: a short note shown as the bird flies through its light, in place of
 * "Lantern reached". Pure (no DOM, no storage), so the picker is tested in Node.
 *
 * Every note works in any level. Notes from other birds are the rare kind (`Config.lantern.
 * noteRare`), and a note comes back only after `Config.lantern.noteGap` others have shown, across
 * flights (the recent ones are saved by `Settings`). Keep each within two lines on an iPhone SE
 * (a test holds them to NOTE_MAX characters).
 */

export type NoteKind = 'funny' | 'heartfelt' | 'nudge' | 'view' | 'odd' | 'bird';

export interface LanternNote {
  kind: NoteKind;
  text: string;
}

/** Characters a note may have: two lines of the note style at 320 px. */
export const NOTE_MAX = 66;

const RAW: readonly (readonly [NoteKind, string])[] = [
  // Funny
  ['funny', "You're doing great. The wind is doing most of the work, but still."],
  ['funny', 'Fun fact: no one has ever seen you trip up here.'],
  ['funny', 'This lantern was lit by a moth with big dreams.'],
  ['funny', 'Flapping is optional. Looking cool is not.'],
  ['funny', 'Congratulations. You found a light. In the sky. Where lights are.'],
  ['funny', 'Your trail looks amazing from behind. Just saying.'],
  ['funny', "Pigeons would never make it this far. Don't tell them I said that."],
  ['funny', 'Achievement unlocked: went toward the glowing thing.'],
  ['funny', 'Your mother would be proud. Your mother is also a bird.'],
  ['funny', 'Warning: contents may be slightly inspirational.'],
  ['funny', 'This message waited ages in here. Thanks for letting it out.'],
  ['funny', 'Rumour says the next lantern is better. Rumour is a crow.'],
  ['funny', "You could have ignored this lantern. You didn't. Respect."],
  ['funny', "Sorry, we're out of wise quotes. Have a nice day instead."],
  ['funny', 'Ground: still there. Good to check.'],
  ['funny', 'Breaking news: local bird extremely good at being a bird.'],

  // Heartfelt
  ['heartfelt', 'Someone is glad you exist today.'],
  ['heartfelt', "You don't have to earn rest."],
  ['heartfelt', "You're allowed to be proud of small things."],
  ['heartfelt', 'Somewhere, someone still smiles about something you said.'],
  ['heartfelt', "You've made it through every hard day so far. Good record."],
  ['heartfelt', 'Kindness is never wasted, even when no one sees it.'],
  ['heartfelt', "You're not behind. You're on your own route."],
  ['heartfelt', "The people who love you aren't keeping score."],
  ['heartfelt', "It's okay to go slowly. Lanterns wait."],
  ['heartfelt', 'You make the places you go a little brighter.'],
  ['heartfelt', "Whatever you're carrying, you don't have to carry it alone."],
  ['heartfelt', "Tomorrow you'll know something you don't know today."],
  ['heartfelt', 'You belong in the sky as much as anyone.'],
  ['heartfelt', 'Thank you for being here. Really.'],
  ['heartfelt', 'Some days, getting up is the brave part.'],
  ['heartfelt', 'Call someone you miss. They probably miss you too.'],
  ['heartfelt', "You've grown in ways you haven't noticed yet."],
  ['heartfelt', 'The world is better with you flying in it.'],
  ['heartfelt', "You were someone's good news once. Maybe today too."],
  ['heartfelt', "It's brave to keep going softly."],
  ['heartfelt', "You don't have to have it all figured out to be enough."],
  ['heartfelt', 'Someone learned kindness by watching you.'],
  ['heartfelt', "Even on grey days, you're worth the sunlight."],
  ['heartfelt', 'Your best is allowed to look different every day.'],
  ['heartfelt', "You've come a long way. Look back for a second."],
  ['heartfelt', 'Rest is part of the journey, not a break from it.'],
  ['heartfelt', "Some people feel safer just because you're around."],
  ['heartfelt', "Be as gentle with yourself as you'd be with a friend."],
  ['heartfelt', 'Little moments like this one count too.'],
  ['heartfelt', 'You can start again, as many times as you need.'],
  ['heartfelt', "Somebody's day got better because of you."],
  ['heartfelt', 'You are more than what you got done today.'],

  // Gentle nudges
  ['nudge', 'Unclench your jaw. Drop your shoulders.'],
  ['nudge', 'Take one slow breath. In through the nose.'],
  ['nudge', 'When did you last drink some water?'],
  ['nudge', 'Look away for a moment. Find something far away.'],
  ['nudge', 'Roll your shoulders back. Good.'],
  ['nudge', 'Blink a few times. Your eyes will thank you.'],
  ['nudge', "Sit a little more comfortably. You've earned it."],
  ['nudge', 'Stretch your fingers. Then come back to the sky.'],
  ['nudge', 'Is there a window nearby? Glance at the real sky too.'],
  ['nudge', 'Breathe out a little longer than you breathe in.'],
  ['nudge', 'Soften your grip. Gliding is easier that way.'],
  ['nudge', 'Notice one sound around you right now.'],
  ['nudge', 'That thing you meant to do today? One small step, later.'],
  ['nudge', 'Smile, just slightly. See if it sticks.'],
  ['nudge', "If it's late, the sky will still be here tomorrow."],

  // Bird's-eye thoughts
  ['view', 'From up here, every problem is the size of a pebble.'],
  ['view', 'No borders can be seen from this high.'],
  ['view', "Every road down there leads to someone's home."],
  ['view', 'Rivers never rush, and they still reach the sea.'],
  ['view', "The wind doesn't push you. It carries you."],
  ['view', 'Clouds change shape all day and nobody calls them lost.'],
  ['view', 'Mountains look calm from far away. So do most worries.'],
  ['view', "You can't see the path from the ground. You can from here."],
  ['view', 'Every lit window is a whole story.'],
  ['view', "The horizon keeps moving. That's why it's worth chasing."],
  ['view', 'Gliding is just falling with good posture.'],
  ['view', "Height isn't about being above others. It's seeing further."],
  ['view', 'A long way down is also a long way to see.'],
  ['view', 'The tallest tree started as a seed with no view.'],
  ['view', 'Somewhere the sun is setting, and someone is watching it.'],

  // Odd and whimsical
  ['odd', 'A cloud once told me it was mostly vibes.'],
  ['odd', "The moon has been following you. It's harmless."],
  ['odd', 'Somewhere a sheep is counting people to fall asleep.'],
  ['odd', "This lantern is shy. Please don't stare."],
  ['odd', "The wind has a name, but it won't tell anyone."],
  ['odd', 'Stars are lanterns no one has reached yet.'],
  ['odd', 'Flap three times and make a wish. Nothing happens. Still nice.'],
  ['odd', "Today's forecast: 70% sky."],
  ['odd', "A fish below is jealous of you. You'd be jealous of it too."],
  ['odd', 'This lantern runs on good intentions and one tired moth.'],
  ['odd', 'Rain is just clouds that got a bit emotional.'],
  ['odd', 'Your shadow follows you everywhere. Loyal little thing.'],
  ['odd', 'Rumour has it the sea is just a very flat sky.'],
  ['odd', "Hello from inside the lantern. It's cosy in here."],

  // Notes from other birds
  ['bird', 'Left my favourite feather around here. If found, keep it.'],
  ['bird', 'Was here at dawn. Worth the early start. — a swift'],
  ['bird', "Don't trust the gulls. They know what they did."],
  ['bird', 'Saw you fly past earlier. Nice turn. — a heron'],
  ['bird', 'Lost my flock near the hills. Found a better one. — a sparrow'],
  ['bird', 'If you pass the old tree, say hi to my mum. — a young owl'],
  ['bird', 'The thermals here are excellent. Five stars. — a hawk'],
  ['bird', 'Ate something odd. Sorry about the statue. — a pigeon'],
];

export const LANTERN_NOTES: readonly LanternNote[] = RAW.map(([kind, text]) => ({ kind, text }));

/**
 * Picks the next note: never one of the last `gap` shown, the rare kind weighted down. Notes are
 * remembered by their text, so editing or reordering the list never mislabels what was seen.
 */
export class NotePicker {
  private readonly recent: string[];

  constructor(
    private readonly notes: readonly LanternNote[],
    recent: readonly string[] = [],
  ) {
    const known = new Set(notes.map((n) => n.text));
    this.recent = recent.filter((t) => known.has(t));
  }

  /** The texts shown lately, oldest first (to save). */
  get seen(): readonly string[] {
    return this.recent;
  }

  /** `rand` is 0..1 (Math.random in play, seeded in tests). */
  pick(gap: number, rareWeight: number, rand: () => number): LanternNote {
    // Never hold back so many that nothing is left to pick.
    const hold = Math.max(0, Math.min(gap, this.notes.length - 1));
    while (this.recent.length > hold) this.recent.shift();
    const held = new Set(this.recent);
    let total = 0;
    for (const n of this.notes) if (!held.has(n.text)) total += weight(n, rareWeight);
    let r = rand() * total;
    let chosen = this.notes[0];
    for (const n of this.notes) {
      if (held.has(n.text)) continue;
      chosen = n;
      r -= weight(n, rareWeight);
      if (r < 0) break;
    }
    if (hold > 0) {
      this.recent.push(chosen.text);
      if (this.recent.length > hold) this.recent.shift();
    }
    return chosen;
  }
}

const weight = (n: LanternNote, rare: number): number => (n.kind === 'bird' ? rare : 1);

/** Saved recent texts from storage: an array of strings, anything else dropped. */
export function parseSeenNotes(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
}
