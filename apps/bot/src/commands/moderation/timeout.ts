import {
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { checkModerationHierarchy } from './_hierarchy.js';

const DURATION_PATTERN = /^(\d+)\s*([smhd])$/i;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const MAX_TIMEOUT_MS = 28 * 86_400_000; // Discord max is 28 days

function parseDuration(input: string): number | null {
  const match = DURATION_PATTERN.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase() as keyof typeof UNIT_MS;
  return value * UNIT_MS[unit];
}

export const timeout: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member for a given duration.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to timeout.').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('Duration, e.g. 10m, 1h, 2d. Use 0 to clear.')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for timeout.').setMaxLength(500),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
    const rawDuration = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    const isClear = rawDuration.trim() === '0';
    const durationMs = isClear ? 0 : parseDuration(rawDuration);
    if (durationMs === null) {
      await interaction.reply({
        content: 'Invalid duration. Use formats like `10m`, `1h`, `2d`, or `0` to clear.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (durationMs > MAX_TIMEOUT_MS) {
      await interaction.reply({
        content: 'Maximum timeout duration is 28 days.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!(interaction.member instanceof GuildMember)) {
      await interaction.reply({ content: 'Could not resolve your member record.', flags: MessageFlags.Ephemeral });
      return;
    }
    const hierarchyError = checkModerationHierarchy(interaction.member, member);
    if (hierarchyError) {
      await interaction.reply({ content: hierarchyError, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!member.moderatable) {
      await interaction.reply({
        content: 'I cannot moderate that user (role hierarchy or missing permission for the bot).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await member.timeout(isClear ? null : durationMs, `${interaction.user.tag}: ${reason}`);

    if (isClear) {
      await interaction.reply(`✅ Cleared timeout for ${target}.`);
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('Member timed out')
      .setColor(0xfaa61a)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${target} (\`${target.id}\`)` },
        { name: 'Moderator', value: `${interaction.user}` },
        { name: 'Duration', value: rawDuration },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};
