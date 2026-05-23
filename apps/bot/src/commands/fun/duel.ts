import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { duelMessagePayload } from '../../util/duel-engine.js';

export const duel: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Challenge another member to a pet battle.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('challenge')
        .setDescription('Challenge a member to a duel.')
        .addUserOption((o) =>
          o.setName('opponent').setDescription('Who to challenge.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('accept')
        .setDescription('Accept a pending duel.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Duel id.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('decline')
        .setDescription('Decline a pending duel.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Duel id.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('forfeit')
        .setDescription('Forfeit one of your active duels.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Duel id.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Show your (or another member\'s) pending/active duels.')
        .addUserOption((o) =>
          o.setName('user').setDescription('Member to inspect.'),
        ),
    )
    .addSubcommand((s) =>
      s.setName('leaderboard').setDescription("Show this server's top duellists by ELO."),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('pet')
        .setDescription('Manage your battle pet.')
        .addSubcommand((s) =>
          s
            .setName('rename')
            .setDescription('Rename your battle pet.')
            .addStringOption((o) =>
              o
                .setName('name')
                .setDescription('New name (1-48 chars).')
                .setRequired(true)
                .setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('allocate')
            .setDescription('Spend allocation points on a stat.')
            .addStringOption((o) =>
              o
                .setName('stat')
                .setDescription('Which stat to raise.')
                .setRequired(true)
                .addChoices(
                  { name: 'atk', value: 'atk' },
                  { name: 'def', value: 'def' },
                  { name: 'spd', value: 'spd' },
                  { name: 'maxhp', value: 'maxHp' },
                ),
            )
            .addIntegerOption((o) =>
              o
                .setName('amount')
                .setDescription('How many points to spend.')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(20),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('stats')
            .setDescription("Show a member's battle pet stats.")
            .addUserOption((o) =>
              o.setName('user').setDescription('Member to inspect.'),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    try {
      if (group === 'pet') {
        if (sub === 'rename') {
          const name = interaction.options.getString('name', true);
          // Ensure pet exists.
          await api.getBattlePet(interaction.guildId, interaction.user.id);
          const updated = await api.renameBattlePet(
            interaction.guildId,
            interaction.user.id,
            { name },
          );
          await interaction.reply({
            content: `✅ Renamed your champion to **${updated.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'allocate') {
          const stat = interaction.options.getString('stat', true) as
            | 'atk'
            | 'def'
            | 'spd'
            | 'maxHp';
          const amount = interaction.options.getInteger('amount', true);
          await api.getBattlePet(interaction.guildId, interaction.user.id);
          const body = {
            atk: stat === 'atk' ? amount : 0,
            def: stat === 'def' ? amount : 0,
            spd: stat === 'spd' ? amount : 0,
            maxHp: stat === 'maxHp' ? amount : 0,
          };
          const updated = await api.allocateBattleStats(
            interaction.guildId,
            interaction.user.id,
            body,
          );
          await interaction.reply({
            content:
              `✅ Spent ${amount} point${amount === 1 ? '' : 's'} on **${stat}**.\n` +
              `ATK ${updated.atk} · DEF ${updated.def} · SPD ${updated.spd} · maxHP ${updated.maxHp} (${updated.allocPoints} unspent)`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'stats') {
          const target = interaction.options.getUser('user') ?? interaction.user;
          const pet = await api.getBattlePet(interaction.guildId, target.id);
          const embed = new EmbedBuilder()
            .setTitle(`${pet.name} — Lv ${pet.level} ${pet.species}`)
            .setColor(0x5865f2)
            .setDescription(`Owned by <@${target.id}>`)
            .addFields(
              { name: 'HP', value: `${pet.hp} / ${pet.maxHp}`, inline: true },
              { name: 'ATK', value: String(pet.atk), inline: true },
              { name: 'DEF', value: String(pet.def), inline: true },
              { name: 'SPD', value: String(pet.spd), inline: true },
              { name: 'ELO', value: String(pet.elo), inline: true },
              {
                name: 'Record',
                value: `${pet.wins}W · ${pet.losses}L · ${pet.draws}D`,
                inline: true,
              },
              {
                name: 'XP',
                value: `${pet.xp} / ${pet.level * 100} (next level)`,
                inline: true,
              },
              {
                name: 'Unspent points',
                value: String(pet.allocPoints),
                inline: true,
              },
            );
          await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      if (sub === 'challenge') {
        const opponent = interaction.options.getUser('opponent', true);
        if (opponent.bot) {
          await interaction.reply({
            content: 'Bots cannot duel.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (opponent.id === interaction.user.id) {
          await interaction.reply({
            content: 'You cannot duel yourself.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const match = await api.createDuel(interaction.guildId, {
          challengerId: interaction.user.id,
          opponentId: opponent.id,
        });
        const [challengerPet, opponentPet] = await Promise.all([
          api.getBattlePet(interaction.guildId, interaction.user.id),
          api.getBattlePet(interaction.guildId, opponent.id),
        ]);
        const payload = duelMessagePayload(match, challengerPet, opponentPet);
        await interaction.reply({
          content: `⚔️ <@${opponent.id}>, you have been challenged by <@${interaction.user.id}>!`,
          embeds: payload.embeds,
          components: payload.components,
          allowedMentions: { users: [opponent.id, interaction.user.id] },
        });
        return;
      }

      if (sub === 'accept' || sub === 'decline') {
        const id = interaction.options.getString('id', true);
        const updated = await api.respondDuel(interaction.guildId, id, {
          userId: interaction.user.id,
          action: sub,
        });
        const [challengerPet, opponentPet] = await Promise.all([
          api.getBattlePet(interaction.guildId, updated.challengerId),
          api.getBattlePet(interaction.guildId, updated.opponentId),
        ]);
        const payload = duelMessagePayload(updated, challengerPet, opponentPet);
        await interaction.reply({
          content:
            sub === 'accept'
              ? `⚔️ Duel accepted. <@${updated.currentActorId}> moves first.`
              : '🛑 Duel declined.',
          embeds: payload.embeds,
          components: payload.components,
          allowedMentions: { users: [updated.challengerId, updated.opponentId] },
        });
        return;
      }

      if (sub === 'forfeit') {
        const id = interaction.options.getString('id', true);
        const result = await api.forfeitDuel(
          interaction.guildId,
          id,
          interaction.user.id,
        );
        const text = result.winnerId
          ? `🏳️ Forfeited — <@${result.winnerId}> wins.`
          : '🛑 Duel cancelled.';
        await interaction.reply({
          content: text,
          allowedMentions: { users: result.winnerId ? [result.winnerId] : [] },
        });
        return;
      }

      if (sub === 'status') {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const { matches: pending } = await api.listDuels(interaction.guildId, {
          status: 'pending',
          participant: target.id,
        });
        const { matches: active } = await api.listDuels(interaction.guildId, {
          status: 'active',
          participant: target.id,
        });
        const lines: string[] = [];
        if (pending.length === 0 && active.length === 0) {
          lines.push('*No pending or active duels.*');
        } else {
          if (active.length > 0) {
            lines.push('**Active**');
            for (const m of active) {
              lines.push(
                `• \`${m.id.slice(0, 8)}\` — <@${m.challengerId}> vs <@${m.opponentId}> · turn ${m.turn}${
                  m.currentActorId ? ` · <@${m.currentActorId}> to move` : ''
                }`,
              );
            }
          }
          if (pending.length > 0) {
            lines.push('**Pending**');
            for (const m of pending) {
              lines.push(
                `• \`${m.id.slice(0, 8)}\` — <@${m.challengerId}> → <@${m.opponentId}>`,
              );
            }
          }
        }
        const embed = new EmbedBuilder()
          .setTitle(`Duels for ${target.username}`)
          .setColor(0x5865f2)
          .setDescription(lines.join('\n'));
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { users: [] },
        });
        return;
      }

      if (sub === 'leaderboard') {
        const { entries } = await api.battleLeaderboard(interaction.guildId, 10);
        if (entries.length === 0) {
          await interaction.reply({
            content: 'No duellists yet — be the first to challenge!',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = entries.map(
          (e) =>
            `**${e.rank}.** <@${e.userId}> · ${e.name} (Lv ${e.level}) · **${e.elo}** ELO · ${e.wins}W ${e.losses}L ${e.draws}D`,
        );
        const embed = new EmbedBuilder()
          .setTitle('⚔️ Duel leaderboard')
          .setColor(0x5865f2)
          .setDescription(lines.join('\n'));
        await interaction.reply({
          embeds: [embed],
          allowedMentions: { users: [] },
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Duel command failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ content: msg, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content: msg, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  },
};
