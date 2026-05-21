import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { request } from 'undici';
import { env } from '../../env.js';
import type { SlashCommand } from '../../command.js';

export const shorten: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('shorten')
    .setDescription('Create a short link served by this bot.')
    .setContexts(0)
    .addStringOption((o) =>
      o.setName('url').setDescription('Target URL.').setRequired(true).setMaxLength(2000),
    )
    .addStringOption((o) =>
      o
        .setName('slug')
        .setDescription('Optional custom slug (letters, digits, _, -; 3-32 chars).')
        .setMaxLength(32),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const url = interaction.options.getString('url', true).trim();
    const slug = interaction.options.getString('slug')?.trim();

    if (!/^https?:\/\//i.test(url)) {
      await interaction.reply({
        content: 'URL must start with http:// or https://.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const res = await request(`${env.API_BASE_URL}/short-links`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.BOT_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        target: url,
        createdBy: interaction.user.id,
        guildId: interaction.guildId,
        ...(slug ? { slug } : {}),
      }),
    });
    if (res.statusCode === 409) {
      await interaction.reply({
        content: 'That slug is already taken — try another or omit the slug.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      await interaction.reply({
        content: `Failed: ${text}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const json = (await res.body.json()) as { slug: string };
    const shortUrl = `${env.API_BASE_URL.replace(/\/$/, '')}/s/${json.slug}`;
    await interaction.reply({
      content: `🔗 ${shortUrl}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
