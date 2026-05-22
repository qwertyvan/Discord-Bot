import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type { ShopItemKindExt } from '@discord-bot/shared';

const KIND_CHOICES: { name: string; value: ShopItemKindExt }[] = [
  { name: 'Consumable (flavour text on /use)', value: 'consumable' },
  { name: 'Role (grants a role on /use)', value: 'role' },
  { name: 'Badge', value: 'badge' },
  { name: 'Cosmetic', value: 'cosmetic' },
];

export const shop: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse and manage the server shop.')
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('list').setDescription('Show every item on sale.'),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a shop item (Manage Guild).')
        .addStringOption((o) =>
          o
            .setName('slug')
            .setDescription('Stable identifier (kebab-case, used by /buy).')
            .setRequired(true)
            .setMaxLength(48),
        )
        .addStringOption((o) =>
          o.setName('name').setDescription('Display name.').setRequired(true).setMaxLength(120),
        )
        .addIntegerOption((o) =>
          o
            .setName('price')
            .setDescription('Cost in the guild currency.')
            .setRequired(true)
            .setMinValue(0),
        )
        .addStringOption((o) =>
          o
            .setName('kind')
            .setDescription('What this item is.')
            .addChoices(...KIND_CHOICES.map((c) => ({ name: c.name, value: c.value }))),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Catalogue blurb.').setMaxLength(500),
        )
        .addRoleOption((o) =>
          o.setName('role').setDescription('Role granted on /use (required for kind=role).'),
        )
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Flavour message shown on /use.')
            .setMaxLength(2000),
        )
        .addIntegerOption((o) =>
          o.setName('stock').setDescription('Limited stock; omit for unlimited.').setMinValue(0),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit a shop item (Manage Guild).')
        .addStringOption((o) =>
          o.setName('slug').setDescription('Slug of the item to edit.').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('name').setDescription('New name.').setMaxLength(120),
        )
        .addIntegerOption((o) =>
          o.setName('price').setDescription('New price.').setMinValue(0),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('New description.').setMaxLength(500),
        )
        .addStringOption((o) =>
          o.setName('message').setDescription('New /use message.').setMaxLength(2000),
        )
        .addIntegerOption((o) =>
          o.setName('stock').setDescription('New stock; 0 = sold out.').setMinValue(0),
        )
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Whether the item appears in /shop.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a shop item (Manage Guild).')
        .addStringOption((o) =>
          o.setName('slug').setDescription('Slug of the item to remove.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    if (['add', 'edit', 'remove'].includes(sub)) {
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
        const { items } = await api.listShopItems(interaction.guildId);
        if (items.length === 0) {
          await interaction.reply({
            content: 'The shop is empty.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Shop — ${cfg.currencyName}`)
          .setColor(0xfee75c)
          .setDescription(
            items
              .map((i) => {
                const stock = i.stock === null ? '' : ` · stock: ${i.stock}`;
                const role =
                  i.kind === 'role' && i.roleId ? ` · role <@&${i.roleId}>` : '';
                const kind = i.kind === 'consumable' ? '' : ` · ${i.kind}`;
                return `**${i.name}** \`${i.slug}\` — ${cfg.currencySymbol} ${i.priceCents.toLocaleString()}${kind}${stock}${role}\n${i.description ?? ''}`;
              })
              .join('\n\n'),
          );
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      }

      if (sub === 'add') {
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const name = interaction.options.getString('name', true);
        const price = interaction.options.getInteger('price', true);
        const description = interaction.options.getString('description');
        const role = interaction.options.getRole('role');
        const message = interaction.options.getString('message');
        const stock = interaction.options.getInteger('stock');
        const explicitKind = interaction.options.getString('kind') as
          | ShopItemKindExt
          | null;
        const kind: ShopItemKindExt = explicitKind ?? (role ? 'role' : 'consumable');
        if (kind === 'role' && !role) {
          await interaction.reply({
            content: 'kind=role requires the role option.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const item = await api.createShopItemExt(interaction.guildId, {
          slug,
          name,
          priceCents: price,
          kind,
          enabled: true,
          ...(description ? { description } : {}),
          ...(role ? { roleId: role.id } : {}),
          ...(message ? { message } : {}),
          ...(stock !== null ? { stock } : {}),
        });
        await interaction.reply({
          content: `Added **${item.name}** \`${item.slug}\` — ${cfg.currencySymbol} ${item.priceCents.toLocaleString()}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'edit') {
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const { items } = await api.listShopItems(interaction.guildId, {
          includeDisabled: true,
        });
        const existing = items.find((i) => i.slug === slug);
        if (!existing) {
          await interaction.reply({
            content: `No item with slug \`${slug}\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const patch: Parameters<typeof api.updateShopItem>[2] = {};
        const name = interaction.options.getString('name');
        const price = interaction.options.getInteger('price');
        const description = interaction.options.getString('description');
        const message = interaction.options.getString('message');
        const stock = interaction.options.getInteger('stock');
        const enabled = interaction.options.getBoolean('enabled');
        if (name !== null) patch.name = name;
        if (price !== null) patch.priceCents = price;
        if (description !== null) patch.description = description;
        if (message !== null) patch.message = message;
        if (stock !== null) patch.stock = stock;
        if (enabled !== null) patch.enabled = enabled;
        const updated = await api.updateShopItem(interaction.guildId, existing.id, patch);
        await interaction.reply({
          content: `Updated **${updated.name}** \`${updated.slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'remove') {
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const { items } = await api.listShopItems(interaction.guildId, {
          includeDisabled: true,
        });
        const existing = items.find((i) => i.slug === slug);
        if (!existing) {
          await interaction.reply({
            content: `No item with slug \`${slug}\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await api.deleteShopItemExt(interaction.guildId, existing.id);
        await interaction.reply({
          content: `Removed \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
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
