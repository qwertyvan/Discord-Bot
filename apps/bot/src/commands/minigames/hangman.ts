import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { HangmanGame } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// Discord allows 5 action rows × 5 buttons = 25 components per message.
// We render letters A-Y (25 buttons) and document Z as unavailable.
// Players whose word contains Z can pick `max_misses` accordingly or
// host them via the channel chat — the milestone explicitly trades Z for
// the simpler single-message layout.
const LETTERS = [
  'A', 'B', 'C', 'D', 'E',
  'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O',
  'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y',
];

const STAGES = [
  '```\n      \n      \n      \n      \n      \n=====\n```',
  '```\n  |   \n  |   \n  |   \n  |   \n  |   \n=====\n```',
  '```\n +---+\n  |   \n  |   \n  |   \n  |   \n=====\n```',
  '```\n +---+\n  O   \n  |   \n  |   \n  |   \n=====\n```',
  '```\n +---+\n  O   \n /|   \n  |   \n  |   \n=====\n```',
  '```\n +---+\n  O   \n /|\\  \n  |   \n  |   \n=====\n```',
  '```\n +---+\n  O   \n /|\\  \n / \\  \n      \n=====\n```',
];

export function buildHangmanEmbed(game: HangmanGame): EmbedBuilder {
  const missesArr = game.misses ? game.misses.split('') : [];
  const stageIdx = Math.min(
    missesArr.length,
    Math.max(0, Math.floor((missesArr.length / game.maxMisses) * (STAGES.length - 1))),
  );
  const stage = STAGES[Math.min(stageIdx, STAGES.length - 1)] ?? STAGES[0];

  const revealedDisplay = [...game.revealed]
    .map((c) => (c === '_' ? '\\_' : c === ' ' ? '   ' : c))
    .join(' ');

  const statusLine =
    game.status === 'won'
      ? `🎉 **Solved!** The word was **${game.word}**.`
      : game.status === 'lost'
        ? `💀 **Out of guesses.** The word was **${game.word}**.`
        : game.status === 'abandoned'
          ? '🚪 Game abandoned.'
          : `**${missesArr.length}/${game.maxMisses}** misses`;

  return new EmbedBuilder()
    .setTitle('🪢 Hangman')
    .setColor(
      game.status === 'won' ? 0x57f287 : game.status === 'lost' ? 0xed4245 : 0x5865f2,
    )
    .setDescription(
      [
        stage ?? '',
        `Word: \`${revealedDisplay}\``,
        `Misses: ${missesArr.length ? missesArr.join(' ') : '—'}`,
        statusLine,
      ].join('\n'),
    )
    .setFooter({ text: `Host: ${game.hostId} · game ${game.id.slice(0, 8)}` });
}

export function buildHangmanComponents(game: HangmanGame): ActionRowBuilder<ButtonBuilder>[] {
  if (game.status !== 'active') return [];
  const guessed = new Set(
    [...game.misses, ...game.revealed.replace(/[ _]/g, '')].map((c) => c.toUpperCase()),
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < LETTERS.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let j = i; j < Math.min(i + 5, LETTERS.length); j++) {
      const letter = LETTERS[j];
      if (!letter) continue;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hm:g:${game.id}:${letter}`)
          .setLabel(letter)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(guessed.has(letter)),
      );
    }
    rows.push(row);
  }
  return rows;
}

export function hangmanMessagePayload(game: HangmanGame) {
  return {
    embeds: [buildHangmanEmbed(game)],
    components: buildHangmanComponents(game),
  };
}

export const hangman: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('hangman')
    .setDescription('Hangman mini-game.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a hangman round in this channel.')
        .addStringOption((o) =>
          o
            .setName('word')
            .setDescription('Word or short phrase. Letters and spaces only (Z is not guessable).')
            .setRequired(true)
            .setMaxLength(64),
        )
        .addIntegerOption((o) =>
          o
            .setName('max-misses')
            .setDescription('Max wrong guesses (default 6).')
            .setMinValue(1)
            .setMaxValue(20),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.channel) return;

    const word = interaction.options.getString('word', true);
    const maxMisses = interaction.options.getInteger('max-misses') ?? undefined;

    if (!/^[A-Za-z ]+$/.test(word)) {
      await interaction.reply({
        content: 'Word must contain only letters and spaces.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (/[Zz]/.test(word)) {
      await interaction.reply({
        content:
          'The letter **Z** cannot be guessed via buttons (Discord caps components at 25). Pick a word without Z.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const game = await api.createHangmanGame(interaction.guildId, {
        channelId: interaction.channel.id,
        hostId: interaction.user.id,
        word,
        ...(maxMisses !== undefined ? { maxMisses } : {}),
      });
      await interaction.reply(hangmanMessagePayload(game));
      const msg = await interaction.fetchReply();
      await api.updateHangmanGame(game.id, { messageId: msg.id });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to start hangman.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
