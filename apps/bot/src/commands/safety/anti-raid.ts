import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Role,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { clearLockdown, getActiveLockdown, setActiveLockdown } from '../../util/anti-raid-state.js';
import type { UpsertAntiRaidConfigInput } from '@discord-bot/shared';

/**
 * /anti-raid config        — show current
 * /anti-raid set <field>   — edit a field
 * /anti-raid lockdown start [trigger]
 * /anti-raid lockdown end
 *
 * Channel-level /lockdown lives in the moderation group; this command operates
 * on the raid-detection lockdown that the bot uses to gate joins.
 */
export const antiRaid: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('anti-raid')
    .setDescription('Anti-raid and captcha verification controls.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('config').setDescription('Show the current anti-raid configuration.'),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Update an anti-raid setting.')
        .addStringOption((o) =>
          o
            .setName('field')
            .setDescription('Setting to update.')
            .setRequired(true)
            .addChoices(
              { name: 'enabled (true/false)', value: 'enabled' },
              { name: 'joinsPerMinuteThreshold (1–1000)', value: 'joinsPerMinuteThreshold' },
              { name: 'lockdownDurationMin (1–1440)', value: 'lockdownDurationMin' },
              { name: 'captchaRequired (true/false)', value: 'captchaRequired' },
              { name: 'captchaKind (math|image)', value: 'captchaKind' },
              { name: 'riskScoreThreshold (0–100)', value: 'riskScoreThreshold' },
              {
                name: 'unverifiedRoleId (role mention or id, "none" clears)',
                value: 'unverifiedRoleId',
              },
            ),
        )
        .addStringOption((o) =>
          o.setName('value').setDescription('New value.').setRequired(true).setMaxLength(64),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('lockdown')
        .setDescription('Manage the raid-detection lockdown.')
        .addSubcommand((s) =>
          s
            .setName('start')
            .setDescription('Manually start a lockdown.')
            .addStringOption((o) =>
              o
                .setName('note')
                .setDescription('Trigger note shown in the audit log.')
                .setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s.setName('end').setDescription('End the active lockdown immediately.'),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    try {
      if (!group && sub === 'config') {
        await handleConfig(interaction);
        return;
      }
      if (!group && sub === 'set') {
        await handleSet(interaction);
        return;
      }
      if (group === 'lockdown' && sub === 'start') {
        await handleLockdownStart(interaction);
        return;
      }
      if (group === 'lockdown' && sub === 'end') {
        await handleLockdownEnd(interaction);
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Command failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};

async function handleConfig(interaction: Parameters<SlashCommand['execute']>[0]): Promise<void> {
  const guildId = interaction.guildId!;
  const cfg = await api.getAntiRaidConfig(guildId);
  const embed = new EmbedBuilder()
    .setTitle('Anti-raid configuration')
    .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Enabled', value: cfg.enabled ? '✅ on' : '❌ off', inline: true },
      {
        name: 'Joins/min threshold',
        value: String(cfg.joinsPerMinuteThreshold),
        inline: true,
      },
      {
        name: 'Lockdown duration',
        value: `${cfg.lockdownDurationMin} min`,
        inline: true,
      },
      {
        name: 'Captcha',
        value: cfg.captchaRequired ? `✅ ${cfg.captchaKind}` : '❌ off',
        inline: true,
      },
      {
        name: 'Risk threshold',
        value: String(cfg.riskScoreThreshold),
        inline: true,
      },
      {
        name: 'Unverified role',
        value: cfg.unverifiedRoleId ? `<@&${cfg.unverifiedRoleId}>` : '_unset_',
        inline: true,
      },
    );
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleSet(interaction: Parameters<SlashCommand['execute']>[0]): Promise<void> {
  const guildId = interaction.guildId!;
  const field = interaction.options.getString('field', true);
  const value = interaction.options.getString('value', true).trim();

  const patch: UpsertAntiRaidConfigInput = {};

  switch (field) {
    case 'enabled':
    case 'captchaRequired': {
      const b = parseBool(value);
      if (b === null) {
        await interaction.reply({
          content: 'Value must be true or false.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (field === 'enabled') patch.enabled = b;
      else patch.captchaRequired = b;
      break;
    }
    case 'joinsPerMinuteThreshold':
    case 'lockdownDurationMin':
    case 'riskScoreThreshold': {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        await interaction.reply({
          content: 'Value must be a non-negative integer.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (field === 'joinsPerMinuteThreshold') patch.joinsPerMinuteThreshold = n;
      else if (field === 'lockdownDurationMin') patch.lockdownDurationMin = n;
      else patch.riskScoreThreshold = n;
      break;
    }
    case 'captchaKind': {
      if (value !== 'math' && value !== 'image') {
        await interaction.reply({
          content: 'Value must be `math` or `image`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.captchaKind = value;
      break;
    }
    case 'unverifiedRoleId': {
      if (value.toLowerCase() === 'none' || value === '') {
        patch.unverifiedRoleId = null;
        break;
      }
      const roleId = parseRoleRef(value);
      if (!roleId) {
        await interaction.reply({
          content: 'Mention a role or paste its id, or use `none` to clear.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const role: Role | undefined = interaction.guild!.roles.cache.get(roleId);
      if (!role) {
        await interaction.reply({
          content: 'I cannot see that role in this guild.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.unverifiedRoleId = role.id;
      break;
    }
    default:
      await interaction.reply({ content: 'Unknown field.', flags: MessageFlags.Ephemeral });
      return;
  }

  await api.upsertAntiRaidConfig(guildId, patch);
  await interaction.reply({
    content: `✅ Updated **${field}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLockdownStart(
  interaction: Parameters<SlashCommand['execute']>[0],
): Promise<void> {
  const guildId = interaction.guildId!;
  const cfg = await api.getAntiRaidConfig(guildId);
  const note = interaction.options.getString('note') ?? `manual: ${interaction.user.tag}`;
  const ev = await api.startLockdown(guildId, `manual: ${note.slice(0, 48)}`);
  if (!ev.endedAt) {
    setActiveLockdown({
      id: ev.id,
      guildId,
      expiresAt: Date.now() + cfg.lockdownDurationMin * 60_000,
      blocked: 0,
    });
  }
  await interaction.reply({
    content: `🔒 Anti-raid lockdown started (id \`${ev.id.slice(0, 8)}\`, expires in ${cfg.lockdownDurationMin}m).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLockdownEnd(
  interaction: Parameters<SlashCommand['execute']>[0],
): Promise<void> {
  const guildId = interaction.guildId!;
  const active = getActiveLockdown(guildId);
  if (active) {
    await api.endLockdown(guildId, active.id, active.blocked).catch(() => {});
    clearLockdown(guildId);
    await interaction.reply({
      content: `🔓 Lockdown ended (${active.blocked} join${active.blocked === 1 ? '' : 's'} blocked).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // No in-memory state — try to close anything in the DB.
  const { events } = await api.listLockdownEvents(guildId, 1);
  const open = events.find((e) => !e.endedAt);
  if (!open) {
    await interaction.reply({
      content: 'No active lockdown.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.endLockdown(guildId, open.id);
  await interaction.reply({
    content: `🔓 Closed lockdown \`${open.id.slice(0, 8)}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

function parseBool(s: string): boolean | null {
  const v = s.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return null;
}

function parseRoleRef(s: string): string | null {
  const m = s.match(/^<@&(\d{17,20})>$/);
  if (m) return m[1] ?? null;
  if (/^\d{17,20}$/.test(s)) return s;
  return null;
}
