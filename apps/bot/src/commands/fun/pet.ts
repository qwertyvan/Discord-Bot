import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import type { ServerPet, TopFeederEntry } from '@discord-bot/shared';
import { api, ApiError } from '../../api-client.js';
import {
  PET_MOOD_EMOJI,
  PET_STAGE_EMOJI,
  moodColor,
  petMood,
  stageProgress,
  statBar,
} from '../../util/pet-state.js';

const FALLBACK_CURRENCY_NAME = 'coins';
const FALLBACK_CURRENCY_SYMBOL = '🪙';

async function fetchEconomyMeta(guildId: string): Promise<{ name: string; symbol: string }> {
  try {
    const cfg = await api.getEconomyConfig(guildId);
    return { name: cfg.currencyName, symbol: cfg.currencySymbol };
  } catch {
    return { name: FALLBACK_CURRENCY_NAME, symbol: FALLBACK_CURRENCY_SYMBOL };
  }
}

export const pet: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('pet')
    .setDescription('The server pet — feed it, play with it, watch it grow.')
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('status').setDescription('Show the server pet card.'),
    )
    .addSubcommand((s) =>
      s
        .setName('feed')
        .setDescription('Feed the pet (costs currency).')
        .addIntegerOption((o) =>
          o
            .setName('amount')
            .setDescription('How much to spend feeding the pet.')
            .setMinValue(1)
            .setMaxValue(10000),
        ),
    )
    .addSubcommand((s) =>
      s.setName('play').setDescription('Play with the pet — boosts happiness.'),
    )
    .addSubcommand((s) =>
      s.setName('pet').setDescription('Pet the pet (once per day). Small XP bonus.'),
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename the server pet (Manage Server).')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('New pet name.')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(48),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    try {
      if (sub === 'status') {
        const [petData, top, money] = await Promise.all([
          api.getServerPet(guildId),
          api.topPetFeeder(guildId, 5).catch(() => ({ guildId, entries: [] as const })),
          fetchEconomyMeta(guildId),
        ]);
        const embed = buildStatusEmbed(petData, top.entries, money);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (sub === 'feed') {
        const money = await fetchEconomyMeta(guildId);
        const amount = interaction.options.getInteger('amount') ?? 10;
        const result = await api.feedPet(guildId, interaction.user.id, amount);
        const mood = petMood(result.pet);
        const embed = new EmbedBuilder()
          .setColor(moodColor(mood))
          .setTitle(`${PET_STAGE_EMOJI[result.pet.stage]} ${result.pet.name} chomps happily`)
          .setDescription(
            [
              `You spent **${money.symbol} ${amount.toLocaleString()}** ${money.name}.`,
              `Pet gained **+${result.xpAwarded} XP**.`,
              result.newBalance !== null
                ? `Your balance: **${money.symbol} ${result.newBalance.toLocaleString()}**`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .addFields(statFields(result.pet));
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (sub === 'play') {
        const result = await api.playWithPet(guildId, interaction.user.id);
        const mood = petMood(result.pet);
        const embed = new EmbedBuilder()
          .setColor(moodColor(mood))
          .setTitle(`${PET_STAGE_EMOJI[result.pet.stage]} ${result.pet.name} romps around!`)
          .setDescription(`Pet gained **+${result.xpAwarded} XP** and is a bit more tired.`)
          .addFields(statFields(result.pet));
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (sub === 'pet') {
        const result = await api.petPet(guildId, interaction.user.id);
        const mood = petMood(result.pet);
        const embed = new EmbedBuilder()
          .setColor(moodColor(mood))
          .setTitle(`${PET_STAGE_EMOJI[result.pet.stage]} You give ${result.pet.name} a head scritch.`)
          .setDescription(`Pet gained **+${result.xpAwarded} XP**. See you tomorrow!`)
          .addFields(statFields(result.pet));
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (sub === 'rename') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: 'You need Manage Server to rename the pet.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const name = interaction.options.getString('name', true);
        const renamed = await api.renamePet(guildId, { name });
        await interaction.reply({
          content: `🪄 Pet renamed to **${renamed.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Pet command failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};

function statFields(p: { hunger: number; happiness: number; energy: number }) {
  return [
    { name: 'Hunger', value: `${statBar(p.hunger)} ${p.hunger}`, inline: true },
    { name: 'Happiness', value: `${statBar(p.happiness)} ${p.happiness}`, inline: true },
    { name: 'Energy', value: `${statBar(p.energy)} ${p.energy}`, inline: true },
  ];
}

function buildStatusEmbed(
  petData: ServerPet,
  feeders: ReadonlyArray<TopFeederEntry>,
  money: { name: string; symbol: string },
): EmbedBuilder {
  const mood = petMood(petData);
  const prog = stageProgress(petData.xp);
  const xpLine =
    prog.next === null
      ? `**XP** ${petData.xp.toLocaleString()} (max stage)`
      : `**XP** ${petData.xp.toLocaleString()} — ${prog.inStage}/${prog.spanStage} to next stage`;
  const topLine =
    feeders.length === 0
      ? '_No one has fed the pet in the last 24 hours._'
      : feeders
          .slice(0, 3)
          .map(
            (f, i) =>
              `**${i + 1}.** <@${f.userId}> — ${money.symbol} ${f.currencySpent.toLocaleString()} (${f.interactions}x)`,
          )
          .join('\n');

  return new EmbedBuilder()
    .setColor(moodColor(mood))
    .setTitle(`${PET_STAGE_EMOJI[petData.stage]} ${petData.name}`)
    .setDescription(
      [
        `**Stage** ${petData.stage}  ·  **Mood** ${PET_MOOD_EMOJI[mood]} ${mood}`,
        xpLine,
      ].join('\n'),
    )
    .addFields(
      ...statFields(petData),
      { name: 'Top feeders (24h)', value: topLine, inline: false },
    );
}
