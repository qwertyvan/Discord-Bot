import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type { CounterChannelType } from '@discord-bot/shared';

const COUNTER_TYPES = ['members', 'humans', 'bots', 'online', 'boosts'] as const;

export const counter: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('counter')
    .setDescription('Manage live channel-name counters.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add or replace a counter on a channel.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to rename periodically.').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('What to count.')
            .setRequired(true)
            .addChoices(
              { name: 'Members (total)', value: 'members' },
              { name: 'Humans', value: 'humans' },
              { name: 'Bots', value: 'bots' },
              { name: 'Online', value: 'online' },
              { name: 'Boosts', value: 'boosts' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription('Template with {count} placeholder. Default: "Members: {count}".')
            .setMaxLength(64),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove the counter from a channel.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to stop renaming.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('List counter channels in this server.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add') {
        const channel = interaction.options.getChannel('channel', true);
        const type = interaction.options.getString('type', true) as CounterChannelType;
        const template = interaction.options.getString('template') ?? undefined;
        if (!COUNTER_TYPES.includes(type)) {
          await interaction.reply({
            content: 'Unknown counter type.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await api.upsertCounterChannel(interaction.guildId, {
          channelId: channel.id,
          type,
          ...(template ? { template } : {}),
        });
        await interaction.reply({
          content: `📊 Counter set on <#${channel.id}> (${type}). It will update every ~5 minutes.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel', true);
        await api.deleteCounterChannel(interaction.guildId, channel.id);
        await interaction.reply({
          content: `🗑️ Counter removed from <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'list') {
        const { counters } = await api.listCounterChannels(interaction.guildId);
        if (counters.length === 0) {
          await interaction.reply({
            content: 'No counter channels configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Counter channels')
          .setColor(0x5865f2)
          .setDescription(
            counters
              .map((c) => `<#${c.channelId}> — **${c.type}** · template: \`${c.template}\``)
              .join('\n'),
          );
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
