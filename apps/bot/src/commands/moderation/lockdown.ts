import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

/**
 * Lockdown denies @everyone the SendMessages permission on the given channel
 * (or every text channel when `all:true`). It modifies channel overwrites
 * directly — no database state — so /unlockdown undoes it the same way.
 */
export const lockdown: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Prevent @everyone from sending messages in this channel (or every channel).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addBooleanOption((o) => o.setName('all').setDescription('Lock every text channel in the server.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const all = interaction.options.getBoolean('all') ?? false;
    const everyone = interaction.guild.roles.everyone;
    const reason = `Lockdown by ${interaction.user.tag}`;

    if (all) {
      await interaction.deferReply();
      const channels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText && c.manageable,
      );
      let locked = 0;
      for (const channel of channels.values()) {
        if (!('permissionOverwrites' in channel)) continue;
        try {
          await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
          locked++;
        } catch {
          // ignore individual channel failures (perms, archived threads etc.)
        }
      }
      await interaction.editReply(`🔒 Locked **${locked}** channel${locked === 1 ? '' : 's'}.`);
      return;
    }

    const channel = interaction.channel;
    if (!channel || !('permissionOverwrites' in channel)) {
      await interaction.reply({ content: 'This channel does not support lockdown.', flags: MessageFlags.Ephemeral });
      return;
    }
    await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
    await interaction.reply('🔒 Channel locked down.');
  },
};
