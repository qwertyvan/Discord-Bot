import { EmbedBuilder, time } from 'discord.js';
import type { CastResult, FishingCast, FishingSkill } from '@discord-bot/shared';

// Tier copy / colour for embed flavour. The "bait" tier maps to the same
// blurple we use for other neutral/info embeds; intermediate is a teal-ish
// blue and master is a deep gold.
const TIER_COLOR: Record<FishingSkill['tier'], number> = {
  bait: 0x5865f2,
  intermediate: 0x3ba55d,
  master: 0xf1c40f,
};

const TIER_LABEL: Record<FishingSkill['tier'], string> = {
  bait: 'Bait',
  intermediate: 'Intermediate',
  master: 'Master',
};

// Animated "waiting on a bite" string used while the player's cast is
// in-flight. We change between three frames here purely for embed flavour;
// the timer itself is driven by Discord's relative-time format.
const WAITING_FRAMES = ['🎣  〰️ 〰️ 〰️', '🎣  〰️ 🫧 〰️', '🎣  🫧 〰️ 🫧'] as const;
export function pickWaitingFrame(seedNum: number): string {
  // The seed is "now()/1000 | 0" or any small integer at the call site —
  // we just need *some* variation so consecutive casts don't all show the
  // same frame.
  return WAITING_FRAMES[seedNum % WAITING_FRAMES.length] ?? WAITING_FRAMES[0];
}

export function buildCastEmbed(cast: FishingCast): EmbedBuilder {
  const resolvesAt = new Date(cast.resolvesAt);
  const frame = pickWaitingFrame(Math.floor(new Date(cast.startedAt).getTime() / 1000));
  return new EmbedBuilder()
    .setTitle('🎣 Line cast')
    .setColor(0x5dade2)
    .setDescription(
      [
        frame,
        '',
        `Hold tight — your bobber resolves ${time(resolvesAt, 'R')}.`,
        'The "Reel in" button unlocks once the timer ends.',
      ].join('\n'),
    )
    .setFooter({ text: `cast ${cast.id.slice(0, 8)}` });
}

export function buildResultEmbed(
  result: CastResult,
  currencySymbol = '🪙',
): EmbedBuilder {
  const { drop, skill, leveledUp, previousLevel, cast } = result;
  const tierColor = TIER_COLOR[skill.tier];

  const lines: string[] = [];
  if (drop) {
    lines.push(`${drop.emoji} **${drop.name}** \`${drop.slug}\``);
    if (cast.currencyEarned > 0) {
      lines.push(`💰 ${cast.currencyEarned.toLocaleString()} ${currencySymbol}`);
    }
    if (cast.xpEarned > 0) {
      lines.push(`✨ +${cast.xpEarned} fishing XP`);
    }
  } else {
    // Either the drop table is empty or no drops matched the player's
    // level. We try to be specific about why so admins can react.
    lines.push('🪨 Nothing took the bait.');
    lines.push('_Ask a mod to add some drops with `/fish admin add` or `/fish admin seed`._');
  }
  if (leveledUp) {
    lines.push('');
    lines.push(`🎉 Levelled up: **${previousLevel} → ${skill.level}** (${TIER_LABEL[skill.tier]})`);
  }

  return new EmbedBuilder()
    .setTitle(drop ? '🎣 Reeled it in!' : '🎣 Empty hook')
    .setColor(drop ? tierColor : 0x95a5a6)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Level', value: `${skill.level} (${TIER_LABEL[skill.tier]})`, inline: true },
      {
        name: 'XP',
        value:
          skill.nextLevelXp !== null
            ? `${skill.xp.toLocaleString()} / ${skill.nextLevelXp.toLocaleString()}`
            : `${skill.xp.toLocaleString()} (max tier)`,
        inline: true,
      },
      { name: 'Total casts', value: `${skill.casts.toLocaleString()}`, inline: true },
    )
    .setFooter({ text: `cast ${cast.id.slice(0, 8)}` });
}

export function buildSkillEmbed(skill: FishingSkill, displayName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🎣 ${displayName}'s fishing`)
    .setColor(TIER_COLOR[skill.tier])
    .addFields(
      { name: 'Level', value: `${skill.level} (${TIER_LABEL[skill.tier]})`, inline: true },
      {
        name: 'XP',
        value:
          skill.nextLevelXp !== null
            ? `${skill.xp.toLocaleString()} / ${skill.nextLevelXp.toLocaleString()}`
            : `${skill.xp.toLocaleString()} (max tier)`,
        inline: true,
      },
      { name: 'Total casts', value: `${skill.casts.toLocaleString()}`, inline: true },
    );
}
