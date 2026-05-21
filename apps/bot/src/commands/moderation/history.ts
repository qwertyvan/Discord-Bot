import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

const TYPE_LABEL: Record<string, string> = {
  WARN: '⚠️ warn',
  KICK: '🥾 kick',
  BAN: '🔨 ban',
  UNBAN: '🔓 unban',
  SOFTBAN: '🧹 softban',
  TIMEOUT: '⏱️ timeout',
  UNTIMEOUT: '⏯️ untimeout',
  MUTE: '🔇 mute',
  UNMUTE: '🔈 unmute',
  NOTE: '📝 note',
};

export const history: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show combined moderation history for a user (actions + notes).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Target user.').setRequired(true)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user', true);

    try {
      const { actions, notes } = await api.getUserHistory(interaction.guildId, target.id, { limit: 50 });

      if (actions.length === 0 && notes.length === 0) {
        await interaction.reply({
          content: `${target} has no moderation history.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`History for ${target.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(0x5865f2)
        .setFooter({
          text: `${actions.length} action${actions.length === 1 ? '' : 's'} · ${notes.length} note${
            notes.length === 1 ? '' : 's'
          }`,
        });

      const items: { ts: Date; label: string; body: string }[] = [];
      for (const a of actions) {
        items.push({
          ts: new Date(a.createdAt),
          label: `#${a.caseNumber} ${TYPE_LABEL[a.type] ?? a.type}`,
          body: `${a.reason}${a.active ? '' : ' *(inactive)*'} · <@${a.moderatorId}>`,
        });
      }
      for (const n of notes) {
        items.push({
          ts: new Date(n.createdAt),
          label: TYPE_LABEL.NOTE!,
          body: `${n.content} · <@${n.moderatorId}>`,
        });
      }
      items.sort((a, b) => b.ts.getTime() - a.ts.getTime());

      for (const it of items.slice(0, 15)) {
        embed.addFields({
          name: `${it.label} · ${time(it.ts, TimestampStyles.ShortDateTime)}`,
          value: it.body,
        });
      }
      if (items.length > 15) {
        embed.setDescription(`Showing the most recent 15 of ${items.length}. Use the dashboard for the full history.`);
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
      const msg = err instanceof ApiError ? `Failed: ${err.message}` : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
