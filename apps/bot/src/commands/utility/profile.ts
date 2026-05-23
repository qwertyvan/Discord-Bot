import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { buildProfileEmbed, type ProfileLevelInfo } from '../../util/profile-render.js';

/**
 * /profile — per-(guild,user) bio, accent color, favorite quote, badges.
 *
 *   /profile show [user]
 *   /profile edit                         (opens modal)
 *   /profile badge grant @user <slug>     (ManageGuild)
 *   /profile badge revoke @user <slug>    (ManageGuild)
 *   /profile badge list
 *   /profile badge create <slug> <name> <emoji> [description]   (ManageGuild)
 *   /profile badge delete <slug>          (ManageGuild)
 *
 * The modal handler lives in events/interactionCreate.ts and posts the
 * collected fields back through PUT /guilds/:gid/profile/:uid.
 */
export const profile: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Profile customization (bio, accent, badges).')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription("Show a member's profile.")
        .addUserOption((o) =>
          o.setName('user').setDescription('The user to inspect (defaults to you).'),
        ),
    )
    .addSubcommand((s) =>
      s.setName('edit').setDescription('Edit your bio, accent color, and favorite quote.'),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('badge')
        .setDescription('Manage profile badges.')
        .addSubcommand((s) =>
          s
            .setName('grant')
            .setDescription('Grant a badge to a user. (ManageGuild)')
            .addUserOption((o) =>
              o.setName('user').setDescription('User to grant.').setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Badge slug.')
                .setRequired(true)
                .setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('revoke')
            .setDescription('Revoke a badge from a user. (ManageGuild)')
            .addUserOption((o) =>
              o.setName('user').setDescription('User to revoke.').setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Badge slug.')
                .setRequired(true)
                .setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s.setName('list').setDescription('List all badges in this guild.'),
        )
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('Create a new badge. (ManageGuild)')
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Unique slug (lowercase, hyphens/underscores).')
                .setRequired(true)
                .setMaxLength(48),
            )
            .addStringOption((o) =>
              o
                .setName('name')
                .setDescription('Display name.')
                .setRequired(true)
                .setMaxLength(64),
            )
            .addStringOption((o) =>
              o
                .setName('emoji')
                .setDescription('Emoji or custom emoji string.')
                .setRequired(true)
                .setMaxLength(64),
            )
            .addStringOption((o) =>
              o.setName('description').setDescription('Short description.').setMaxLength(200),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('delete')
            .setDescription('Delete a badge from the guild. (ManageGuild)')
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Badge slug.')
                .setRequired(true)
                .setMaxLength(48),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    try {
      if (!group && sub === 'show') {
        await handleShow(interaction);
        return;
      }
      if (!group && sub === 'edit') {
        await handleEdit(interaction);
        return;
      }
      if (group === 'badge') {
        if (sub === 'list') {
          await handleBadgeList(interaction);
          return;
        }
        // The rest require ManageGuild; we cannot gate via
        // setDefaultMemberPermissions because show/edit are open. Hand-check.
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) &&
          sub !== 'list'
        ) {
          await interaction.reply({
            content: 'You need Manage Server to manage badges.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'grant') {
          await handleBadgeGrant(interaction);
          return;
        }
        if (sub === 'revoke') {
          await handleBadgeRevoke(interaction);
          return;
        }
        if (sub === 'create') {
          await handleBadgeCreate(interaction);
          return;
        }
        if (sub === 'delete') {
          await handleBadgeDelete(interaction);
          return;
        }
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

async function handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const target = interaction.options.getUser('user') ?? interaction.user;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  await interaction.deferReply();

  const profileData = await api.getUserProfile(interaction.guildId, target.id);

  // Best-effort level + balance — same pattern as /userinfo: 404s are
  // expected when subsystems are disabled and we just skip the field.
  let levelInfo: ProfileLevelInfo | null = null;
  try {
    const ml = await api.getMemberLevel(interaction.guildId, target.id);
    levelInfo = { level: ml.level, xp: ml.xp, rank: ml.rank };
  } catch {
    // ignore
  }
  let balance: number | null = null;
  try {
    const bal = await api.getBalance(interaction.guildId, target.id);
    balance = bal.amount;
  } catch {
    // ignore
  }

  const embed = buildProfileEmbed({
    member,
    user: target,
    profile: profileData,
    badges: profileData.badges,
    levelInfo,
    balance,
  });
  await interaction.editReply({ embeds: [embed] });
}

async function handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  // Preload the current values so the modal isn't blank for returning users.
  const current = await api
    .getUserProfile(interaction.guildId, interaction.user.id)
    .catch(() => null);

  const bioInput = new TextInputBuilder()
    .setCustomId('bio')
    .setLabel('Bio (markdown, 400 chars)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400);
  if (current?.bio) bioInput.setValue(current.bio);

  const accentInput = new TextInputBuilder()
    .setCustomId('accentColor')
    .setLabel('Accent color (#RRGGBB)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(7)
    .setPlaceholder('#5865F2');
  if (current?.accentColor) accentInput.setValue(current.accentColor);

  const quoteInput = new TextInputBuilder()
    .setCustomId('favoriteQuote')
    .setLabel('Favorite quote (200 chars)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);
  if (current?.favoriteQuote) quoteInput.setValue(current.favoriteQuote);

  const modal = new ModalBuilder()
    .setCustomId(`profile-edit-modal:${interaction.user.id}`)
    .setTitle('Edit your profile')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(bioInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(accentInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(quoteInput),
    );

  await interaction.showModal(modal);
}

async function handleBadgeList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const { badges } = await api.listProfileBadges(interaction.guildId);
  if (badges.length === 0) {
    await interaction.reply({
      content: 'No badges have been created yet.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle(`Profile badges (${badges.length})`)
    .setColor(0x5865f2)
    .setDescription(
      badges
        .map(
          (b) =>
            `${b.emoji} **${b.name}** \`${b.slug}\`` +
            (b.description ? ` — ${b.description}` : ''),
        )
        .join('\n'),
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleBadgeGrant(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const user = interaction.options.getUser('user', true);
  const slug = interaction.options.getString('slug', true).toLowerCase();
  const ub = await api.grantUserBadge(interaction.guildId, slug, {
    userId: user.id,
    awardedBy: interaction.user.id,
  });
  await interaction.reply({
    content: `✅ Granted ${ub.badge.emoji} **${ub.badge.name}** to <@${user.id}>.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { users: [] },
  });
}

async function handleBadgeRevoke(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const user = interaction.options.getUser('user', true);
  const slug = interaction.options.getString('slug', true).toLowerCase();
  await api.revokeUserBadge(interaction.guildId, slug, user.id);
  await interaction.reply({
    content: `🗑️ Revoked \`${slug}\` from <@${user.id}>.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { users: [] },
  });
}

async function handleBadgeCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const slug = interaction.options.getString('slug', true).toLowerCase();
  const name = interaction.options.getString('name', true);
  const emoji = interaction.options.getString('emoji', true);
  const description = interaction.options.getString('description') ?? undefined;
  const badge = await api.createProfileBadge(interaction.guildId, {
    slug,
    name,
    emoji,
    ...(description ? { description } : {}),
  });
  await interaction.reply({
    content: `✅ Created badge ${badge.emoji} **${badge.name}** (\`${badge.slug}\`).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBadgeDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const slug = interaction.options.getString('slug', true).toLowerCase();
  await api.deleteProfileBadge(interaction.guildId, slug);
  await interaction.reply({
    content: `🗑️ Deleted badge \`${slug}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}
