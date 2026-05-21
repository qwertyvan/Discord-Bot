import {
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const shop: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse and buy items from the server shop.')
    .setContexts(0)
    .addSubcommand((s) => s.setName('list').setDescription('Show all shop items.'))
    .addSubcommand((s) =>
      s
        .setName('buy')
        .setDescription('Buy a shop item by name.')
        .addStringOption((o) => o.setName('name').setDescription('Item name.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a shop item (requires Manage Guild).')
        .addStringOption((o) => o.setName('name').setDescription('Item name.').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('price').setDescription('Price.').setRequired(true).setMinValue(0),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Description.').setMaxLength(300),
        )
        .addRoleOption((o) =>
          o.setName('role').setDescription('Grant this role on purchase (kind=role).'),
        )
        .addIntegerOption((o) =>
          o.setName('stock').setDescription('Limited stock; omit for unlimited.').setMinValue(0),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a shop item (requires Manage Guild).')
        .addStringOption((o) => o.setName('id').setDescription('Item ID.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    if (['add', 'remove'].includes(sub)) {
      const perms = interaction.memberPermissions;
      if (!perms?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: 'You need Manage Guild for that.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);

      if (sub === 'list') {
        const { items } = await api.listShop(interaction.guildId);
        if (items.length === 0) {
          await interaction.reply({ content: 'The shop is empty.', flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Shop — ${cfg.currencyName}`)
          .setColor(0xfee75c)
          .setDescription(
            items
              .map((i) => {
                const stock = i.stock === null ? '' : ` · stock: ${i.stock}`;
                const role = i.kind === 'role' && i.roleId ? ` · role <@&${i.roleId}>` : '';
                return `**${i.name}** — ${cfg.currencySymbol} ${i.price.toLocaleString()}${stock}${role}\n${i.description ?? ''}`;
              })
              .join('\n\n'),
          );
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      }

      if (sub === 'buy') {
        const name = interaction.options.getString('name', true);
        const { items } = await api.listShop(interaction.guildId);
        const item = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
        if (!item) {
          await interaction.reply({ content: `No item named "${name}".`, flags: MessageFlags.Ephemeral });
          return;
        }
        const result = await api.buyShopItem(interaction.guildId, item.id, interaction.user.id);

        if (item.kind === 'role' && item.roleId && interaction.member instanceof GuildMember) {
          await interaction.member.roles.add(item.roleId, `Shop purchase: ${item.name}`).catch(() => {});
        }

        await interaction.reply({
          content: `🛍️ Bought **${item.name}** for ${cfg.currencySymbol} ${item.price.toLocaleString()}. Balance: ${result.balance.amount.toLocaleString()} ${cfg.currencyName}.`,
        });
        return;
      }

      if (sub === 'add') {
        const name = interaction.options.getString('name', true);
        const price = interaction.options.getInteger('price', true);
        const description = interaction.options.getString('description') ?? undefined;
        const role = interaction.options.getRole('role');
        const stock = interaction.options.getInteger('stock');
        const item = await api.createShopItem(interaction.guildId, {
          name,
          price,
          ...(description ? { description } : {}),
          kind: role ? 'role' : 'virtual',
          ...(role ? { roleId: role.id } : {}),
          ...(stock !== null ? { stock } : {}),
        });
        await interaction.reply({
          content: `✅ Added **${item.name}** — ${cfg.currencySymbol} ${item.price.toLocaleString()} (\`${item.id}\`).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteShopItem(interaction.guildId, id);
        await interaction.reply({ content: `🗑️ Removed \`${id}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
