import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { translateText } from '../../integrations/deepl.js';

export const translate: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text into another language.')
    .setContexts(0)
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to translate.').setRequired(true).setMaxLength(2000),
    )
    .addStringOption((o) =>
      o
        .setName('to')
        .setDescription('Target language code (e.g. EN, DE, JA, FR).')
        .setRequired(true)
        .setMaxLength(8),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const text = interaction.options.getString('text', true);
    const target = interaction.options.getString('to', true);

    await interaction.deferReply();
    try {
      const result = await translateText(interaction.guildId, text, target);
      if (!result) {
        await interaction.editReply(
          'No DeepL credentials configured. Ask an admin to set `deepl.api_key` on the Credentials tab.',
        );
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: `${result.detectedSource} → ${target.toUpperCase()}` })
        .setDescription(result.text);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply(
        `Translation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
    void MessageFlags;
  },
};
