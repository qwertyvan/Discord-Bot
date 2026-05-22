import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { invalidateVoiceHubCache } from '../../events/voice-state.js';

export const voiceHub: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voice-hub')
    .setDescription('Configure join-to-create voice hubs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Mark a voice channel as a join-to-create hub.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The voice channel to use as the hub.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('name_pattern')
            .setDescription("Child channel name. {username} is substituted. Default: {username}'s room")
            .setMaxLength(64),
        )
        .addIntegerOption((o) =>
          o
            .setName('user_limit')
            .setDescription('Discord user limit on spawned channels (0 = no limit).')
            .setMinValue(0)
            .setMaxValue(99),
        )
        .addChannelOption((o) =>
          o
            .setName('category')
            .setDescription('Category to spawn child channels under (defaults to hub channel parent).')
            .addChannelTypes(ChannelType.GuildCategory),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Stop treating this channel as a hub.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The hub channel to remove.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('List configured voice hubs.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel', true);
        const namePattern =
          interaction.options.getString('name_pattern') ?? "{username}'s room";
        const userLimit = interaction.options.getInteger('user_limit');
        const category = interaction.options.getChannel('category');

        await api.upsertVoiceHub(interaction.guildId, {
          channelId: channel.id,
          namePattern,
          ...(userLimit !== null ? { userLimit } : {}),
          ...(category ? { categoryId: category.id } : {}),
        });
        invalidateVoiceHubCache(interaction.guildId);
        await interaction.reply({
          content: `🎙️ <#${channel.id}> is now a join-to-create hub. Children will be named \`${namePattern}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel', true);
        await api.deleteVoiceHub(interaction.guildId, channel.id);
        invalidateVoiceHubCache(interaction.guildId);
        await interaction.reply({
          content: `🗑️ <#${channel.id}> is no longer a voice hub.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { hubs } = await api.listVoiceHubs(interaction.guildId);
        if (hubs.length === 0) {
          await interaction.reply({
            content: 'No voice hubs configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Voice hubs')
          .setColor(0x5865f2)
          .setDescription(
            hubs
              .map((h) => {
                const limit =
                  h.userLimit && h.userLimit > 0 ? ` · limit ${h.userLimit}` : '';
                return `<#${h.channelId}> → \`${h.namePattern}\`${limit}`;
              })
              .join('\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
