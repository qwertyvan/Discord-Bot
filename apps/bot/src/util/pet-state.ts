import type { PetStage, ServerPet } from '@discord-bot/shared';

// XP thresholds per stage. The pet enters a stage the moment xp crosses the
// floor; thresholds intentionally double-roughly so /pet status feels like
// real progress without rolling over on the first feed. Mirrors the values
// the API uses to set ServerPet.stage on every interaction write.
export const PET_STAGES = ['egg', 'baby', 'teen', 'adult', 'legendary'] as const;
export const PET_STAGE_THRESHOLDS: Readonly<Record<PetStage, number>> = {
  egg: 0,
  baby: 100,
  teen: 500,
  adult: 2000,
  legendary: 10_000,
};

export function computeStage(xp: number): PetStage {
  let stage: PetStage = 'egg';
  for (const candidate of PET_STAGES) {
    if (xp >= PET_STAGE_THRESHOLDS[candidate]) stage = candidate;
  }
  return stage;
}

// Returns the (current floor, next floor) so we can render a "X / Y" XP bar
// in /pet status. For legendary we return null for the next floor.
export function stageProgress(xp: number): {
  stage: PetStage;
  current: number;
  next: number | null;
  inStage: number;
  spanStage: number;
} {
  const stage = computeStage(xp);
  const current = PET_STAGE_THRESHOLDS[stage];
  const idx = PET_STAGES.indexOf(stage);
  const next =
    idx >= 0 && idx + 1 < PET_STAGES.length ? PET_STAGE_THRESHOLDS[PET_STAGES[idx + 1]!] : null;
  return {
    stage,
    current,
    next,
    inStage: Math.max(0, xp - current),
    spanStage: next !== null ? next - current : 0,
  };
}

// Per-hour decay/regen rates. Hunger and happiness rot, energy refills so
// active pets that aren't being played with build a "ready to romp" reserve.
export const PET_DECAY_PER_HOUR = {
  hunger: -1,
  happiness: -1,
  energy: +1,
} as const;

export type PetMood = 'happy' | 'meh' | 'sad';

// Drawn from the worst stat. A single zeroed-out stat is enough to flip the
// pet to "sad" — the embed renderer uses this to recolour the card.
export function petMood(pet: Pick<ServerPet, 'hunger' | 'happiness' | 'energy'>): PetMood {
  const worst = Math.min(pet.hunger, pet.happiness, pet.energy);
  if (worst <= 0) return 'sad';
  if (worst < 40) return 'meh';
  return 'happy';
}

export const PET_STAGE_EMOJI: Readonly<Record<PetStage, string>> = {
  egg: '🥚',
  baby: '🐣',
  teen: '🐥',
  adult: '🐦',
  legendary: '🦅',
};

export const PET_MOOD_EMOJI: Readonly<Record<PetMood, string>> = {
  happy: '😊',
  meh: '😐',
  sad: '😢',
};

export function moodColor(mood: PetMood): number {
  switch (mood) {
    case 'happy':
      return 0x57f287;
    case 'meh':
      return 0xfee75c;
    case 'sad':
      return 0xed4245;
  }
}

// Render a compact 10-cell bar for stat lines in the /pet status embed.
export function statBar(value: number, max = 100): string {
  const filled = Math.max(0, Math.min(10, Math.round((value / max) * 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}
