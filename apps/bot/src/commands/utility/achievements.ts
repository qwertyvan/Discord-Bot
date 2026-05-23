import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type {
  Achievement,
  AchievementKind,
  UserAchievement,
} from '@discord-bot/shared';
import { invalidateAchievementCache } from '../../util/achievement-eval.js';

const KIND_CHOICES: Array<{ name: string; value: AchievementKind }> = [
  { name: 'Messages', value: 'messages' },
  { name: 'Voice minutes', value: 'voice_minutes' },
  { name: 'Level', value: 'level' },
  { name: 'Reactions', value: 'reactions' },
  { name: 'Stickers', value: 'stickers' },
  { name: 'Custom', value: 'custom' },
];

const PAGE_SIZE = 10;

function formatLine(a: Achievement, prefix = ''): string {
  const status = a.enabled ? '' : ' _(disabled)_';
  const reward = a.currencyReward > 0 ? ` · 💰 ${a.currencyReward}` : '';
  return `${prefix}${a.emoji} **${a.name}** \`${a.slug}\` — ${a.description} · _${a.kind}_ · threshold ${a.threshold}${reward}${status}`;
}

async function listCatalogue(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const { achievements } = await api.listAchievements(interaction.guildId);
  if (achievements.length === 0) {
    await interaction.reply({
      content:
        'No achievements configured. Run `/achievements admin seed` to install the 10 stock ones.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const page = achievements.slice(0, PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Achievements (${achievements.length})`)
    .setColor(0xfee75c)
    .setDescription(page.map((a) => formatLine(a)).join('\n'));
  if (achievements.length > PAGE_SIZE) {
    embed.setFooter({
      text: `Showing first ${PAGE_SIZE} of ${achievements.length}.`,
    });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function showUnlockedFor(
  interaction: ChatInputCommandInteraction,
  userId: string,
  label: string,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const [{ userAchievements }, { achievements }] = await Promise.all([
    api.listUserAchievements(interaction.guildId, { userId }),
    api.listAchievements(interaction.guildId),
  ]);
  if (userAchievements.length === 0) {
    await interaction.reply({
      content: `${label} hasn't unlocked any achievements yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const byId = new Map<string, Achievement>(achievements.map((a) => [a.id, a]));
  const ordered = [...userAchievements].sort(
    (a: UserAchievement, b: UserAchievement) =>
      Date.parse(b.unlockedAt) - Date.parse(a.unlockedAt),
  );
  const lines = ordered.slice(0, PAGE_SIZE).map((ua) => {
    const a = byId.get(ua.achievementId);
    if (!a) {
      return `• \`${ua.achievementId}\` (deleted)`;
    }
    const when = `<t:${Math.floor(Date.parse(ua.unlockedAt) / 1000)}:R>`;
    return `${a.emoji} **${a.name}** — ${when} · progress ${ua.progressAtUnlock}`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${label}'s achievements (${userAchievements.length})`)
    .setColor(0xfee75c)
    .setDescription(lines.join('\n'));
  if (userAchievements.length > PAGE_SIZE) {
    embed.setFooter({
      text: `Showing ${PAGE_SIZE} of ${userAchievements.length}.`,
    });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export const achievements: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Browse and manage server achievements.')
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('list').setDescription("List the server's achievement catalogue."),
    )
    .addSubcommand((s) =>
      s.setName('me').setDescription('Show the achievements you have unlocked.'),
    )
    .addSubcommand((s) =>
      s
        .setName('user')
        .setDescription("Show another member's unlocked achievements.")
        .addUserOption((o) =>
          o.setName('user').setDescription('Which member.').setRequired(true),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Manage the achievement catalogue.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Define a new achievement.')
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Stable id (lowercase, digits, _ or -).')
                .setRequired(true)
                .setMaxLength(48),
            )
            .addStringOption((o) =>
              o
                .setName('name')
                .setDescription('Display name.')
                .setRequired(true)
                .setMaxLength(80),
            )
            .addStringOption((o) =>
              o
                .setName('kind')
                .setDescription('Which counter the threshold applies to.')
                .setRequired(true)
                .addChoices(...KIND_CHOICES),
            )
            .addIntegerOption((o) =>
              o
                .setName('threshold')
                .setDescription('Counter value required to unlock.')
                .setRequired(true)
                .setMinValue(1),
            )
            .addStringOption((o) =>
              o
                .setName('description')
                .setDescription('Short summary shown in lists.')
                .setMaxLength(300),
            )
            .addStringOption((o) =>
              o
                .setName('emoji')
                .setDescription('Display emoji (defaults to 🏆).')
                .setMaxLength(64),
            )
            .addIntegerOption((o) =>
              o
                .setName('reward')
                .setDescription('Coins to grant on unlock.')
                .setMinValue(0),
            )
            .addStringOption((o) =>
              o
                .setName('badge-slug')
                .setDescription('Optional profile-badge slug to grant on unlock.')
                .setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Delete an achievement by slug.')
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Slug of the achievement to remove.')
                .setRequired(true)
                .setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('seed')
            .setDescription('Install the 10 stock achievements (idempotent).'),
        ),
    )
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'admin') {
        // Gate the admin group ourselves so we can keep the rest open.
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: 'You need **Manage Server** to run this.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'add') {
          const slug = interaction.options.getString('slug', true).toLowerCase();
          const name = interaction.options.getString('name', true);
          const kind = interaction.options.getString('kind', true) as AchievementKind;
          const threshold = interaction.options.getInteger('threshold', true);
          const description =
            interaction.options.getString('description') ?? `Reach ${threshold} ${kind}.`;
          const emoji = interaction.options.getString('emoji') ?? undefined;
          const reward = interaction.options.getInteger('reward') ?? undefined;
          const badgeSlug = interaction.options.getString('badge-slug') ?? undefined;
          const created = await api.createAchievement(interaction.guildId, {
            slug,
            name,
            description,
            kind,
            threshold,
            ...(emoji !== undefined ? { emoji } : {}),
            ...(reward !== undefined ? { currencyReward: reward } : {}),
            ...(badgeSlug !== undefined ? { badgeSlug } : {}),
          });
          invalidateAchievementCache(interaction.guildId, kind);
          await interaction.reply({
            content: `✅ Added **${created.emoji} ${created.name}** (\`${created.slug}\`, threshold ${created.threshold} ${created.kind}).`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'remove') {
          const slug = interaction.options.getString('slug', true).toLowerCase();
          await api.deleteAchievementBySlug(interaction.guildId, slug);
          invalidateAchievementCache(interaction.guildId);
          await interaction.reply({
            content: `🗑️ Removed \`${slug}\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'seed') {
          const result = await api.seedAchievements(interaction.guildId);
          invalidateAchievementCache(interaction.guildId);
          await interaction.reply({
            content: `🌱 Seeded ${result.inserted} new achievement${result.inserted === 1 ? '' : 's'} (skipped ${result.skipped} already present).`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } else if (sub === 'list') {
        await listCatalogue(interaction);
        return;
      } else if (sub === 'me') {
        await showUnlockedFor(interaction, interaction.user.id, 'You');
        return;
      } else if (sub === 'user') {
        const target = interaction.options.getUser('user', true);
        await showUnlockedFor(interaction, target.id, target.username);
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
