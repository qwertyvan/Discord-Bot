import { GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// /use consumes one of an item. The API decrements the inventory entry and
// returns the flavour message + role to grant; the bot executes the side
// effect (role grant) since the API can't reach the gateway directly.
export const use: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use an item from your inventory.')
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('item')
        .setDescription('Item slug.')
        .setRequired(true)
        .setMaxLength(48),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const slug = interaction.options.getString('item', true).toLowerCase();
    try {
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
      const result = await api.consumeItem(interaction.guildId, {
        userId: interaction.user.id,
        itemId: owned.item.id,
        quantity: 1,
      });

      const lines: string[] = [`You used **${result.item.name}**.`];
      if (result.message) lines.push(result.message);
      if (result.roleGranted && interaction.member instanceof GuildMember) {
        const ok = await interaction.member.roles
          .add(result.roleGranted, `/use ${result.item.slug}`)
          .then(() => true)
          .catch(() => false);
        lines.push(
          ok
            ? `Role <@&${result.roleGranted}> granted.`
            : `Could not grant <@&${result.roleGranted}> — check the bot's role hierarchy.`,
        );
      }
      lines.push(`Remaining: ${result.remaining}.`);

      await interaction.reply({
        content: lines.join('\n'),
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
