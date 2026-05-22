import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const gift: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Send an item from your inventory to another user.')
    .setContexts(0)
    .addUserOption((o) =>
      o.setName('user').setDescription('Recipient.').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('item').setDescription('Item slug.').setRequired(true).setMaxLength(48),
    )
    .addIntegerOption((o) =>
      o.setName('quantity').setDescription('How many to send.').setMinValue(1).setMaxValue(1000),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const recipient = interaction.options.getUser('user', true);
    const slug = interaction.options.getString('item', true).toLowerCase();
    const quantity = interaction.options.getInteger('quantity') ?? 1;

    if (recipient.bot) {
      await interaction.reply({
        content: 'You cannot gift items to bots.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (recipient.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot gift yourself.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      // We resolve the slug client-side from the sender's own inventory so we
      // can deliver a clearer error than "item not found" if they don't
      // actually own it. The /transfer endpoint re-validates anyway.
      const { entries } = await api.listInventoryExt(
        interaction.guildId,
        interaction.user.id,
      );
      const owned = entries.find((e) => e.item?.slug === slug && e.quantity > 0);
      if (!owned || !owned.item) {
        await interaction.reply({
          content: `You don't own any \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (owned.quantity < quantity) {
        await interaction.reply({
          content: `You only own ${owned.quantity} × ${owned.item.name}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await api.giftItem(interaction.guildId, {
        fromUserId: interaction.user.id,
        toUserId: recipient.id,
        itemId: owned.item.id,
        quantity,
      });
      await interaction.reply({
        content: `Sent ×${quantity} **${owned.item.name}** to ${recipient}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
