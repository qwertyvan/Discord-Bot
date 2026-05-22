import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const warnLadder: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warn-ladder')
    .setDescription('Configure the warning escalation ladder.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add or replace a ladder step.')
        .addIntegerOption((o) =>
          o.setName('threshold').setDescription('Active-warning count that triggers this step.').setRequired(true).setMinValue(1),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Action to apply.')
            .setRequired(true)
            .addChoices(
              { name: 'mute (timeout)', value: 'mute' },
              { name: 'kick', value: 'kick' },
              { name: 'ban', value: 'ban' },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName('duration_minutes')
            .setDescription('Mute duration in minutes (mute only; default 60).')
            .setMinValue(1)
            .setMaxValue(40320),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove the ladder step at a threshold.')
        .addIntegerOption((o) =>
          o.setName('threshold').setDescription('Threshold to remove.').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all configured ladder steps.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add') {
        const threshold = interaction.options.getInteger('threshold', true);
        const action = interaction.options.getString('action', true) as 'mute' | 'kick' | 'ban';
        const durationMinutes = interaction.options.getInteger('duration_minutes') ?? undefined;
        if (action !== 'mute' && durationMinutes !== undefined) {
          await interaction.reply({
            content: 'duration_minutes only applies to mute.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const step = await api.upsertLadderStep(interaction.guildId, {
          threshold,
          action,
          ...(durationMinutes !== undefined ? { durationMinutes } : {}),
        });
        const suffix =
          step.action === 'mute' && step.durationMinutes
            ? ` for **${step.durationMinutes}m**`
            : '';
        await interaction.reply({
          content: `🪜 Ladder step saved: at **${step.threshold}** warnings → **${step.action}**${suffix}.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const threshold = interaction.options.getInteger('threshold', true);
        await api.deleteLadderStepByThreshold(interaction.guildId, threshold);
        await interaction.reply({
          content: `🗑️ Removed ladder step at threshold **${threshold}**.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { steps } = await api.listLadder(interaction.guildId);
        if (steps.length === 0) {
          await interaction.reply({
            content: 'No ladder steps configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = steps.map((s) => {
          const suffix =
            s.action === 'mute' && s.durationMinutes ? ` for ${s.durationMinutes}m` : '';
          return `• **${s.threshold}** warnings → **${s.action}**${suffix}`;
        });
        await interaction.reply({
          content: `**Warning ladder:**\n${lines.join('\n')}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
