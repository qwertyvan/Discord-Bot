import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// One trivia round per channel at a time. Cleared when answered correctly
// or when the timeout fires.
interface ActiveRound {
  questionId: string;
  correctIndex: number;
  // Set of userIds who already answered to prevent double-claiming.
  answered: Set<string>;
  timeout: NodeJS.Timeout;
}

const ACTIVE: Map<string, ActiveRound> = new Map();
const ROUND_SECONDS = 30;

export function getActiveRound(channelId: string): ActiveRound | undefined {
  return ACTIVE.get(channelId);
}

export function clearActiveRound(channelId: string): void {
  const r = ACTIVE.get(channelId);
  if (r) {
    clearTimeout(r.timeout);
    ACTIVE.delete(channelId);
  }
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const trivia: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Trivia mini-game.')
    .setContexts(0)
    .addSubcommandGroup((g) =>
      g
        .setName('round')
        .setDescription('Start or manage a trivia round.')
        .addSubcommand((s) =>
          s
            .setName('ask')
            .setDescription('Ask a random question in this channel.')
            .addStringOption((o) =>
              o
                .setName('category')
                .setDescription('Limit to a category.')
                .setMaxLength(64),
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Top trivia scores in this server.'),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a trivia question (Manage Server).')
        .addStringOption((o) =>
          o
            .setName('prompt')
            .setDescription('The question prompt.')
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption((o) =>
          o
            .setName('choices')
            .setDescription('Pipe-separated choices, e.g. "Red|Blue|Green|Yellow".')
            .setRequired(true)
            .setMaxLength(1200),
        )
        .addIntegerOption((o) =>
          o
            .setName('correct')
            .setDescription('Index of the correct choice (0-based).')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(5),
        )
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Optional category.')
            .setMaxLength(64),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.channel) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'round' && sub === 'ask') {
        await handleAsk(interaction);
        return;
      }
      if (sub === 'leaderboard') {
        await handleLeaderboard(interaction);
        return;
      }
      if (sub === 'add') {
        await handleAdd(interaction);
        return;
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

async function handleAsk(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.channel) return;
  const channelId = interaction.channel.id;
  if (ACTIVE.has(channelId)) {
    await interaction.reply({
      content: '⏳ A trivia round is already running in this channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const category = interaction.options.getString('category') ?? undefined;
  let question;
  try {
    question = await api.randomTriviaQuestion(
      interaction.guildId,
      category ? { category } : {},
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      await interaction.reply({
        content: category
          ? `No trivia questions in category **${category}**.`
          : 'No trivia questions yet. Add some with `/trivia add`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw err;
  }

  const embed = new EmbedBuilder()
    .setTitle('🎯 Trivia')
    .setColor(0x5865f2)
    .setDescription(
      `**${question.prompt}**\n\n` +
        question.choices
          .map((c, i) => `**${LETTERS[i] ?? String(i + 1)}.** ${c}`)
          .join('\n'),
    )
    .setFooter({
      text: `${ROUND_SECONDS}s to answer${question.category ? ` · ${question.category}` : ''}`,
    });

  // Buttons: max 5 per row; we support up to 6 choices → at most 2 rows.
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < question.choices.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let j = i; j < Math.min(i + 5, question.choices.length); j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`tv:ans:${question.id}:${j}`)
          .setLabel(LETTERS[j] ?? String(j + 1))
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }

  await interaction.reply({ embeds: [embed], components: rows });
  const reply = (await interaction.fetchReply()) as Message;

  const timeout = setTimeout(() => {
    const round = ACTIVE.get(channelId);
    if (!round || round.questionId !== question.id) return;
    ACTIVE.delete(channelId);
    const answer = question.choices[question.correctIndex] ?? '';
    reply
      .edit({
        embeds: [
          embed.setFooter({
            text: `⏱ Time's up · answer: ${LETTERS[question.correctIndex] ?? ''}. ${answer}`,
          }),
        ],
        components: [],
      })
      .catch(() => {});
  }, ROUND_SECONDS * 1000);

  ACTIVE.set(channelId, {
    questionId: question.id,
    correctIndex: question.correctIndex,
    answered: new Set(),
    timeout,
  });
}

async function handleLeaderboard(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const { scores } = await api.listTriviaScores(interaction.guildId, 10);
  if (scores.length === 0) {
    await interaction.reply({
      content: 'No trivia scores yet.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('🏆 Trivia leaderboard')
    .setColor(0xfee75c)
    .setDescription(
      scores
        .map((s, i) => {
          const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
          return `**${i + 1}.** <@${s.userId}> — ${s.correct}/${s.total} (${pct}%)`;
        })
        .join('\n'),
    );
  await interaction.reply({
    embeds: [embed],
    allowedMentions: { users: [] },
  });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.memberPermissions) return;
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need Manage Server to add trivia questions.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const prompt = interaction.options.getString('prompt', true);
  const choicesRaw = interaction.options.getString('choices', true);
  const correctIndex = interaction.options.getInteger('correct', true);
  const category = interaction.options.getString('category') ?? undefined;

  const choices = choicesRaw
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (choices.length < 2 || choices.length > 6) {
    await interaction.reply({
      content: 'Provide between 2 and 6 pipe-separated choices.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (correctIndex >= choices.length) {
    await interaction.reply({
      content: `correct must be between 0 and ${choices.length - 1}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const created = await api.addTriviaQuestion(interaction.guildId, {
    prompt,
    choices,
    correctIndex,
    ...(category ? { category } : {}),
    createdBy: interaction.user.id,
  });
  await interaction.reply({
    content: `✅ Added trivia question \`${created.id.slice(0, 8)}\`${category ? ` in **${category}**` : ''}.`,
    flags: MessageFlags.Ephemeral,
  });
}
