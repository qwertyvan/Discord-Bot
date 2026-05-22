import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { invalidateAutoReactionCache } from '../../util/auto-reaction-cache.js';

const MAX_EMOJIS = 3;

function parseEmojiList(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const autoReaction: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('auto-reaction')
    .setDescription('Manage automatic emoji reactions to messages matching a pattern.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a new auto-reaction rule.')
        .addStringOption((o) =>
          o
            .setName('pattern')
            .setDescription('Keyword or regex to match in message content.')
            .setRequired(true)
            .setMaxLength(200),
        )
        .addStringOption((o) =>
          o
            .setName('emojis')
            .setDescription('Comma-separated emoji list (max 3). Unicode or <:name:id>.')
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Restrict the rule to one channel (omit for any channel).')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            ),
        )
        .addBooleanOption((o) =>
          o.setName('regex').setDescription('Treat the pattern as a regular expression.'),
        )
        .addBooleanOption((o) =>
          o
            .setName('case_sensitive')
            .setDescription('Match the pattern with case sensitivity.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete an auto-reaction rule by ID.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Rule ID (from /auto-reaction list).').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('List all auto-reaction rules in this guild.'),
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable or disable a rule.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Rule ID (from /auto-reaction list).').setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add') {
        const pattern = interaction.options.getString('pattern', true);
        const emojisRaw = interaction.options.getString('emojis', true);
        const channel = interaction.options.getChannel('channel');
        const isRegex = interaction.options.getBoolean('regex') ?? false;
        const caseSensitive = interaction.options.getBoolean('case_sensitive') ?? false;
        const emojis = parseEmojiList(emojisRaw);
        if (emojis.length === 0) {
          await interaction.reply({
            content: 'Provide at least one emoji.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (emojis.length > MAX_EMOJIS) {
          await interaction.reply({
            content: `At most ${MAX_EMOJIS} emojis per rule.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (isRegex) {
          try {
            new RegExp(pattern);
          } catch {
            await interaction.reply({
              content: 'Invalid regular expression.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        }
        const created = await api.createAutoReactionRule(interaction.guildId, {
          pattern,
          emojis,
          isRegex,
          caseSensitive,
          enabled: true,
          createdBy: interaction.user.id,
          ...(channel ? { channelId: channel.id } : {}),
        });
        invalidateAutoReactionCache(interaction.guildId);
        const scope = created.channelId ? `<#${created.channelId}>` : 'any channel';
        await interaction.reply({
          content: `✅ Auto-reaction added (\`${created.id}\`). ${scope} • ${emojis.join(' ')}`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteAutoReactionRule(interaction.guildId, id);
        invalidateAutoReactionCache(interaction.guildId);
        await interaction.reply({
          content: '🗑️ Rule removed.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { rules } = await api.listAutoReactionRules(interaction.guildId);
        if (rules.length === 0) {
          await interaction.reply({
            content: 'No auto-reaction rules configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = rules.map((r) => {
          const scope = r.channelId ? `<#${r.channelId}>` : 'any';
          const flags: string[] = [];
          if (r.isRegex) flags.push('regex');
          if (r.caseSensitive) flags.push('case');
          if (!r.enabled) flags.push('disabled');
          const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
          return `• \`${r.id}\` ${scope}${flagStr} — \`${r.pattern}\` → ${r.emojis.join(' ')}`;
        });
        await interaction.reply({
          content: lines.join('\n').slice(0, 2000),
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'toggle') {
        const id = interaction.options.getString('id', true);
        const { rules } = await api.listAutoReactionRules(interaction.guildId);
        const current = rules.find((r) => r.id === id);
        if (!current) {
          await interaction.reply({
            content: 'Rule not found.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const updated = await api.updateAutoReactionRule(interaction.guildId, id, {
          enabled: !current.enabled,
        });
        invalidateAutoReactionCache(interaction.guildId);
        await interaction.reply({
          content: `🔁 Rule ${updated.enabled ? 'enabled' : 'disabled'}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
