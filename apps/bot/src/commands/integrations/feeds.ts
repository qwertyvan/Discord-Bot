import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { FeedKindSchema, type FeedKind } from '@discord-bot/shared';

const KIND_CHOICES: Array<{ name: string; value: FeedKind }> = [
  { name: 'YouTube', value: 'youtube' },
  { name: 'Reddit', value: 'reddit' },
  { name: 'Bluesky', value: 'bluesky' },
  { name: 'Mastodon', value: 'mastodon' },
];

const IDENTIFIER_HELP: Record<FeedKind, string> = {
  youtube: 'channel id (UCxxxx…)',
  reddit: 'subreddit name (e.g. typescript)',
  bluesky: 'handle (e.g. alice.bsky.social)',
  mastodon: '@user@instance (e.g. @mastodon@mastodon.social)',
};

export const feeds: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('feeds')
    .setDescription('Manage public feed subscriptions (YouTube, Reddit, Bluesky, Mastodon).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Subscribe a channel to a public feed.')
        .addStringOption((o) =>
          o
            .setName('kind')
            .setDescription('Feed source.')
            .setRequired(true)
            .addChoices(...KIND_CHOICES),
        )
        .addStringOption((o) =>
          o
            .setName('identifier')
            .setDescription('Source identifier — depends on kind.')
            .setRequired(true)
            .setMaxLength(200),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post in (defaults to the current channel).')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription(
              'Optional message template. Vars: {title} {url} {author} {identifier} {kind}.',
            )
            .setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a feed subscription.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Feed subscription ID.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List feed subscriptions.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const rawKind = interaction.options.getString('kind', true);
        const parsedKind = FeedKindSchema.safeParse(rawKind);
        if (!parsedKind.success) {
          await interaction.reply({
            content: 'Unknown feed kind.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const kind = parsedKind.data;
        const identifier = normalizeIdentifier(
          kind,
          interaction.options.getString('identifier', true),
        );
        const channelOpt = interaction.options.getChannel('channel');
        const channelId =
          channelOpt?.id ??
          (interaction.channel && interaction.channel.type === ChannelType.GuildText
            ? interaction.channel.id
            : null);
        if (!channelId) {
          await interaction.reply({
            content: 'Pick a text channel to post in.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const template = interaction.options.getString('template') ?? undefined;

        const created = await api.createFeed(interaction.guildId, {
          kind,
          identifier,
          channelId,
          ...(template ? { template } : {}),
        });
        await interaction.reply({
          content: `✅ Subscribed **${kind}** \`${created.identifier}\` → <#${created.channelId}>. ID: \`${created.id}\``,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteFeed(interaction.guildId, id);
        await interaction.reply({
          content: `🗑️ Removed feed \`${id}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { feeds } = await api.listFeeds(interaction.guildId);
        if (feeds.length === 0) {
          const help = KIND_CHOICES.map((c) => `**${c.name}** — ${IDENTIFIER_HELP[c.value]}`).join(
            '\n',
          );
          await interaction.reply({
            content: `No feed subscriptions yet.\n\nUse \`/feeds add\` with one of:\n${help}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Feed subscriptions')
          .setColor(0x5865f2)
          .setFooter({ text: `${feeds.length} subscribed` });
        for (const f of feeds.slice(0, 20)) {
          const created = new Date(f.createdAt);
          embed.addFields({
            name: `${f.kind} · ${f.identifier}`.slice(0, 256),
            value: [
              `<#${f.channelId}> · ${f.enabled ? 'enabled' : 'disabled'}`,
              `added ${time(created, TimestampStyles.RelativeTime)}`,
              `\`${f.id}\``,
            ].join('\n'),
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};

function normalizeIdentifier(kind: FeedKind, raw: string): string {
  const trimmed = raw.trim();
  if (kind === 'reddit') {
    // Strip leading "r/" or "/r/".
    return trimmed.replace(/^\/?r\//i, '');
  }
  if (kind === 'mastodon') {
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }
  return trimmed;
}
