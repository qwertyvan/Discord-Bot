import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function multiplierPct(mult: number): string {
  // 0.05 → "+5%"
  const pct = mult * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(pct < 1 && pct > 0 ? 1 : 0)}%`;
}

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const target = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const info = await api.getPrestigeInfo(interaction.guildId, target.id);
    if (!info.prestigeEnabled) {
      await interaction.editReply('Prestige is not enabled on this server.');
      return;
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
      .setColor(info.prestige > 0 ? 0xfee75c : 0x5865f2)
      .setTitle(info.prestige > 0 ? `⭐ Prestige P${info.prestige}` : 'No prestige yet')
      .addFields(
        {
          name: 'Current level',
          value: `${info.level} / ${info.maxLevel}`,
          inline: true,
        },
        {
          name: 'XP multiplier',
          value: multiplierPct(info.totalXpMultiplier - 1) + ' total',
          inline: true,
        },
        {
          name: 'Per-prestige bonus',
          value: multiplierPct(info.prestigeMultiplier),
          inline: true,
        },
      );

    if (info.currentTierRoleId) {
      embed.addFields({
        name: 'Current tier role',
        value: `<@&${info.currentTierRoleId}>`,
        inline: true,
      });
    }
    if (info.nextTierRoleId) {
      embed.addFields({
        name: `Next tier role (P${info.prestige + 1})`,
        value: `<@&${info.nextTierRoleId}>`,
        inline: true,
      });
    }

    if (info.canPrestigeNow) {
      embed.setFooter({ text: 'Ready to prestige — use /prestige claim.' });
    } else if (info.prestige >= 10) {
      embed.setFooter({ text: 'Maximum prestige reached (P10).' });
    } else {
      embed.setFooter({
        text: `Reach level ${info.maxLevel} to unlock the next prestige tier.`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to load prestige info.';
    await interaction.editReply(msg);
  }
}

async function handleClaim(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let info;
  try {
    info = await api.getPrestigeInfo(interaction.guildId, interaction.user.id);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to load prestige info.';
    await interaction.editReply(msg);
    return;
  }

  if (!info.prestigeEnabled) {
    await interaction.editReply('Prestige is not enabled on this server.');
    return;
  }
  if (info.prestige >= 10) {
    await interaction.editReply('You have already reached maximum prestige (P10).');
    return;
  }
  if (!info.canPrestigeNow) {
    await interaction.editReply(
      `You need to reach level **${info.maxLevel}** before prestiging (you are level ${info.level}).`,
    );
    return;
  }

  const confirmId = `prestige:confirm:${interaction.user.id}:${Date.now()}`;
  const cancelId = `prestige:cancel:${interaction.user.id}:${Date.now()}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(`Prestige to P${info.prestige + 1}`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Confirm prestige')
    .setDescription(
      [
        `You are about to prestige to **P${info.prestige + 1}**.`,
        '',
        'This will:',
        `• Reset your XP and level to **0**`,
        `• Grant a permanent **⭐ P${info.prestige + 1}** tier`,
        `• Increase your XP multiplier to **${multiplierPct((1 + (info.prestige + 1) * info.prestigeMultiplier) - 1)} total**`,
        info.nextTierRoleId ? `• Grant role <@&${info.nextTierRoleId}>` : null,
        '',
        'This **cannot** be undone.',
      ]
        .filter((v): v is string => v !== null)
        .join('\n'),
    );

  await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
  const reply = await interaction.fetchReply();

  let pressed: ButtonInteraction | null = null;
  try {
    pressed = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) =>
        i.user.id === interaction.user.id &&
        (i.customId === confirmId || i.customId === cancelId),
      time: 30_000,
    });
  } catch {
    await interaction
      .editReply({
        content: '⌛ Prestige confirmation timed out.',
        embeds: [],
        components: [],
      })
      .catch(() => undefined);
    return;
  }

  if (pressed.customId === cancelId) {
    await pressed.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => undefined);
    return;
  }

  await pressed.deferUpdate().catch(() => undefined);

  try {
    const result = await api.prestigeMember(interaction.guildId, interaction.user.id);

    // Grant the role reward (best-effort).
    if (result.grantedRoleId) {
      const member = await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null);
      if (member) {
        await member.roles
          .add(result.grantedRoleId, `Prestige reward P${result.prestige}`)
          .catch(() => undefined);
      }
    }

    const doneEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`⭐ Prestige P${result.prestige} unlocked!`)
      .setDescription(
        [
          `Your XP and level have been reset to **0**.`,
          `New XP multiplier: **${multiplierPct(result.totalXpMultiplier - 1)} total**.`,
          result.grantedRoleId ? `Granted role: <@&${result.grantedRoleId}>` : null,
        ]
          .filter((v): v is string => v !== null)
          .join('\n'),
      );
    await interaction.editReply({ embeds: [doneEmbed], components: [] });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Prestige failed.';
    await interaction.editReply({ content: msg, embeds: [], components: [] });
  }
}

async function handleAdminEnable(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const maxLevel = interaction.options.getInteger('max-level') ?? undefined;
  const multiplier = interaction.options.getNumber('multiplier') ?? undefined;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const body: {
      prestigeEnabled: boolean;
      maxLevel?: number;
      prestigeMultiplier?: number;
    } = { prestigeEnabled: true };
    if (maxLevel !== undefined) body.maxLevel = maxLevel;
    if (multiplier !== undefined) body.prestigeMultiplier = multiplier;
    const cfg = await api.updateLevelConfig(interaction.guildId, body);
    await interaction.editReply(
      `✅ Prestige enabled — max level **${cfg.maxLevel}**, per-prestige bonus **${multiplierPct(cfg.prestigeMultiplier)}**.`,
    );
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to enable prestige.';
    await interaction.editReply(msg);
  }
}

async function handleAdminDisable(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await api.updateLevelConfig(interaction.guildId, { prestigeEnabled: false });
    await interaction.editReply('🛑 Prestige disabled.');
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to disable prestige.';
    await interaction.editReply(msg);
  }
}

async function handleAdminRoleRewardAdd(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const prestige = interaction.options.getInteger('prestige', true);
  const role = interaction.options.getRole('role', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const cfg = await api.getLevelConfig(interaction.guildId);
    const next = cfg.prestigeRoleRewards.filter((r) => r.prestige !== prestige);
    next.push({ prestige, roleId: role.id });
    next.sort((a, b) => a.prestige - b.prestige);
    await api.updateLevelConfig(interaction.guildId, { prestigeRoleRewards: next });
    await interaction.editReply(`✅ P${prestige} now grants ${role}.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to update role reward.';
    await interaction.editReply(msg);
  }
}

async function handleAdminRoleRewardRemove(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const prestige = interaction.options.getInteger('prestige', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const cfg = await api.getLevelConfig(interaction.guildId);
    const next = cfg.prestigeRoleRewards.filter((r) => r.prestige !== prestige);
    if (next.length === cfg.prestigeRoleRewards.length) {
      await interaction.editReply(`No role reward configured for P${prestige}.`);
      return;
    }
    await api.updateLevelConfig(interaction.guildId, { prestigeRoleRewards: next });
    await interaction.editReply(`🗑️ Removed role reward for P${prestige}.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to remove role reward.';
    await interaction.editReply(msg);
  }
}

export const prestige: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('prestige')
    .setDescription('Prestige system — reset XP for a permanent cosmetic tier + XP bonus.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription("Show prestige progress for you (or another member).")
        .addUserOption((o) =>
          o.setName('user').setDescription('Whose prestige to show. Defaults to you.'),
        ),
    )
    .addSubcommand((s) => s.setName('claim').setDescription('Prestige now (requires max level).'))
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Prestige admin controls (Manage Server).')
        .addSubcommand((s) =>
          s
            .setName('enable')
            .setDescription('Enable the prestige system.')
            .addIntegerOption((o) =>
              o
                .setName('max-level')
                .setDescription('Level required to prestige (default 100).')
                .setMinValue(1)
                .setMaxValue(1000),
            )
            .addNumberOption((o) =>
              o
                .setName('multiplier')
                .setDescription('XP multiplier bonus per prestige (default 0.05 = +5%).')
                .setMinValue(0)
                .setMaxValue(10),
            ),
        )
        .addSubcommand((s) =>
          s.setName('disable').setDescription('Disable the prestige system.'),
        )
        .addSubcommand((s) =>
          s
            .setName('role-add')
            .setDescription('Grant a role when a member reaches a prestige tier.')
            .addIntegerOption((o) =>
              o
                .setName('prestige')
                .setDescription('Prestige tier (1–10).')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to grant.').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('role-remove')
            .setDescription('Remove the role grant for a prestige tier.')
            .addIntegerOption((o) =>
              o
                .setName('prestige')
                .setDescription('Prestige tier (1–10).')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group) {
      if (sub === 'info') return handleInfo(interaction);
      if (sub === 'claim') return handleClaim(interaction);
      return;
    }

    // Admin commands require ManageGuild.
    if (
      !interaction.memberPermissions ||
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: 'You need **Manage Server** to use prestige admin commands.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group === 'admin') {
      if (sub === 'enable') return handleAdminEnable(interaction);
      if (sub === 'disable') return handleAdminDisable(interaction);
      if (sub === 'role-add') return handleAdminRoleRewardAdd(interaction);
      if (sub === 'role-remove') return handleAdminRoleRewardRemove(interaction);
    }
  },
};
