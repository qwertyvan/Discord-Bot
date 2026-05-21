import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
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
      const { entries } = await api.listInventory(interaction.guildId, target.id);
      if (entries.length === 0) {
        await interaction.reply({ content: `${target}'s inventory is empty.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const counts = new Map<string, { name: string; quantity: number }>();
      for (const e of entries) {
        const name = e.item?.name ?? '(unknown item)';
        const prev = counts.get(name);
        counts.set(name, { name, quantity: (prev?.quantity ?? 0) + e.quantity });
      }
      const embed = new EmbedBuilder()
        .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
        .setTitle('Inventory')
        .setColor(0xfee75c)
        .setDescription([...counts.values()].map((c) => `• **${c.name}** ×${c.quantity}`).join('\n'));
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
