import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

/**
 * Publishes the verification message + button to the channel configured in
 * the dashboard (or the channel passed as an option), and stores its message
 * ID back to the config so the bot can re-publish/repair it later.
 */
export const verifySetup: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Publish the verification button to a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post the verify button in.')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let cfg;
    try {
      cfg = await api.getVerificationConfig(interaction.guildId!);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to fetch config.';
      await interaction.editReply(msg);
      return;
    }
    if (!cfg.enabled || !cfg.verifiedRoleId) {
      await interaction.editReply(
        'Verification is not configured. Enable it and pick a verified role in the dashboard first.',
      );
      return;
    }

    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel | null;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply('Pick a text channel.');
      return;
    }

    const button = new ButtonBuilder()
      .setCustomId('verify')
      .setLabel(cfg.buttonLabel ?? 'Verify')
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    const message = await channel.send({
      content: cfg.prompt ?? 'Click the button below to verify and gain access to the server.',
      components: [row],
      allowedMentions: { parse: [] },
    });

    await api
      .updateVerificationConfig(interaction.guildId!, {
        channelId: channel.id,
        messageId: message.id,
      })
      .catch(() => {});

    await interaction.editReply(`✅ Verification button posted in ${channel}.`);
  },
};
