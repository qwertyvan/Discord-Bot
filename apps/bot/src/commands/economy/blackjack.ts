import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type { BlackjackState } from '@discord-bot/shared';

function renderCards(cards: BlackjackState['playerHand']): string {
  if (cards.length === 0) return '—';
  return cards
    .map((c) => {
      const r =
        c.rank === 1
          ? 'A'
          : c.rank === 11
            ? 'J'
            : c.rank === 12
              ? 'Q'
              : c.rank === 13
                ? 'K'
                : String(c.rank);
      return `${r}${c.suit}`;
    })
    .join(' ');
}

function statusLine(state: BlackjackState, currencySymbol: string): string {
  switch (state.status) {
    case 'active':
      return 'Hit or stand?';
    case 'player-bust':
      return `Bust! Lost ${state.bet.toLocaleString()} ${currencySymbol}.`;
    case 'dealer-bust':
      return `Dealer busts. You win ${state.bet.toLocaleString()} ${currencySymbol}.`;
    case 'player-win':
      return `You win ${state.bet.toLocaleString()} ${currencySymbol}.`;
    case 'dealer-win':
      return `Dealer wins. Lost ${state.bet.toLocaleString()} ${currencySymbol}.`;
    case 'push':
      return `Push — bet refunded.`;
    case 'blackjack':
      return `Blackjack! Paid ${Math.floor(state.bet * 1.5).toLocaleString()} ${currencySymbol} at 3:2.`;
  }
}

export function renderBlackjack(
  state: BlackjackState,
  currencySymbol: string,
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  const dealerCards =
    state.status === 'active' ? state.dealerVisible : state.dealerHand;
  const dealerTotalLabel =
    state.status === 'active'
      ? `${state.dealerTotal}+?`
      : String(state.dealerTotal);
  const embed = new EmbedBuilder()
    .setTitle('Blackjack')
    .setColor(0x2ecc71)
    .addFields(
      {
        name: `Your hand (${state.playerTotal})`,
        value: renderCards(state.playerHand),
      },
      {
        name: `Dealer (${dealerTotalLabel})`,
        value: renderCards(dealerCards),
      },
    )
    .setFooter({ text: statusLine(state, currencySymbol) });
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (state.status === 'active') {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`bj:hit:${state.gameId}`)
          .setLabel('Hit')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`bj:stand:${state.gameId}`)
          .setLabel('Stand')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { embed, components };
}

export const blackjack: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Bet on a hand of blackjack.')
    .setContexts(0)
    .addIntegerOption((o) =>
      o
        .setName('bet')
        .setDescription('Amount to wager.')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const bet = interaction.options.getInteger('bet', true);
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const { state } = await api.blackjackStart(interaction.guildId, {
        userId: interaction.user.id,
        bet,
      });
      const { embed, components } = renderBlackjack(state, cfg.currencySymbol);
      await interaction.reply({ embeds: [embed], components });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
