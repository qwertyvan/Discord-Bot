import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { log } from '../../logger.js';

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_IDS = 200;

export const massban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('massban')
    .setDescription('Ban a list of user IDs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('ids')
        .setDescription('Comma or whitespace separated user IDs (max 200).')
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason for ban.').setMaxLength(500)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const rawIds = interaction.options.getString('ids', true);
    const reason = interaction.options.getString('reason') ?? 'Massban';

    const ids = [...new Set(rawIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
    const invalid = ids.filter((id) => !SNOWFLAKE.test(id));
    if (invalid.length > 0) {
      await interaction.reply({
        content: `Invalid IDs: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? ' …' : ''}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ids.length === 0) {
      await interaction.reply({ content: 'No IDs provided.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (ids.length > MAX_IDS) {
      await interaction.reply({ content: `Too many IDs (max ${MAX_IDS}).`, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();

    const auditReason = `${interaction.user.tag} [massban]: ${reason}`;
    let banned = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await interaction.guild.bans.create(id, { reason: auditReason });
        await api
          .createModAction(interaction.guildId!, {
            type: 'BAN',
            userId: id,
            moderatorId: interaction.user.id,
            reason,
          })
          .catch((err) => {
            log.warn('Massban: failed to log', { id, err: err instanceof Error ? err.message : String(err) });
          });
        banned++;
      } catch (err) {
        log.warn('Massban: ban failed', { id, err: err instanceof Error ? err.message : String(err) });
        failed++;
      }
    }

    await interaction.editReply(`🔨 Massban complete: **${banned}** banned, **${failed}** failed.`);
    if (failed > 0) {
      log.info('Massban summary', { banned, failed, by: interaction.user.id });
    }
    void ApiError;
  },
};
