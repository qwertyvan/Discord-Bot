import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { BattlePet, DuelMatch } from '@discord-bot/shared';

// Client-side renderer for duel state. The server is authoritative on game
// logic — this util only formats what the API returns.

const STATUS_COLOR: Record<DuelMatch['status'], number> = {
  pending: 0xfee75c,
  active: 0x5865f2,
  ended: 0x57f287,
  cancelled: 0xed4245,
};

const STATUS_LABEL: Record<DuelMatch['status'], string> = {
  pending: '⚔️ Duel · Awaiting',
  active: '⚔️ Duel · In progress',
  ended: '🏁 Duel · Ended',
  cancelled: '🛑 Duel · Cancelled',
};

function hpBar(hp: number, max: number, width = 12): string {
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, max)));
  const filled = Math.round(width * ratio);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function sideField(label: string, pet: BattlePet, hp: number, defending: boolean) {
  const lines = [
    `**${pet.name}** · Lv ${pet.level} · ${pet.species}`,
    `❤️ ${hp} / ${pet.maxHp}`,
    `\`${hpBar(hp, pet.maxHp)}\``,
    `ATK ${pet.atk} · DEF ${pet.def} · SPD ${pet.spd}${defending ? ' · 🛡️ defending' : ''}`,
  ];
  return { name: label, value: lines.join('\n'), inline: true };
}

export function buildDuelEmbed(
  match: DuelMatch,
  challengerPet: BattlePet,
  opponentPet: BattlePet,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(STATUS_LABEL[match.status])
    .setColor(STATUS_COLOR[match.status])
    .addFields(
      sideField(
        `Challenger`,
        challengerPet,
        match.challengerHp,
        match.challengerDefending,
      ),
      { name: '​', value: '**vs**', inline: true },
      sideField(
        `Opponent`,
        opponentPet,
        match.opponentHp,
        match.opponentDefending,
      ),
    );

  // Header line — challenger / opponent mentions for clarity.
  embed.setDescription(
    `<@${match.challengerId}> vs <@${match.opponentId}>` +
      (match.status === 'active' && match.currentActorId
        ? `\nIt is <@${match.currentActorId}>'s turn.`
        : '') +
      (match.status === 'ended' && match.winnerId
        ? `\n🏆 Winner: <@${match.winnerId}>`
        : '') +
      (match.status === 'ended' && match.winnerId === null
        ? `\n🤝 Mutual KO — draw.`
        : ''),
  );

  // Last few log entries.
  if (match.log.length > 0) {
    const tail = match.log.slice(-5).map((e) => {
      const verb =
        e.move === 'attack'
          ? 'attacks'
          : e.move === 'special'
            ? 'uses a special'
            : 'defends';
      const crit = e.crit ? ' 💥CRIT' : '';
      const dmg = e.move === 'defend' ? '' : ` — ${e.damage} dmg${crit}`;
      return `T${e.turn}: <@${e.actorId}> ${verb}${dmg}`;
    });
    embed.addFields({ name: 'Recent moves', value: tail.join('\n') });
  }

  embed.setFooter({ text: `Duel ${match.id}` });
  return embed;
}

export function buildAcceptButtons(matchId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`du:accept:${matchId}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`du:decline:${matchId}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function buildDuelMoveButtons(
  matchId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`du:move:${matchId}:attack`)
        .setLabel('Attack')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`du:move:${matchId}:defend`)
        .setLabel('Defend')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`du:move:${matchId}:special`)
        .setLabel('Special')
        .setEmoji('✨')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function duelMessagePayload(
  match: DuelMatch,
  challengerPet: BattlePet,
  opponentPet: BattlePet,
) {
  const embeds = [buildDuelEmbed(match, challengerPet, opponentPet)];
  if (match.status === 'pending') {
    return { embeds, components: buildAcceptButtons(match.id) };
  }
  if (match.status === 'active') {
    return { embeds, components: buildDuelMoveButtons(match.id) };
  }
  return { embeds, components: [] };
}
