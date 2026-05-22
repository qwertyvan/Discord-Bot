import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type APIEmbed,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type { Quote } from '@discord-bot/shared';

function quoteEmbed(q: Quote): APIEmbed {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setDescription(q.content.slice(0, 4000))
    .addFields(
      { name: 'Author', value: `<@${q.authorId}>`, inline: true },
      { name: 'Saved by', value: `<@${q.savedBy}>`, inline: true },
      {
        name: 'When',
        value: `<t:${Math.floor(new Date(q.savedAt).getTime() / 1000)}:R>`,
        inline: true,
      },
    )
    .setFooter({ text: `id: ${q.id}` })
    .setTimestamp(new Date(q.savedAt));
  if (q.attachmentUrl) embed.setImage(q.attachmentUrl);
  return embed.toJSON();
}

export const quote: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Saved quotes.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('random')
        .setDescription('Show a random saved quote.')
        .addUserOption((o) =>
          o.setName('author').setDescription('Limit to quotes by this user.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Search saved quotes by text.')
        .addStringOption((o) =>
          o
            .setName('query')
            .setDescription('Search term (case-insensitive substring).')
            .setRequired(true)
            .setMaxLength(200),
        )
        .addUserOption((o) =>
          o.setName('author').setDescription('Limit to quotes by this user.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Show a specific quote by id.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Quote id (uuid).').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list-mine').setDescription('List quotes you have saved.'),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('config')
        .setDescription('Configure the quote board (ManageGuild).')
        .addSubcommand((s) =>
          s
            .setName('channel')
            .setDescription('Set the channel where the weekly digest is posted.')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Digest channel (omit to clear).')
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('permission')
            .setDescription('Who can save quotes?')
            .addStringOption((o) =>
              o
                .setName('mode')
                .setDescription('everyone | trusted-role | mods')
                .setRequired(true)
                .addChoices(
                  { name: 'everyone', value: 'everyone' },
                  { name: 'trusted-role', value: 'trusted-role' },
                  { name: 'mods', value: 'mods' },
                ),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role for trusted-role mode.'),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('weekly-digest')
            .setDescription('Toggle the weekly top-quotes digest.')
            .addBooleanOption((o) =>
              o.setName('enabled').setDescription('On or off.').setRequired(true),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'config') {
        // Permission gate handled here at runtime since the same /quote is
        // available to everyone for the read-only subcommands.
        const member = interaction.member;
        const canManage =
          member &&
          typeof member.permissions !== 'string' &&
          member.permissions.has(PermissionFlagsBits.ManageGuild);
        if (!canManage) {
          await interaction.reply({
            content: 'You need Manage Server to change quote config.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'channel') {
          const channel = interaction.options.getChannel('channel');
          await api.upsertQuoteConfig(interaction.guildId, {
            channelId: channel ? channel.id : null,
          });
          await interaction.reply({
            content: channel
              ? `📰 Weekly digest channel set to <#${channel.id}>.`
              : '📰 Weekly digest channel cleared.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'permission') {
          const mode = interaction.options.getString('mode', true) as
            | 'everyone'
            | 'trusted-role'
            | 'mods';
          const role = interaction.options.getRole('role');
          await api.upsertQuoteConfig(interaction.guildId, {
            savePermission: mode,
            ...(role ? { trustedRoleId: role.id } : mode !== 'trusted-role' ? { trustedRoleId: null } : {}),
          });
          await interaction.reply({
            content: `🔒 Save permission set to **${mode}**${
              role && mode === 'trusted-role' ? ` (role <@&${role.id}>)` : ''
            }.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'weekly-digest') {
          const enabled = interaction.options.getBoolean('enabled', true);
          await api.upsertQuoteConfig(interaction.guildId, { weeklyDigest: enabled });
          await interaction.reply({
            content: enabled
              ? '🗓️ Weekly digest enabled. Posts Sundays at 18:00 UTC.'
              : '🗓️ Weekly digest disabled.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        return;
      }

      if (sub === 'random') {
        const author = interaction.options.getUser('author');
        try {
          const q = await api.getRandomQuote(
            interaction.guildId,
            author ? author.id : undefined,
          );
          await interaction.reply({ embeds: [quoteEmbed(q)] });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            await interaction.reply({
              content: 'No saved quotes match.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          throw err;
        }
        return;
      }

      if (sub === 'search') {
        const query = interaction.options.getString('query', true);
        const author = interaction.options.getUser('author');
        const result = await api.listQuotes(interaction.guildId, {
          search: query,
          ...(author ? { authorId: author.id } : {}),
          limit: 10,
        });
        if (result.quotes.length === 0) {
          await interaction.reply({
            content: 'No quotes matched.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = result.quotes.map(
          (q) =>
            `\`${q.id.slice(0, 8)}\` <@${q.authorId}>: ${q.content
              .replace(/\n/g, ' ')
              .slice(0, 120)}`,
        );
        await interaction.reply({
          content: `Found ${result.total} quote${result.total === 1 ? '' : 's'}:\n${lines.join(
            '\n',
          )}`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (sub === 'show') {
        const id = interaction.options.getString('id', true);
        const q = await api.getQuote(interaction.guildId, id);
        await interaction.reply({ embeds: [quoteEmbed(q)] });
        return;
      }

      if (sub === 'list-mine') {
        const result = await api.listQuotes(interaction.guildId, {
          savedBy: interaction.user.id,
          limit: 10,
        });
        if (result.quotes.length === 0) {
          await interaction.reply({
            content: 'You haven\'t saved any quotes yet.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = result.quotes.map(
          (q) =>
            `\`${q.id.slice(0, 8)}\` <@${q.authorId}>: ${q.content
              .replace(/\n/g, ' ')
              .slice(0, 120)}`,
        );
        await interaction.reply({
          content: `You've saved ${result.total} quote${result.total === 1 ? '' : 's'} (showing latest 10):\n${lines.join('\n')}`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
