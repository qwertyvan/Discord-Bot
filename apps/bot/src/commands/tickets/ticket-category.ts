import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const ticketCategory: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket-category')
    .setDescription('Manage ticket categories.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a category.')
        .addStringOption((o) => o.setName('name').setDescription('Display name.').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Short description.').setMaxLength(300))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji (unicode or <:name:id>).'))
        .addRoleOption((o) => o.setName('staff_role').setDescription('Staff role for this category.')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List ticket categories.'))
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a category by ID.')
        .addStringOption((o) => o.setName('id').setDescription('Category ID.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add') {
        const name = interaction.options.getString('name', true);
        const description = interaction.options.getString('description') ?? undefined;
        const emoji = interaction.options.getString('emoji') ?? undefined;
        const staff = interaction.options.getRole('staff_role');
        const cat = await api.createTicketCategory(interaction.guildId, {
          name,
          ...(description ? { description } : {}),
          ...(emoji ? { emoji } : {}),
          ...(staff ? { staffRoleId: staff.id } : {}),
        });
        await interaction.reply({
          content: `✅ Added category **${cat.name}** (\`${cat.id}\`).`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { categories } = await api.listTicketCategories(interaction.guildId);
        if (categories.length === 0) {
          await interaction.reply({
            content: 'No categories defined — tickets will use a single Open button.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Ticket categories')
          .setColor(0x5865f2)
          .setDescription(
            categories
              .map(
                (c) =>
                  `${c.emoji ?? '•'} **${c.name}** — ${c.description ?? '_no description_'}\n  \`${c.id}\`${
                    c.staffRoleId ? ` · staff <@&${c.staffRoleId}>` : ''
                  }`,
              )
              .join('\n\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteTicketCategory(interaction.guildId, id);
        await interaction.reply({ content: `🗑️ Removed \`${id}\`.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const m = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: m, flags: MessageFlags.Ephemeral });
    }
  },
};
