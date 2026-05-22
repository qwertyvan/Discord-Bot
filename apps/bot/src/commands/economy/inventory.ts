import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const inventory: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Show your inventory.')
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Whose inventory to show.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user') ?? interaction.user;
    try {
      const { entries } = await api.listInventoryExt(interaction.guildId, target.id);
      const owned = entries.filter((e) => e.quantity > 0);
      if (owned.length === 0) {
        await interaction.reply({
          content: `${target}'s inventory is empty.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
        .setTitle('Inventory')
        .setColor(0xfee75c)
        .setDescription(
          owned
            .map((e) => {
              const name = e.item?.name ?? '(unknown item)';
              const slug = e.item?.slug ? ` \`${e.item.slug}\`` : '';
              return `- **${name}**${slug} ×${e.quantity}`;
            })
            .join('\n'),
        );
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
