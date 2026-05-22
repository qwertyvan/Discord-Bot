import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const stalePolicy: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('stale-policy')
    .setDescription('Configure the stale-thread policy for forum channels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set the stale-thread policy.')
        .addIntegerOption((o) =>
          o
            .setName('idle_hours')
            .setDescription('Archive/lock threads inactive for this many hours.')
            .setMinValue(1)
            .setMaxValue(24 * 30)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('What to do with stale threads.')
            .setRequired(true)
            .addChoices(
              { name: 'archive', value: 'archive' },
              { name: 'lock', value: 'lock' },
            ),
        )
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Enable the policy (defaults to true).'),
        ),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show the current policy.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const idleHours = interaction.options.getInteger('idle_hours', true);
        const action = interaction.options.getString('action', true) as 'archive' | 'lock';
        const enabledOpt = interaction.options.getBoolean('enabled');
        const enabled = enabledOpt ?? true;
        const updated = await api.upsertStaleThreadPolicy(interaction.guildId, {
          enabled,
          idleHours,
          action,
        });
        await interaction.reply({
          content: `🧹 Stale-thread policy ${updated.enabled ? 'enabled' : 'disabled'}: ${
            updated.action === 'lock' ? 'lock' : 'archive'
          } threads idle for ≥${updated.idleHours}h.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'show') {
        const p = await api.getStaleThreadPolicy(interaction.guildId);
        await interaction.reply({
          content: `**Stale-thread policy** — ${p.enabled ? 'enabled' : 'disabled'}\nAction: \`${p.action}\`\nIdle hours: \`${p.idleHours}\``,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
