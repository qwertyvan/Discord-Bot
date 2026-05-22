import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

// Map a few high-signal permission flags to readable labels. We don't try to
// translate every single Permission bit — the giant list is unhelpful in an
// embed. Instead we surface the perms admins usually care about, plus an
// "Administrator: yes/no" shortcut.
const NOTABLE_PERMS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageThreads',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'MentionEveryone',
] as const;

export const roleinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Show information about a role.')
    .setContexts(0)
    .addRoleOption((o) =>
      o.setName('role').setDescription('Role to inspect.').setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'This command must be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const role = interaction.options.getRole('role', true);
    // Re-resolve through the live cache so we always have the discord.js Role
    // instance (the option may be a partial APIRole).
    const liveRole = interaction.guild.roles.cache.get(role.id);
    if (!liveRole) {
      await interaction.reply({
        content: 'Could not resolve that role.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // We need a full member list to count + show holders. fetch() is cheap
    // enough for typical guilds and is the only way to enumerate role
    // membership reliably.
    await interaction.guild.members.fetch().catch(() => null);
    const members = liveRole.members;

    const memberSample = members
      .first(10)
      .map((m) => m.toString())
      .join(' ');

    const permsHeld = NOTABLE_PERMS.filter((p) =>
      liveRole.permissions.has(p as Parameters<typeof liveRole.permissions.has>[0]),
    );

    const embed = new EmbedBuilder()
      .setTitle(`Role: ${liveRole.name}`)
      .setColor(liveRole.color || 0x5865f2)
      .addFields(
        { name: 'ID', value: liveRole.id, inline: true },
        { name: 'Members', value: String(members.size), inline: true },
        { name: 'Position', value: String(liveRole.position), inline: true },
        {
          name: 'Color',
          value: liveRole.color ? `#${liveRole.color.toString(16).padStart(6, '0')}` : 'None',
          inline: true,
        },
        { name: 'Hoisted', value: liveRole.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Mentionable', value: liveRole.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Managed', value: liveRole.managed ? 'Yes (bot/integration)' : 'No', inline: true },
        {
          name: 'Created',
          value: time(liveRole.createdAt, TimestampStyles.LongDate),
          inline: false,
        },
        {
          name: 'Notable permissions',
          value: permsHeld.length > 0 ? permsHeld.map((p) => `\`${p}\``).join(', ') : 'None',
          inline: false,
        },
      );

    if (memberSample) {
      embed.addFields({
        name: `Members (showing first ${Math.min(10, members.size)} of ${members.size})`,
        value: memberSample,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
