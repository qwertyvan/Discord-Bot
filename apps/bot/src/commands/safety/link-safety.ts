import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type {
  LinkDomainKind,
  LinkSafetyAction,
  LinkSafetyMode,
  UpsertLinkSafetyConfigInput,
} from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import {
  getLinkDomains,
  getLinkSafetyConfig,
  invalidateLinkSafetyCache,
} from '../../util/link-safety-cache.js';
import { evaluateUrl } from '../../events/link-safety.js';
import { extractUrls, normalizeDomain } from '../../util/url-extract.js';

const FIELD_CHOICES = [
  { name: 'enabled (true|false)', value: 'enabled' },
  { name: 'mode (allowlist|blocklist)', value: 'mode' },
  { name: 'action (none|delete|warn|mute|kick)', value: 'action' },
  { name: 'muteMinutes (1-40320)', value: 'muteMinutes' },
  { name: 'notifyChannelId (channel or "none")', value: 'notifyChannelId' },
  { name: 'expandShorteners (true|false)', value: 'expandShorteners' },
  { name: 'gsbCheck (true|false)', value: 'gsbCheck' },
] as const;

export const linkSafety: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('link-safety')
    .setDescription('Per-guild link safety configuration (allow/block lists + reputation).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('config').setDescription('Show the current link-safety configuration.'),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Update a link-safety setting.')
        .addStringOption((o) =>
          o
            .setName('field')
            .setDescription('Setting to update.')
            .setRequired(true)
            .addChoices(...FIELD_CHOICES),
        )
        .addStringOption((o) =>
          o.setName('value').setDescription('New value.').setRequired(true).setMaxLength(64),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('allow')
        .setDescription('Manage the per-guild allowlist.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a domain to the allowlist.')
            .addStringOption((o) =>
              o
                .setName('domain')
                .setDescription('Domain (e.g. example.com).')
                .setRequired(true)
                .setMaxLength(255),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a domain from the allowlist.')
            .addStringOption((o) =>
              o.setName('domain').setDescription('Domain.').setRequired(true).setMaxLength(255),
            ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('Show the current allowlist.')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('block')
        .setDescription('Manage the per-guild blocklist.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a domain to the blocklist.')
            .addStringOption((o) =>
              o
                .setName('domain')
                .setDescription('Domain (e.g. spam.example).')
                .setRequired(true)
                .setMaxLength(255),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a domain from the blocklist.')
            .addStringOption((o) =>
              o.setName('domain').setDescription('Domain.').setRequired(true).setMaxLength(255),
            ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('Show the current blocklist.')),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Run a URL through the link-safety pipeline and show the verdict.')
        .addStringOption((o) =>
          o.setName('url').setDescription('URL to test.').setRequired(true).setMaxLength(1024),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    try {
      if (!group && sub === 'config') return handleConfig(interaction);
      if (!group && sub === 'set') return handleSet(interaction);
      if (!group && sub === 'test') return handleTest(interaction);
      if (group === 'allow' || group === 'block') {
        const kind: LinkDomainKind = group === 'allow' ? 'allow' : 'block';
        if (sub === 'add') return handleDomainAdd(interaction, kind);
        if (sub === 'remove') return handleDomainRemove(interaction, kind);
        if (sub === 'list') return handleDomainList(interaction, kind);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Command failed.';
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};

async function handleConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = await api.getLinkSafetyConfig(interaction.guildId!);
  const embed = new EmbedBuilder()
    .setTitle('Link safety configuration')
    .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Enabled', value: cfg.enabled ? '✅ on' : '❌ off', inline: true },
      { name: 'Mode', value: cfg.mode, inline: true },
      { name: 'Action', value: cfg.action, inline: true },
      { name: 'Mute minutes', value: String(cfg.muteMinutes), inline: true },
      {
        name: 'Notify channel',
        value: cfg.notifyChannelId ? `<#${cfg.notifyChannelId}>` : '_unset_',
        inline: true,
      },
      {
        name: 'Expand shorteners',
        value: cfg.expandShorteners ? '✅' : '❌',
        inline: true,
      },
      {
        name: 'Safe Browsing lookup',
        value: cfg.gsbCheck ? '✅' : '❌',
        inline: true,
      },
    );
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const field = interaction.options.getString('field', true);
  const value = interaction.options.getString('value', true).trim();
  const patch: UpsertLinkSafetyConfigInput = {};

  switch (field) {
    case 'enabled':
    case 'expandShorteners':
    case 'gsbCheck': {
      const b = parseBool(value);
      if (b === null) {
        await interaction.reply({
          content: 'Value must be true or false.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (field === 'enabled') patch.enabled = b;
      else if (field === 'expandShorteners') patch.expandShorteners = b;
      else patch.gsbCheck = b;
      break;
    }
    case 'mode': {
      if (value !== 'allowlist' && value !== 'blocklist') {
        await interaction.reply({
          content: 'Mode must be `allowlist` or `blocklist`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.mode = value as LinkSafetyMode;
      break;
    }
    case 'action': {
      if (!['none', 'delete', 'warn', 'mute', 'kick'].includes(value)) {
        await interaction.reply({
          content: 'Action must be one of: none, delete, warn, mute, kick.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.action = value as LinkSafetyAction;
      break;
    }
    case 'muteMinutes': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 40320) {
        await interaction.reply({
          content: 'muteMinutes must be an integer 1-40320.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.muteMinutes = n;
      break;
    }
    case 'notifyChannelId': {
      if (value.toLowerCase() === 'none' || value === '') {
        patch.notifyChannelId = null;
        break;
      }
      const id = parseChannelRef(value);
      if (!id) {
        await interaction.reply({
          content: 'Mention a channel or paste its id, or use `none` to clear.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const channel = interaction.guild!.channels.cache.get(id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Channel must be a text channel I can post in.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.notifyChannelId = channel.id;
      break;
    }
    default:
      await interaction.reply({ content: 'Unknown field.', flags: MessageFlags.Ephemeral });
      return;
  }

  await api.upsertLinkSafetyConfig(guildId, patch);
  invalidateLinkSafetyCache(guildId);
  await interaction.reply({
    content: `✅ Updated **${field}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDomainAdd(
  interaction: ChatInputCommandInteraction,
  kind: LinkDomainKind,
): Promise<void> {
  const guildId = interaction.guildId!;
  const raw = interaction.options.getString('domain', true).trim().toLowerCase();
  const domain = stripDomain(raw);
  if (!isValidDomain(domain)) {
    await interaction.reply({
      content: 'That doesn’t look like a valid domain.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.createLinkDomain(guildId, { domain, kind, addedBy: interaction.user.id });
  invalidateLinkSafetyCache(guildId);
  await interaction.reply({
    content: `✅ Added \`${domain}\` to the **${kind}list**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDomainRemove(
  interaction: ChatInputCommandInteraction,
  kind: LinkDomainKind,
): Promise<void> {
  const guildId = interaction.guildId!;
  const raw = interaction.options.getString('domain', true).trim().toLowerCase();
  const domain = stripDomain(raw);
  const { domains } = await api.listLinkDomains(guildId, kind);
  const match = domains.find((d) => d.domain === domain);
  if (!match) {
    await interaction.reply({
      content: `\`${domain}\` is not on the **${kind}list**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.deleteLinkDomain(guildId, match.id);
  invalidateLinkSafetyCache(guildId);
  await interaction.reply({
    content: `🗑️ Removed \`${domain}\` from the **${kind}list**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDomainList(
  interaction: ChatInputCommandInteraction,
  kind: LinkDomainKind,
): Promise<void> {
  const { domains } = await api.listLinkDomains(interaction.guildId!, kind);
  if (domains.length === 0) {
    await interaction.reply({
      content: `The **${kind}list** is empty.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const body = domains
    .slice(0, 50)
    .map((d) => `• \`${d.domain}\` — <@${d.addedBy}>`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`Link ${kind}list (${domains.length})`)
    .setDescription(body)
    .setColor(kind === 'allow' ? 0x57f287 : 0xed4245);
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleTest(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const raw = interaction.options.getString('url', true).trim();
  const urls = extractUrls(raw);
  const url = urls[0] ?? raw;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = await getLinkSafetyConfig(guildId);
  if (!cfg) {
    await interaction.editReply('Link safety is not configured for this guild.');
    return;
  }
  const { allow, block } = await getLinkDomains(guildId);
  const verdict = await evaluateUrl(cfg, allow, block, url);
  const embed = new EmbedBuilder()
    .setTitle(`Link safety test — ${verdict.decision === 'allow' ? '✅ allow' : '❌ block'}`)
    .setColor(verdict.decision === 'allow' ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Input', value: url.slice(0, 256), inline: false },
      { name: 'Resolved', value: verdict.finalUrl.slice(0, 256), inline: false },
      { name: 'Domain', value: verdict.domain || '_unknown_', inline: true },
      { name: 'Reason', value: verdict.reason, inline: true },
      {
        name: 'Configured action',
        value: verdict.decision === 'block' ? cfg.action : '—',
        inline: true,
      },
    );
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

function parseBool(s: string): boolean | null {
  const v = s.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return null;
}

function parseChannelRef(s: string): string | null {
  const m = s.match(/^<#(\d{17,20})>$/);
  if (m) return m[1] ?? null;
  if (/^\d{17,20}$/.test(s)) return s;
  return null;
}

function stripDomain(raw: string): string {
  // Accept full URLs ("https://www.example.com/x") by normalising them down
  // to the registrable hostname.
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return normalizeDomain(raw);
  }
  let d = raw;
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

function isValidDomain(d: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d);
}
