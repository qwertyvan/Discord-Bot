import { EmbedBuilder, SlashCommandBuilder, time, TimestampStyles } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const userinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a user.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The user to inspect (defaults to you).'),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const member =
      interaction.inGuild() && interaction.guild
        ? await interaction.guild.members.fetch(target.id).catch(() => null)
        : null;

    const embed = new EmbedBuilder()
      .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .setColor(member?.displayColor ?? 0x5865f2)
      .addFields(
        { name: 'ID', value: target.id, inline: true },
        { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true },
        {
          name: 'Created',
          value: time(target.createdAt, TimestampStyles.RelativeTime),
          inline: false,
        },
      );

    if (member) {
      if (member.joinedAt) {
        embed.addFields({
          name: 'Joined server',
          value: time(member.joinedAt, TimestampStyles.RelativeTime),
        });
      }
      const roles = member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => r.toString());
      if (roles.length > 0) {
        embed.addFields({
          name: `Roles (${roles.length})`,
          value: roles.slice(0, 15).join(' ') + (roles.length > 15 ? ' …' : ''),
        });
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
};
