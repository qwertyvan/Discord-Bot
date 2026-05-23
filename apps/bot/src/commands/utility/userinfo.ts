import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

/**
 * /userinfo — show profile metadata plus best-effort level + balance.
 *
 * The leveling and economy lookups are wrapped in catch handlers so that
 * guilds without those subsystems configured still get a complete profile
 * card. We swallow 404s and other errors silently because this command is
 * a read-only display: any failure simply hides the field.
 */
export const userinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a user.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The user to inspect (defaults to you).'),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    // Fetch with force=true so we can pull the user's profile banner — it's
    // only present on the full /users/{id} payload, not on partial user
    // objects that arrive with messages.
    const fullUser = await target.fetch(true).catch(() => target);
    const member =
      interaction.inGuild() && interaction.guild
        ? await interaction.guild.members.fetch(target.id).catch(() => null)
        : null;

    const embed = new EmbedBuilder()
      .setAuthor({ name: fullUser.tag, iconURL: fullUser.displayAvatarURL() })
      .setThumbnail(fullUser.displayAvatarURL({ size: 256 }))
      .setColor(member?.displayColor || fullUser.accentColor || 0x5865f2)
      .addFields(
        { name: 'ID', value: fullUser.id, inline: true },
        { name: 'Bot', value: fullUser.bot ? 'Yes' : 'No', inline: true },
        {
          name: 'Account created',
          value: time(fullUser.createdAt, TimestampStyles.RelativeTime),
          inline: false,
        },
      );

    if (fullUser.bannerURL()) {
      embed.setImage(fullUser.bannerURL({ size: 1024 }) ?? null);
    }

    if (member) {
      if (member.joinedAt) {
        embed.addFields({
          name: 'Joined server',
          value: time(member.joinedAt, TimestampStyles.RelativeTime),
          inline: false,
        });
      }
      const roles = member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position);
      if (roles.size > 0) {
        const top = roles.first(10)?.map((r) => r.toString()) ?? [];
        embed.addFields({
          name: `Roles (${roles.size})`,
          value: top.join(' ') + (roles.size > 10 ? ' …' : ''),
          inline: false,
        });
      }

      // Best-effort leveling lookup. The /level endpoint 404s if the member
      // has no XP record — that's expected and we just skip the field.
      try {
        const ml = await api.getMemberLevel(member.guild.id, member.id);
        embed.addFields({
          name: 'Level',
          value:
            `Level **${ml.level}** · ${ml.xp} XP` +
            (ml.rank !== null ? ` · rank #${ml.rank}` : ''),
          inline: true,
        });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) {
          // Non-404s aren't fatal either — leveling could just be disabled.
        }
      }

      // Best-effort balance lookup.
      try {
        const bal = await api.getBalance(member.guild.id, member.id);
        embed.addFields({
          name: 'Balance',
          value: `${bal.amount}`,
          inline: true,
        });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) {
          // ignore — economy not configured
        }
      }

      // Profile augmentation (v0.53). The /profile API always returns a
      // payload (blank if the user hasn't customized anything), so we only
      // surface fields that are actually populated. Wrapped in try/catch so
      // older API deployments without the route just skip the augmentation.
      try {
        const prof = await api.getUserProfile(member.guild.id, member.id);
        if (prof.bio) {
          embed.addFields({ name: 'Bio', value: prof.bio, inline: false });
        }
        if (prof.badges.length > 0) {
          const visible = prof.badges.slice(0, 5);
          const overflow = prof.badges.length - visible.length;
          embed.addFields({
            name: `Badges (${prof.badges.length})`,
            value:
              visible.map((b) => `${b.badge.emoji} ${b.badge.name}`).join('  ') +
              (overflow > 0 ? `  +${overflow}` : ''),
            inline: false,
          });
        }
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) {
          // ignore — profile route absent in older API deployments
        }
      }
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
