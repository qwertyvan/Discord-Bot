import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { RpsChoice } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

const CHOICE_EMOJI: Record<RpsChoice, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};

export const rps: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Rock-paper-scissors.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('challenge')
        .setDescription('Challenge another member to RPS.')
        .addUserOption((o) =>
          o.setName('opponent').setDescription('Who to challenge.').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('choice')
            .setDescription('Your secret choice.')
            .setRequired(true)
            .addChoices(
              { name: 'rock', value: 'rock' },
              { name: 'paper', value: 'paper' },
              { name: 'scissors', value: 'scissors' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('accept')
        .setDescription('Accept and answer an RPS challenge.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Challenge id (from the challenge message).').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('choice')
            .setDescription('Your choice.')
            .setRequired(true)
            .addChoices(
              { name: 'rock', value: 'rock' },
              { name: 'paper', value: 'paper' },
              { name: 'scissors', value: 'scissors' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('record')
        .setDescription("Show a player's RPS record.")
        .addUserOption((o) => o.setName('user').setDescription('User (default: you).')),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.channel) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'challenge') {
        const opponent = interaction.options.getUser('opponent', true);
        const choice = interaction.options.getString('choice', true) as RpsChoice;
        if (opponent.bot) {
          await interaction.reply({
            content: 'You cannot challenge a bot.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (opponent.id === interaction.user.id) {
          await interaction.reply({
            content: 'You cannot challenge yourself.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const challenge = await api.postRpsChallenge(interaction.guildId, {
          channelId: interaction.channel.id,
          challengerId: interaction.user.id,
          opponentId: opponent.id,
          challengerChoice: choice,
        });
        await interaction.reply({
          content:
            `🪨📄✂️ <@${interaction.user.id}> challenges <@${opponent.id}> to RPS!\n` +
            `Run \`/rps accept id:${challenge.id} choice:<rock|paper|scissors>\` to play.`,
          allowedMentions: { users: [opponent.id] },
        });
      } else if (sub === 'accept') {
        const id = interaction.options.getString('id', true);
        const choice = interaction.options.getString('choice', true) as RpsChoice;
        const result = await api.respondRpsChallenge(id, {
          opponentId: interaction.user.id,
          opponentChoice: choice,
        });
        const c = result.challenge;
        const challengerChoice = (c.challengerChoice ?? 'rock') as RpsChoice;
        const opponentChoice = (c.opponentChoice ?? choice) as RpsChoice;

        let outcomeLine: string;
        if (result.result === 'draw') {
          outcomeLine = '🤝 **Draw!**';
        } else if (result.result === 'challenger') {
          outcomeLine = `🏆 <@${c.challengerId}> wins!`;
        } else {
          outcomeLine = `🏆 <@${c.opponentId}> wins!`;
        }

        const embed = new EmbedBuilder()
          .setTitle('Rock · Paper · Scissors')
          .setColor(0x5865f2)
          .setDescription(
            [
              `<@${c.challengerId}> chose ${CHOICE_EMOJI[challengerChoice]} **${challengerChoice}**`,
              `<@${c.opponentId}> chose ${CHOICE_EMOJI[opponentChoice]} **${opponentChoice}**`,
              '',
              outcomeLine,
            ].join('\n'),
          )
          .addFields(
            {
              name: `<@${c.challengerId}>`,
              value: `ELO ${result.challengerRecord.elo} (${result.challengerEloDelta >= 0 ? '+' : ''}${result.challengerEloDelta})`,
              inline: true,
            },
            {
              name: `<@${c.opponentId}>`,
              value: `ELO ${result.opponentRecord.elo} (${result.opponentEloDelta >= 0 ? '+' : ''}${result.opponentEloDelta})`,
              inline: true,
            },
          );
        await interaction.reply({
          embeds: [embed],
          allowedMentions: { users: [c.challengerId, c.opponentId] },
        });
      } else if (sub === 'record') {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const rec = await api.getRpsRecord(interaction.guildId, user.id);
        const total = rec.wins + rec.losses + rec.draws;
        await interaction.reply({
          content:
            `📊 RPS record for <@${user.id}>: ` +
            `**${rec.wins}**W / **${rec.losses}**L / **${rec.draws}**D` +
            ` · ELO **${rec.elo}** · ${total} game${total === 1 ? '' : 's'}`,
          allowedMentions: { users: [] },
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
