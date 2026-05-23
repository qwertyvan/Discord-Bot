import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type {
  CreateQuestTemplateInput,
  QuestCadence,
  QuestKind,
  UserQuest,
} from '@discord-bot/shared';

const PROGRESS_BAR_WIDTH = 12;

function progressBar(progress: number, target: number): string {
  if (target <= 0) return '';
  const pct = Math.min(1, Math.max(0, progress / target));
  const filled = Math.round(pct * PROGRESS_BAR_WIDTH);
  return '`' + '█'.repeat(filled) + '░'.repeat(PROGRESS_BAR_WIDTH - filled) + '`';
}

function questLine(q: UserQuest): string {
  const status = q.claimedAt
    ? '🏆 Claimed'
    : q.completedAt
      ? '✅ Ready to claim'
      : `${progressBar(q.progress, q.template.targetCount)} ${q.progress}/${q.template.targetCount}`;
  const rewards: string[] = [];
  if (q.template.rewardCurrency > 0) rewards.push(`💰 ${q.template.rewardCurrency}`);
  if (q.template.rewardXp > 0) rewards.push(`✨ ${q.template.rewardXp} XP`);
  if (q.template.rewardRoleId) rewards.push(`🎭 <@&${q.template.rewardRoleId}>`);
  const rewardStr = rewards.length ? ` · ${rewards.join(' ')}` : '';
  const cadenceTag = q.template.cadence === 'weekly' ? '🗓️ Weekly' : '☀️ Daily';
  const expiresTs = Math.floor(new Date(q.expiresAt).getTime() / 1000);
  return [
    `**${q.template.name}** · ${cadenceTag}`,
    q.template.description ? `_${q.template.description}_` : null,
    `${status}${rewardStr}`,
    `id: \`${q.id}\` · resets <t:${expiresTs}:R>`,
  ]
    .filter(Boolean)
    .join('\n');
}

const KIND_CHOICES: Array<{ name: string; value: QuestKind }> = [
  { name: 'Send messages', value: 'send_messages' },
  { name: 'React to messages', value: 'react_messages' },
  { name: 'Send in a channel', value: 'send_in_channel' },
  { name: 'Voice minutes', value: 'voice_minutes' },
  { name: 'Send an image', value: 'send_image' },
  { name: 'Complete other quests', value: 'complete_other_quest' },
];

const CADENCE_CHOICES: Array<{ name: string; value: QuestCadence }> = [
  { name: 'Daily', value: 'daily' },
  { name: 'Weekly', value: 'weekly' },
];

export const quest: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Daily and weekly server quests.')
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('list').setDescription('Show your active quests and their progress.'),
    )
    .addSubcommand((s) =>
      s
        .setName('claim')
        .setDescription('Claim the reward for a completed quest.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Quest id from /quest list.').setRequired(true),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Manage quest templates (ManageGuild).')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a quest template.')
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Unique identifier (lowercase, dashes ok).')
                .setRequired(true)
                .setMaxLength(48),
            )
            .addStringOption((o) =>
              o.setName('name').setDescription('Display name.').setRequired(true).setMaxLength(120),
            )
            .addStringOption((o) =>
              o
                .setName('kind')
                .setDescription('Objective kind.')
                .setRequired(true)
                .addChoices(...KIND_CHOICES),
            )
            .addIntegerOption((o) =>
              o
                .setName('target')
                .setDescription('Target count (e.g. 10 messages).')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100_000),
            )
            .addStringOption((o) =>
              o
                .setName('cadence')
                .setDescription('Daily or weekly.')
                .setRequired(true)
                .addChoices(...CADENCE_CHOICES),
            )
            .addIntegerOption((o) =>
              o
                .setName('currency-reward')
                .setDescription('Currency reward on claim.')
                .setMinValue(0)
                .setMaxValue(1_000_000),
            )
            .addIntegerOption((o) =>
              o
                .setName('xp-reward')
                .setDescription('XP reward on claim.')
                .setMinValue(0)
                .setMaxValue(1_000_000),
            )
            .addRoleOption((o) =>
              o.setName('role-reward').setDescription('Role to grant on claim.'),
            )
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Required for "send in a channel" templates.')
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                  ChannelType.PublicThread,
                  ChannelType.PrivateThread,
                  ChannelType.AnnouncementThread,
                ),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a quest template by slug.')
            .addStringOption((o) =>
              o.setName('slug').setDescription('Slug of the template.').setRequired(true),
            ),
        )
        .addSubcommand((s) => s.setName('seed').setDescription('Install stock quest templates.')),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const guildId = interaction.guildId;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      // ── Member-facing: /quest list ───────────────────────────────
      if (!group && sub === 'list') {
        const { quests } = await api.getUserQuests(guildId, interaction.user.id);
        if (quests.length === 0) {
          await interaction.reply({
            content: '_No active quests. An admin can run `/quest admin seed` to set some up._',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Your quests')
          .setColor(0x22c55e)
          .setDescription(quests.map(questLine).join('\n\n'));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      // ── Member-facing: /quest claim ──────────────────────────────
      if (!group && sub === 'claim') {
        const id = interaction.options.getString('id', true);
        const { quest: claimed, rewards } = await api.claimUserQuest(guildId, id);
        if (claimed.userId !== interaction.user.id) {
          await interaction.reply({
            content: 'That quest does not belong to you.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (rewards.roleId) {
          try {
            const member = await interaction.guild?.members.fetch(interaction.user.id);
            await member?.roles.add(rewards.roleId, `Quest reward: ${claimed.template.name}`);
          } catch {
            // Role might be above bot — surface a soft warning to the user.
          }
        }
        const parts: string[] = [];
        if (rewards.currency > 0) parts.push(`💰 ${rewards.currency} currency`);
        if (rewards.xp > 0) parts.push(`✨ ${rewards.xp} XP`);
        if (rewards.roleId) parts.push(`🎭 <@&${rewards.roleId}>`);
        await interaction.reply({
          content: `🏆 **${claimed.template.name}** claimed! ${parts.join(' · ') || '(no rewards configured)'}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Admin: /quest admin add ──────────────────────────────────
      if (group === 'admin' && sub === 'add') {
        if (!hasManageGuild(interaction)) {
          await interaction.reply({
            content: 'You need ManageGuild for this.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const name = interaction.options.getString('name', true);
        const kind = interaction.options.getString('kind', true) as QuestKind;
        const target = interaction.options.getInteger('target', true);
        const cadence = interaction.options.getString('cadence', true) as QuestCadence;
        const currencyReward = interaction.options.getInteger('currency-reward') ?? 0;
        const xpReward = interaction.options.getInteger('xp-reward') ?? 0;
        const roleReward = interaction.options.getRole('role-reward');
        const channel = interaction.options.getChannel('channel');

        if (kind === 'send_in_channel' && !channel) {
          await interaction.reply({
            content: 'A `channel` is required for "send in a channel" templates.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const body: CreateQuestTemplateInput = {
          slug,
          name,
          kind,
          targetCount: target,
          cadence,
          rewardCurrency: currencyReward,
          rewardXp: xpReward,
          enabled: true,
          ...(channel ? { targetChannelId: channel.id } : {}),
          ...(roleReward ? { rewardRoleId: roleReward.id } : {}),
        };
        const tmpl = await api.createQuestTemplate(guildId, body);
        await interaction.reply({
          content: `✅ Added quest \`${tmpl.slug}\` — ${tmpl.cadence}, target ${tmpl.targetCount}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Admin: /quest admin remove ───────────────────────────────
      if (group === 'admin' && sub === 'remove') {
        if (!hasManageGuild(interaction)) {
          await interaction.reply({
            content: 'You need ManageGuild for this.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const slug = interaction.options.getString('slug', true).toLowerCase();
        await api.deleteQuestTemplate(guildId, slug);
        await interaction.reply({
          content: `🗑️ Removed quest template \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Admin: /quest admin seed ─────────────────────────────────
      if (group === 'admin' && sub === 'seed') {
        if (!hasManageGuild(interaction)) {
          await interaction.reply({
            content: 'You need ManageGuild for this.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const { inserted, skipped } = await api.seedQuestTemplates(guildId);
        const lines: string[] = [];
        if (inserted.length) lines.push(`Inserted: ${inserted.map((s) => `\`${s}\``).join(', ')}`);
        if (skipped.length) lines.push(`Skipped (already present): ${skipped.map((s) => `\`${s}\``).join(', ')}`);
        if (lines.length === 0) lines.push('_No stock templates available._');
        await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) return;
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};

function hasManageGuild(interaction: {
  memberPermissions: { has(perm: bigint): boolean } | null;
}): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
