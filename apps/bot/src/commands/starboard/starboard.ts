import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { invalidateStarboardConfigCache } from '../../events/messageReaction.js';
import { runStarboardDigest } from '../../util/starboard-digest.js';

export const starboard: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Manage the starboard (react-to-pin) for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Configure the starboard channel and rules.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel where pinned starboard entries are posted.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('threshold')
            .setDescription('Number of reactions to trigger pin (default 3).')
            .setMinValue(1)
            .setMaxValue(100),
        )
        .addStringOption((o) =>
          o
            .setName('emoji')
            .setDescription('Emoji to count (default ⭐). Unicode or :name:.')
            .setMaxLength(64),
        )
        .addBooleanOption((o) =>
          o
            .setName('allow-nsfw')
            .setDescription('Repost messages from NSFW channels (default false).'),
        ),
    )
    .addSubcommand((s) =>
      s.setName('config').setDescription('Show the current starboard config.'),
    )
    .addSubcommand((s) =>
      s
        .setName('digest')
        .setDescription('Manually post the weekly top-quotes digest.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel', true) as TextChannel;
        const threshold = interaction.options.getInteger('threshold') ?? undefined;
        const emoji = interaction.options.getString('emoji') ?? undefined;
        const allowNsfw = interaction.options.getBoolean('allow-nsfw') ?? undefined;

        const cfg = await api.upsertStarboardConfig(interaction.guildId, {
          channelId: channel.id,
          ...(threshold !== undefined ? { threshold } : {}),
          ...(emoji !== undefined ? { emoji } : {}),
          ...(allowNsfw !== undefined ? { allowNsfw } : {}),
          enabled: true,
        });
        invalidateStarboardConfigCache(interaction.guildId);
        await interaction.reply({
          content: `⭐ Starboard enabled in ${channel}. Threshold: **${cfg.threshold}**, emoji: ${cfg.emoji}, NSFW: ${cfg.allowNsfw ? 'allowed' : 'skipped'}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'config') {
        const cfg = await api.getStarboardConfig(interaction.guildId);
        const channelLine = cfg.channelId ? `<#${cfg.channelId}>` : '*(not set)*';
        const lines = [
          `**Enabled:** ${cfg.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${channelLine}`,
          `**Threshold:** ${cfg.threshold}`,
          `**Emoji:** ${cfg.emoji}`,
          `**Allow NSFW:** ${cfg.allowNsfw ? 'yes' : 'no'}`,
        ];
        await interaction.reply({
          content: lines.join('\n'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'digest') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await runStarboardDigest(interaction.guild);
        if (result.posted) {
          await interaction.editReply(
            `📰 Digest posted with **${result.entryCount}** top quotes from the last 7 days.`,
          );
        } else if (result.reason === 'no-entries') {
          await interaction.editReply('No starred messages in the last 7 days — nothing to post.');
        } else if (result.reason === 'no-channel') {
          await interaction.editReply('No starboard channel configured. Run `/starboard setup` first.');
        } else if (result.reason === 'disabled') {
          await interaction.editReply('Starboard is disabled for this server.');
        } else if (result.reason === 'channel-missing') {
          await interaction.editReply('Configured starboard channel was not found.');
        } else {
          await interaction.editReply('Digest send failed. Check bot permissions.');
        }
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
