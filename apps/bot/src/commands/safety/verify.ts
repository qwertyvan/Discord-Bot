import { MessageFlags, SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { log } from '../../logger.js';

/**
 * /verify <answer> — solves a pending captcha challenge. Usable in DMs or in
 * any guild. When used in DMs we look up the pending challenge by user id
 * across the user's guilds; in a guild we use that guild directly.
 */
export const verify: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Solve your verification captcha.')
    .addStringOption((o) =>
      o.setName('answer').setDescription('Your captcha answer.').setRequired(true).setMaxLength(64),
    ),
  async execute(interaction) {
    const answer = interaction.options.getString('answer', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // In a guild → verify against that guild.
    if (interaction.inGuild() && interaction.guildId) {
      await runVerify(interaction, interaction.guildId, answer);
      return;
    }

    // In DMs → scan guilds the bot shares with the user.
    const client = interaction.client;
    let found = false;
    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) continue;
      const pending = await api
        .getPendingVerification(guild.id, interaction.user.id)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        });
      if (!pending) continue;
      found = true;
      await runVerifyForMember(interaction, guild.id, answer);
      return;
    }
    if (!found) {
      await interaction.editReply('You have no pending verification challenge.');
    }
  },
};

async function runVerify(
  interaction: Parameters<SlashCommand['execute']>[0],
  guildId: string,
  answer: string,
): Promise<void> {
  await runVerifyForMember(interaction, guildId, answer);
}

async function runVerifyForMember(
  interaction: Parameters<SlashCommand['execute']>[0],
  guildId: string,
  answer: string,
): Promise<void> {
  let result;
  try {
    result = await api.verifyChallenge(guildId, interaction.user.id, { answer });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Verification failed.';
    await interaction.editReply(msg);
    return;
  }

  if (result.notFound) {
    await interaction.editReply('You have no pending verification challenge.');
    return;
  }
  if (result.expired) {
    await interaction.editReply(
      'That challenge has expired. Re-join or ask a moderator to re-issue one.',
    );
    return;
  }
  if (!result.ok) {
    if (result.attemptsLeft > 0) {
      await interaction.editReply(
        `❌ That's not right. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} remaining.`,
      );
    } else {
      await interaction.editReply('❌ Out of attempts. Ask a moderator for help.');
    }
    return;
  }

  // Success → grant the verified role and clear the unverified one if present.
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    await interaction.editReply('✅ Verified.');
    return;
  }
  const member: GuildMember | null = await guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  if (!member) {
    await interaction.editReply('✅ Verified — please rejoin the server.');
    return;
  }

  let verifiedRoleId: string | null = null;
  let unverifiedRoleId: string | null = null;
  try {
    const vc = await api.getVerificationConfig(guildId);
    if (vc.enabled) verifiedRoleId = vc.verifiedRoleId;
  } catch (err) {
    log.warn('verify: getVerificationConfig failed', { guildId, err: String(err) });
  }
  try {
    const ar = await api.getAntiRaidConfig(guildId);
    unverifiedRoleId = ar.unverifiedRoleId;
  } catch (err) {
    log.warn('verify: getAntiRaidConfig failed', { guildId, err: String(err) });
  }

  if (verifiedRoleId && !member.roles.cache.has(verifiedRoleId)) {
    await member.roles.add(verifiedRoleId, 'Verified via captcha').catch((err) => {
      log.warn('verify: roles.add failed', { guildId, userId: member.id, err: String(err) });
    });
  }
  if (unverifiedRoleId && member.roles.cache.has(unverifiedRoleId)) {
    await member.roles.remove(unverifiedRoleId, 'Verified via captcha').catch(() => {});
  }

  await interaction.editReply('✅ Verified — welcome!');
}
