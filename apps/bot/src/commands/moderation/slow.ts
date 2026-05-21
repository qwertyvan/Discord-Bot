import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

const PRESETS: Record<string, number> = {
  off: 0,
  light: 5,
  normal: 15,
  heavy: 60,
  emergency: 300,
};

export const slow: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('slow')
    .setDescription('Set channel slow-mode using a preset or custom seconds.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('preset')
        .setDescription('Slow-mode preset.')
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'light (5s)', value: 'light' },
          { name: 'normal (15s)', value: 'normal' },
          { name: 'heavy (60s)', value: 'heavy' },
          { name: 'emergency (5m)', value: 'emergency' },
        ),
    )
    .addIntegerOption((o) =>
      o.setName('seconds').setDescription('Custom seconds (overrides preset).').setMinValue(0).setMaxValue(21600),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.channel) return;
    const channel = interaction.channel;
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: 'Slow-mode only applies to text channels.', flags: MessageFlags.Ephemeral });
      return;
    }
    const seconds = interaction.options.getInteger('seconds');
    const preset = interaction.options.getString('preset');
    if (seconds === null && preset === null) {
      await interaction.reply({ content: 'Choose a preset or seconds.', flags: MessageFlags.Ephemeral });
      return;
    }
    const value = seconds ?? PRESETS[preset!]!;
    await channel.setRateLimitPerUser(value, `Slow-mode by ${interaction.user.tag}`);
    await interaction.reply(value === 0 ? '🐢 Slow-mode disabled.' : `🐢 Slow-mode set to **${value}s**.`);
  },
};
