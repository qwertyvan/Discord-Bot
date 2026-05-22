import {
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function parseHex(input: string | null | undefined): number | null {
  if (!input) return null;
  const v = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return parseInt(v, 16);
}

export const color: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Pick a vanity color role for yourself.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('pick')
        .setDescription('Pick a color role.')
        .addRoleOption((o) =>
          o.setName('role').setDescription('The color role to apply.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('clear').setDescription('Remove all of your color roles.'))
    .addSubcommand((s) => s.setName('list').setDescription('List available color roles.'))
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Manage the vanity color catalogue.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a role to the vanity color catalogue.')
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to register as a color.').setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('hex')
                .setDescription('Hex color (#RRGGBB). Applied to the Discord role if writable.'),
            )
            .addStringOption((o) =>
              o
                .setName('name')
                .setDescription('Display name (defaults to the role name).')
                .setMaxLength(64),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a role from the vanity color catalogue.')
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to deregister.').setRequired(true),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'admin') {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageRoles)) {
          await interaction.reply({
            content: 'You need Manage Roles for that.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'add') {
          const role = interaction.options.getRole('role', true);
          const hex = interaction.options.getString('hex') ?? undefined;
          const name = interaction.options.getString('name') ?? role.name;
          if (hex !== undefined && !/^#?[0-9a-fA-F]{6}$/.test(hex)) {
            await interaction.reply({
              content: 'Hex color must be #RRGGBB.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const normalizedHex = hex ? (hex.startsWith('#') ? hex : `#${hex}`) : undefined;

          // Best-effort: paint the Discord role with the supplied color.
          if (normalizedHex) {
            const colorInt = parseHex(normalizedHex);
            if (colorInt !== null) {
              const fullRole = interaction.guild.roles.cache.get(role.id);
              if (fullRole) {
                await fullRole.setColor(colorInt, 'Vanity color registration').catch(() => {
                  // Role may be above the bot's highest role; the catalogue
                  // entry still gets created so users can self-assign it.
                });
              }
            }
          }

          const created = await api.createVanityRole(interaction.guildId, {
            roleId: role.id,
            name,
            kind: 'color',
            ...(normalizedHex ? { hexColor: normalizedHex } : {}),
          });
          await interaction.reply({
            content: `🎨 Added <@&${created.roleId}> to the color catalogue.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }
        if (sub === 'remove') {
          const role = interaction.options.getRole('role', true);
          await api.deleteVanityRoleByRoleId(interaction.guildId, role.id);
          await interaction.reply({
            content: `🗑️ Removed <@&${role.id}> from the color catalogue.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }
      }

      if (sub === 'pick') {
        const role = interaction.options.getRole('role', true);
        const { vanityRoles } = await api.listVanityRoles(interaction.guildId, 'color');
        const match = vanityRoles.find((v) => v.roleId === role.id);
        if (!match) {
          await interaction.reply({
            content: 'That role is not in the color catalogue. See `/color list`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (!(interaction.member instanceof GuildMember)) return;
        const member = interaction.member;
        const otherColorIds = vanityRoles.filter((v) => v.roleId !== role.id).map((v) => v.roleId);
        const toRemove = member.roles.cache.filter((r) => otherColorIds.includes(r.id));
        if (toRemove.size > 0) {
          await member.roles.remove(toRemove, 'Color role swap').catch(() => {});
        }
        await member.roles.add(role.id, 'Color role pick');
        await interaction.reply({
          content: `🎨 You now wear **${match.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'clear') {
        if (!(interaction.member instanceof GuildMember)) return;
        const member = interaction.member;
        const { vanityRoles } = await api.listVanityRoles(interaction.guildId, 'color');
        const colorIds = vanityRoles.map((v) => v.roleId);
        const toRemove = member.roles.cache.filter((r) => colorIds.includes(r.id));
        if (toRemove.size === 0) {
          await interaction.reply({
            content: 'You have no color roles to clear.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await member.roles.remove(toRemove, 'Color role clear');
        await interaction.reply({
          content: '🗑️ Color roles cleared.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'list') {
        const { vanityRoles } = await api.listVanityRoles(interaction.guildId, 'color');
        if (vanityRoles.length === 0) {
          await interaction.reply({
            content: 'No color roles configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Available colors')
          .setColor(0x5865f2)
          .setDescription(
            vanityRoles
              .map((v) => {
                const hex = v.hexColor ? ` · \`${v.hexColor}\`` : '';
                return `<@&${v.roleId}> — **${v.name}**${hex}`;
              })
              .join('\n'),
          );
        await interaction.reply({
          embeds: [embed],
          allowedMentions: { parse: [] },
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
