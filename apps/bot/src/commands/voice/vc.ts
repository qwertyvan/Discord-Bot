import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { noteVoiceClaimMutation } from '../../events/voice-state.js';
import { cancelPendingRelease } from '../../util/voice-claim-state.js';

/**
 * /vc claim                 — claim the current voice channel
 * /vc unclaim               — release the active claim
 * /vc rename <name>         — owner-only rename
 * /vc limit <n>             — owner-only set user limit (0 = unlimited)
 * /vc kick <user>           — owner-only kick from the channel
 * /vc lock                  — owner-only deny @everyone Connect
 * /vc unlock                — owner-only restore @everyone Connect
 * /vc info                  — show the claim status of the current channel
 * /vc admin enable <bool>   — ManageGuild
 * /vc admin mode <all|listed> — ManageGuild
 * /vc admin add <channel>   — ManageChannels
 * /vc admin remove <channel> — ManageChannels
 * /vc admin list            — list claimable channels + active claims
 */
export const vc: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('vc')
    .setDescription('Claim ownership of your voice channel.')
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('claim').setDescription('Claim ownership of your current voice channel.'),
    )
    .addSubcommand((s) =>
      s.setName('unclaim').setDescription('Release your claim on this voice channel.'),
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename your claimed voice channel.')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('New channel name (max 100 chars).')
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('limit')
        .setDescription('Set the user limit on your claimed channel.')
        .addIntegerOption((o) =>
          o
            .setName('n')
            .setDescription('User limit (0 = unlimited, max 99).')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('kick')
        .setDescription('Disconnect a user from your claimed channel.')
        .addUserOption((o) => o.setName('user').setDescription('User to kick.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('lock').setDescription('Lock your channel (@everyone cannot Connect).'),
    )
    .addSubcommand((s) =>
      s.setName('unlock').setDescription('Unlock your channel (@everyone can Connect).'),
    )
    .addSubcommand((s) =>
      s.setName('info').setDescription('Show the claim status of your current voice channel.'),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Voice-claim administration.')
        .addSubcommand((s) =>
          s
            .setName('enable')
            .setDescription('Enable or disable voice claiming server-wide.')
            .addBooleanOption((o) =>
              o.setName('value').setDescription('On or off.').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('mode')
            .setDescription('Switch between all-voice and curated-list claiming.')
            .addStringOption((o) =>
              o
                .setName('value')
                .setDescription('"all" or "listed".')
                .setRequired(true)
                .addChoices(
                  { name: 'all (any voice channel)', value: 'all' },
                  { name: 'listed (only allow-listed channels)', value: 'listed' },
                ),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a voice channel to the claimable allow-list.')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Voice channel to make claimable.')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a voice channel from the claimable allow-list.')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Voice channel to remove.')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName('list').setDescription('Show the claim config + claimable channels.'),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    try {
      if (group === 'admin') {
        await handleAdmin(interaction, sub);
        return;
      }

      switch (sub) {
        case 'claim':
          await handleClaim(interaction);
          return;
        case 'unclaim':
          await handleUnclaim(interaction);
          return;
        case 'rename':
          await handleRename(interaction);
          return;
        case 'limit':
          await handleLimit(interaction);
          return;
        case 'kick':
          await handleKick(interaction);
          return;
        case 'lock':
          await handleLock(interaction, true);
          return;
        case 'unlock':
          await handleLock(interaction, false);
          return;
        case 'info':
          await handleInfo(interaction);
          return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Command failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => undefined);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────

function memberVoiceChannel(interaction: ChatInputCommandInteraction): VoiceBasedChannel | null {
  const member = interaction.member as GuildMember | null;
  return member?.voice.channel ?? null;
}

async function ensureClaimingEnabled(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const cfg = await api.getVoiceClaimConfig(interaction.guildId!);
  if (!cfg.enabled) {
    await interaction.reply({
      content: 'Voice claiming is not enabled on this server.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

async function isChannelClaimable(guildId: string, channelId: string): Promise<boolean> {
  const cfg = await api.getVoiceClaimConfig(guildId);
  if (!cfg.enabled) return false;
  if (cfg.mode === 'all') return true;
  const { channels } = await api.listVoiceClaimable(guildId);
  return channels.some((c) => c.channelId === channelId);
}

// ─── User-facing handlers ──────────────────────────────────────────────

async function handleClaim(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureClaimingEnabled(interaction))) return;
  const channel = memberVoiceChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: 'Join a voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await isChannelClaimable(interaction.guildId!, channel.id))) {
    await interaction.reply({
      content: 'This channel is not in the claimable list.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Look at existing claims to see if this channel is already owned by someone
  // who's still present.
  const { claims } = await api.listVoiceClaims(interaction.guildId!);
  const existing = claims.find((c) => c.channelId === channel.id);
  if (existing) {
    const ownerStillHere = channel.members.has(existing.ownerId);
    if (ownerStillHere && existing.ownerId !== interaction.user.id) {
      await interaction.reply({
        content: `<@${existing.ownerId}> already owns this channel.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
  }

  await api.createVoiceClaim(interaction.guildId!, {
    channelId: channel.id,
    ownerId: interaction.user.id,
  });
  noteVoiceClaimMutation(interaction.guildId!, channel.id);
  cancelPendingRelease(interaction.guildId!, channel.id);
  await interaction.reply({
    content: `🎙️ You now own <#${channel.id}>. Use \`/vc rename\`, \`/vc limit\`, \`/vc kick\`, \`/vc lock\`, \`/vc unlock\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUnclaim(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = memberVoiceChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: 'Join your claimed voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const owner = await currentOwner(interaction.guildId!, channel.id);
  if (owner !== interaction.user.id) {
    await interaction.reply({
      content: 'You do not own this channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.deleteVoiceClaim(interaction.guildId!, channel.id);
  noteVoiceClaimMutation(interaction.guildId!, channel.id);
  cancelPendingRelease(interaction.guildId!, channel.id);
  await interaction.reply({
    content: `🔓 Released your claim on <#${channel.id}>.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRename(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await ownerOnlyChannel(interaction);
  if (!channel) return;
  const name = interaction.options.getString('name', true);
  await channel.setName(name, `vc rename by ${interaction.user.tag}`);
  await interaction.reply({
    content: `✏️ Renamed to \`${name}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLimit(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await ownerOnlyChannel(interaction);
  if (!channel) return;
  const n = interaction.options.getInteger('n', true);
  if (channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: 'User limit only applies to regular voice channels.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await channel.setUserLimit(n, `vc limit by ${interaction.user.tag}`);
  await interaction.reply({
    content: n === 0 ? '🔢 Limit cleared (unlimited).' : `🔢 Limit set to ${n}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = await ownerOnlyChannel(interaction);
  if (!channel) return;
  const user = interaction.options.getUser('user', true);
  const target = channel.members.get(user.id);
  if (!target) {
    await interaction.reply({
      content: 'That user is not in your channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (target.id === interaction.user.id) {
    await interaction.reply({
      content: 'You cannot kick yourself. Use `/vc unclaim` instead.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    await target.voice.disconnect(`vc kick by ${interaction.user.tag}`);
    await interaction.reply({
      content: `👢 Disconnected <@${target.id}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  } catch {
    await interaction.reply({
      content: 'Failed to disconnect that user (missing permission?).',
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleLock(interaction: ChatInputCommandInteraction, lock: boolean): Promise<void> {
  const channel = await ownerOnlyChannel(interaction);
  if (!channel) return;
  if (!('permissionOverwrites' in channel)) {
    await interaction.reply({
      content: 'This channel does not support permission overwrites.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const everyone = interaction.guild!.roles.everyone;
  try {
    await channel.permissionOverwrites.edit(
      everyone,
      { Connect: lock ? false : null },
      { reason: `vc ${lock ? 'lock' : 'unlock'} by ${interaction.user.tag}` },
    );
    await api.updateVoiceClaim(interaction.guildId!, channel.id, {
      lockedAt: lock ? new Date().toISOString() : null,
    });
    noteVoiceClaimMutation(interaction.guildId!, channel.id);
    await interaction.reply({
      content: lock ? `🔒 Locked <#${channel.id}>.` : `🔓 Unlocked <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    await interaction.reply({
      content: 'Failed to update channel permissions.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = memberVoiceChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: 'Join a voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { claims } = await api.listVoiceClaims(interaction.guildId!);
  const claim = claims.find((c) => c.channelId === channel.id);
  if (!claim) {
    await interaction.reply({
      content: `<#${channel.id}> is unclaimed.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('Voice claim')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'Owner', value: `<@${claim.ownerId}>`, inline: true },
      { name: 'Locked', value: claim.lockedAt ? 'yes' : 'no', inline: true },
      {
        name: 'Claimed at',
        value: `<t:${Math.floor(new Date(claim.claimedAt).getTime() / 1000)}:R>`,
      },
    );
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

// Returns the caller's voice channel iff the caller is the registered owner of
// the active claim on it. Replies with the appropriate error and returns null
// otherwise.
async function ownerOnlyChannel(
  interaction: ChatInputCommandInteraction,
): Promise<VoiceBasedChannel | null> {
  const channel = memberVoiceChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: 'Join your claimed voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  const owner = await currentOwner(interaction.guildId!, channel.id);
  if (owner !== interaction.user.id) {
    await interaction.reply({
      content: 'Only the current owner can do that. Try `/vc claim` first.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return channel;
}

async function currentOwner(guildId: string, channelId: string): Promise<string | null> {
  const { claims } = await api.listVoiceClaims(guildId);
  return claims.find((c) => c.channelId === channelId)?.ownerId ?? null;
}

// ─── Admin handlers ────────────────────────────────────────────────────

async function handleAdmin(interaction: ChatInputCommandInteraction, sub: string): Promise<void> {
  const member = interaction.member as GuildMember | null;
  const requiredPerm =
    sub === 'add' || sub === 'remove'
      ? PermissionFlagsBits.ManageChannels
      : PermissionFlagsBits.ManageGuild;
  if (!member?.permissions.has(requiredPerm)) {
    const need = sub === 'add' || sub === 'remove' ? 'Manage Channels' : 'Manage Server';
    await interaction.reply({
      content: `You need ${need} to do that.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (sub) {
    case 'enable': {
      const value = interaction.options.getBoolean('value', true);
      await api.upsertVoiceClaimConfig(interaction.guildId!, { enabled: value });
      await interaction.reply({
        content: value ? '✅ Voice claiming enabled.' : '❌ Voice claiming disabled.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case 'mode': {
      const raw = interaction.options.getString('value', true);
      if (raw !== 'all' && raw !== 'listed') {
        await interaction.reply({
          content: 'Mode must be `all` or `listed`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await api.upsertVoiceClaimConfig(interaction.guildId!, { mode: raw });
      await interaction.reply({
        content: `Mode set to \`${raw}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case 'add': {
      const channel = interaction.options.getChannel('channel', true);
      await api.addVoiceClaimable(interaction.guildId!, { channelId: channel.id });
      await interaction.reply({
        content: `➕ <#${channel.id}> is now claimable.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case 'remove': {
      const channel = interaction.options.getChannel('channel', true);
      try {
        await api.removeVoiceClaimable(interaction.guildId!, channel.id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          await interaction.reply({
            content: 'That channel was not claimable.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        throw err;
      }
      await interaction.reply({
        content: `➖ <#${channel.id}> is no longer claimable.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case 'list': {
      const [cfg, claimable, claimsRes] = await Promise.all([
        api.getVoiceClaimConfig(interaction.guildId!),
        api.listVoiceClaimable(interaction.guildId!),
        api.listVoiceClaims(interaction.guildId!),
      ]);
      const claimableLine =
        cfg.mode === 'all'
          ? '_all voice channels_'
          : claimable.channels.length === 0
            ? '_(none configured)_'
            : claimable.channels.map((c) => `<#${c.channelId}>`).join(', ');
      const activeLine =
        claimsRes.claims.length === 0
          ? '_(no active claims)_'
          : claimsRes.claims
              .map((c) => `<#${c.channelId}> → <@${c.ownerId}>${c.lockedAt ? ' (locked)' : ''}`)
              .join('\n');
      const embed = new EmbedBuilder()
        .setTitle('Voice claim configuration')
        .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
        .addFields(
          { name: 'Enabled', value: cfg.enabled ? '✅ on' : '❌ off', inline: true },
          { name: 'Mode', value: cfg.mode, inline: true },
          { name: 'Claimable channels', value: claimableLine },
          { name: 'Active claims', value: activeLine },
        );
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
  }
}
