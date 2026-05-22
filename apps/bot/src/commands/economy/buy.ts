import { GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// /buy is the user-facing twin of /shop list — it takes a slug + optional
// quantity and runs the atomic API debit. Role items get granted up front so
// users don't need a separate /use step for them.
export const buy: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the shop.')
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('item')
        .setDescription('Slug of the item (see /shop list).')
        .setRequired(true)
        .setMaxLength(48),
    )
    .addIntegerOption((o) =>
      o
        .setName('quantity')
        .setDescription('How many to buy.')
        .setMinValue(1)
        .setMaxValue(100),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const slug = interaction.options.getString('item', true).toLowerCase();
    const qty = interaction.options.getInteger('quantity') ?? 1;
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const { items } = await api.listShopItems(interaction.guildId);
      const item = items.find((i) => i.slug === slug);
      if (!item) {
        await interaction.reply({
          content: `No item with slug \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const result = await api.buyShopItemExt(
        interaction.guildId,
        item.id,
        interaction.user.id,
        qty,
      );

      // Role items grant immediately on purchase. /use is a no-op for these.
      if (
        item.kind === 'role' &&
        item.roleId &&
        interaction.member instanceof GuildMember
      ) {
        await interaction.member.roles
          .add(item.roleId, `Shop purchase: ${item.name}`)
          .catch(() => {});
      }

      await interaction.reply({
        content: `Bought ×${qty} **${item.name}** for ${cfg.currencySymbol} ${result.cost.toLocaleString()}. Balance: ${result.balance.toLocaleString()} ${cfg.currencyName}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
