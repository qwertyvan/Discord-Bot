import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { Application } from '@discord-bot/shared';

const STATUS_COLOR: Record<Application['status'], number> = {
  pending: 0x5865f2,
  approved: 0x57f287,
  rejected: 0xed4245,
};

const STATUS_LABEL: Record<Application['status'], string> = {
  pending: '🕐 Pending review',
  approved: '✅ Approved',
  rejected: '❌ Rejected',
};

export function buildApplicationEmbed(
  a: Application,
  formName: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${formName} — ${STATUS_LABEL[a.status]}`)
    .setColor(STATUS_COLOR[a.status])
    .setDescription(`Applicant: <@${a.userId}>`)
    .setFooter({ text: `Application ${a.id}` })
    .setTimestamp(new Date(a.createdAt));
  // Discord embed fields cap at 25; an application has at most 5 questions
  // (modal limit) so we never approach that ceiling here.
  for (const [label, answer] of Object.entries(a.answers)) {
    embed.addFields({
      name: label.slice(0, 256),
      value: (answer || '*(no answer)*').slice(0, 1024),
    });
  }
  if (a.status !== 'pending' && a.reviewedBy) {
    embed.addFields({
      name: 'Reviewed by',
      value: `<@${a.reviewedBy}>${a.reviewNote ? `\n${a.reviewNote}` : ''}`,
    });
  }
  return embed;
}

export function buildApplicationComponents(
  a: Application,
): ActionRowBuilder<ButtonBuilder>[] {
  if (a.status !== 'pending') return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`apply:approve:${a.id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`apply:reject:${a.id}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function applicationMessagePayload(a: Application, formName: string) {
  return {
    embeds: [buildApplicationEmbed(a, formName)],
    components: buildApplicationComponents(a),
  };
}
