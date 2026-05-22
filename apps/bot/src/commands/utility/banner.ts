import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

/**
 * /banner — show a user's profile banner.
 *
 * Banners are only present on the full /users/{id} payload, so we force-fetch
 * to populate it. If the user simply has no banner set, we report that
 * cleanly instead of producing a broken embed.
 */
export const banner: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('banner')
    .setDescription("Show a user's profile banner.")
    .addUserOption((o) =>
      o.setName('user').setDescription('The user (defaults to you).'),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const full = await target.fetch(true).catch(() => null);
    if (!full) {
      await interaction.reply({
        content: 'Could not fetch that user.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const url = full.bannerURL({ size: 1024, extension: 'png', forceStatic: false });
    if (!url) {
      await interaction.reply({
        content: `${full.tag} does not have a banner set.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setAuthor({ name: `${full.tag} — banner` })
      .setImage(url)
      .setURL(url)
      .setColor(full.accentColor ?? 0x5865f2);
    await interaction.reply({ embeds: [embed] });
  },
};
