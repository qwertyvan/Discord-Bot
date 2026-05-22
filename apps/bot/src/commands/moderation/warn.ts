import {
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { checkModerationHierarchy } from './_hierarchy.js';
import { buildModActionEmbed } from '../../util/mod-action-embed.js';
import { log } from '../../logger.js';
import { applyEscalation } from './_escalation.js';
import { applyLadderEscalation } from './_ladder.js';

export const warn: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to warn.').setRequired(true))
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the warning.').setRequired(true).setMaxLength(500),
    )
    .addStringOption((o) =>
      o.setName('category').setDescription('Optional category (spam, harassment, …).').setMaxLength(64),
    )
    .addIntegerOption((o) =>
      o.setName('severity').setDescription('Severity 1–5.').setMinValue(1).setMaxValue(5),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const category = interaction.options.getString('category') ?? undefined;
    const severity = interaction.options.getInteger('severity') ?? undefined;

    if (target.bot) {
      await interaction.reply({ content: 'You cannot warn a bot.', flags: MessageFlags.Ephemeral });
      return;
    }

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (targetMember && interaction.member instanceof GuildMember) {
      const hierarchyError = checkModerationHierarchy(interaction.member, targetMember);
      if (hierarchyError) {
        await interaction.reply({ content: hierarchyError, flags: MessageFlags.Ephemeral });
        return;
      }
    } else if (target.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot warn yourself.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const { action, triggeredEscalation } = await api.createModAction(interaction.guildId, {
        type: 'WARN',
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
        ...(category ? { category } : {}),
        ...(severity ? { severity } : {}),
      });

      const embed = buildModActionEmbed(action, target, interaction.user);
      await interaction.reply({ embeds: [embed] });

      await target
        .send(
          `You were warned in **${interaction.guild.name}** (case #${action.caseNumber}).\n**Reason:** ${reason}`,
        )
        .catch(() => {});

      if (triggeredEscalation && targetMember) {
        const result = await applyEscalation(
          interaction.guild,
          targetMember,
          interaction.user,
          triggeredEscalation,
        );
        if (result) {
          await interaction.followUp({ embeds: [buildModActionEmbed(result, target, interaction.user)] });
        }
      } else if (targetMember) {
        // Evaluate the v0.27 configurable warn ladder. Wrapped to never throw
        // out of the warn flow.
        try {
          const ladderResult = await applyLadderEscalation(
            interaction.guild,
            targetMember,
            interaction.user,
          );
          if (ladderResult) {
            await interaction.followUp({
              embeds: [buildModActionEmbed(ladderResult, target, interaction.user)],
            });
          }
        } catch (err) {
          log.warn('Warn ladder escalation failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? `Failed to record warning: ${err.message}` : 'Failed to record warning.';
      log.warn('Warn command failed', { err: err instanceof Error ? err.message : String(err) });
      if (interaction.replied) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
