import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { request } from 'undici';
import type { SlashCommand } from '../../command.js';

const OG_PATTERN = /<meta\s+(?:property|name)="og:([^"]+)"\s+content="([^"]+)"/gi;
const TITLE_PATTERN = /<title[^>]*>([^<]+)<\/title>/i;
const MAX_BYTES = 256 * 1024;

interface PreviewInfo {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

async function fetchPreview(url: string): Promise<PreviewInfo | null> {
  const res = await request(url, {
    method: 'GET',
    headers: { accept: 'text/html', 'user-agent': 'DiscordBot/0.11 (+link preview)' },
  });
  const ct = String(res.headers['content-type'] ?? '');
  if (!ct.includes('text/html')) return null;

  // Read up to MAX_BYTES, then bail — we only need the <head>.
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) {
    chunks.push(chunk as Buffer);
    total += (chunk as Buffer).length;
    if (total >= MAX_BYTES) break;
  }
  res.body.destroy();
  const html = Buffer.concat(chunks).toString('utf8');

  const info: PreviewInfo = {};
  let m: RegExpExecArray | null;
  while ((m = OG_PATTERN.exec(html))) {
    const key = m[1];
    const value = m[2];
    if (!key || !value) continue;
    if (key === 'title') info.title = value;
    else if (key === 'description') info.description = value;
    else if (key === 'image') info.image = value;
    else if (key === 'site_name') info.siteName = value;
  }
  if (!info.title) {
    const t = TITLE_PATTERN.exec(html);
    if (t) info.title = t[1]!.trim();
  }
  return info;
}

export const preview: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('preview')
    .setDescription('Unfurl a URL and show its title, description, and image.')
    .addStringOption((o) =>
      o.setName('url').setDescription('URL to unfurl.').setRequired(true).setMaxLength(2000),
    ),
  async execute(interaction) {
    const url = interaction.options.getString('url', true).trim();
    if (!/^https?:\/\//i.test(url)) {
      await interaction.reply({
        content: 'URL must start with http:// or https://.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    try {
      const info = await fetchPreview(url);
      if (!info || (!info.title && !info.description && !info.image)) {
        await interaction.editReply('Could not extract a preview.');
        return;
      }
      const embed = new EmbedBuilder()
        .setURL(url)
        .setColor(0x5865f2)
        .setTitle((info.title ?? url).slice(0, 256));
      if (info.description) embed.setDescription(info.description.slice(0, 4096));
      if (info.image) embed.setImage(info.image);
      if (info.siteName) embed.setFooter({ text: info.siteName });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply(`Failed to fetch: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  },
};
