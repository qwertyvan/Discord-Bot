import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { Giveaway } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';
import { giveawayMessagePayload } from '../../util/giveaway-render.js';

export const giveaway: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run timed giveaways with eligibility rules and weighted bonus roles.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a new giveaway in this channel.')
        .addStringOption((o) =>
          o.setName('prize').setDescription('What is being given away.').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o
            .setName('duration')
            .setDescription('How long the giveaway runs (e.g. 10m, 2h, 3d).')
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('winners')
            .setDescription('Number of winners (default 1).')
            .setMinValue(1)
            .setMaxValue(50),
        )
        .addRoleOption((o) =>
          o.setName('require-role').setDescription('Only members with this role can enter.'),
        )
        .addIntegerOption((o) =>
          o
            .setName('require-min-level')
            .setDescription('Minimum level required to enter.')
            .setMinValue(0)
            .setMaxValue(1000),
        )
        .addRoleOption((o) =>
          o.setName('bonus-role-1').setDescription('Role granting +1 weight (bonus entry).'),
        )
        .addRoleOption((o) =>
          o.setName('bonus-role-2').setDescription('Role granting +1 weight (bonus entry).'),
        )
        .addRoleOption((o) =>
          o.setName('bonus-role-3').setDescription('Role granting +1 weight (bonus entry).'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('End a giveaway now and draw winners.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Giveaway ID.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Re-draw winners for an ended giveaway.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Giveaway ID.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel an active giveaway without drawing winners.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Giveaway ID.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List recent giveaways in this guild.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'start') {
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: 'Start giveaways in a text channel.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const prize = interaction.options.getString('prize', true);
        const durationRaw = interaction.options.getString('duration', true);
        const durationMs = parseDuration(durationRaw);
        if (durationMs === null || durationMs < 10_000) {
          await interaction.reply({
            content: 'Duration must look like `10m`, `2h`, or `3d` and be at least 10 seconds.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const winners = interaction.options.getInteger('winners') ?? 1;
        const requireRole = interaction.options.getRole('require-role');
        const requireMinLevel = interaction.options.getInteger('require-min-level');
        const bonusRoles = [
          interaction.options.getRole('bonus-role-1'),
          interaction.options.getRole('bonus-role-2'),
          interaction.options.getRole('bonus-role-3'),
        ]
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .map((r) => r.id);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const endsAt = new Date(Date.now() + durationMs).toISOString();
        const created = await api.createGiveaway(interaction.guildId, {
          channelId: channel.id,
          prize,
          hostId: interaction.user.id,
          endsAt,
          winnerCount: winners,
          ...(requireRole ? { requireRoleId: requireRole.id } : {}),
          ...(requireMinLevel !== null ? { requireMinLevel } : {}),
          ...(bonusRoles.length > 0 ? { weightedBonusRoles: bonusRoles } : {}),
        });
        const payload = giveawayMessagePayload(created, 0);
        const message = await (channel as TextChannel).send(payload);
        await api.setGiveawayMessageId(interaction.guildId, created.id, message.id);
        await interaction.editReply(
          `🎉 Giveaway started — \`${created.id}\`. Ends <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>.`,
        );
        return;
      }

      if (sub === 'end') {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ended = await api.endGiveaway(interaction.guildId, id);
        await updateGiveawayMessage(interaction.guild, ended);
        if (ended.winners.length > 0) {
          await interaction.editReply(
            `🏁 Ended \`${id}\`. Winners: ${ended.winners.map((w) => `<@${w.userId}>`).join(', ')}.`,
          );
        } else {
          await interaction.editReply(`🏁 Ended \`${id}\`. No eligible entries.`);
        }
        return;
      }

      if (sub === 'reroll') {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rerolled = await api.rerollGiveaway(interaction.guildId, id);
        await updateGiveawayMessage(interaction.guild, rerolled);
        if (rerolled.winners.length > 0) {
          await interaction.editReply(
            `🎲 Rerolled \`${id}\`. New winners: ${rerolled.winners.map((w) => `<@${w.userId}>`).join(', ')}.`,
          );
        } else {
          await interaction.editReply(`🎲 Rerolled \`${id}\`. No eligible entries to pick from.`);
        }
        return;
      }

      if (sub === 'cancel') {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cancelled = await api.cancelGiveaway(interaction.guildId, id);
        await updateGiveawayMessage(interaction.guild, cancelled);
        await interaction.editReply(`🛑 Cancelled \`${id}\`.`);
        return;
      }

      if (sub === 'list') {
        const { giveaways } = await api.listGiveaways(interaction.guildId, { limit: 20 });
        if (giveaways.length === 0) {
          await interaction.reply({
            content: 'No giveaways yet.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Recent giveaways')
          .setColor(0x5865f2)
          .setDescription(
            giveaways
              .map((g) => {
                const status = g.status === 'active' ? '🟢' : g.status === 'ended' ? '🏁' : '🛑';
                const when =
                  g.status === 'active'
                    ? `ends <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R>`
                    : `ended <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R>`;
                return `${status} \`${g.id}\` · **${g.prize}** · ${g.entryCount} entries · ${when}`;
              })
              .join('\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};

async function updateGiveawayMessage(guild: Guild, g: Giveaway): Promise<void> {
  if (!g.messageId || !g.channelId) return;
  const channel = guild.channels.cache.get(g.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const message = await (channel as TextChannel).messages.fetch(g.messageId).catch(() => null);
  if (!message) return;
  const winnerMention =
    g.status === 'ended' && g.winners.length > 0
      ? {
          content: `🎉 Congrats ${g.winners.map((w) => `<@${w.userId}>`).join(', ')} — you won **${g.prize}**!`,
          allowedMentions: { users: g.winners.map((w) => w.userId) },
        }
      : {};
  await message.edit({ ...giveawayMessagePayload(g, g.entryCount), ...winnerMention }).catch(() => {});
}
