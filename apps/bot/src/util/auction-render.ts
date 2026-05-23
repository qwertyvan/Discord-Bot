import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TimestampStyles,
  time,
} from 'discord.js';
import type { Auction, AuctionBid } from '@discord-bot/shared';

const STATUS_COLOR: Record<Auction['status'], number> = {
  active: 0x5865f2,
  ended: 0x57f287,
  cancelled: 0xed4245,
};

const STATUS_LABEL: Record<Auction['status'], string> = {
  active: '🔨 Auction',
  ended: '🏁 Auction · Ended',
  cancelled: '🛑 Auction · Cancelled',
};

function formatAmount(n: number): string {
  return n.toLocaleString();
}

export function buildAuctionEmbed(a: Auction, bids: AuctionBid[]): EmbedBuilder {
  const endsAt = new Date(a.endsAt);
  const itemName = a.itemName ?? a.itemSlug ?? a.itemId;
  const embed = new EmbedBuilder()
    .setTitle(STATUS_LABEL[a.status])
    .setColor(STATUS_COLOR[a.status])
    .setDescription(
      `**Item:** ${itemName} × ${a.quantity}\n**Seller:** <@${a.sellerId}>`,
    )
    .addFields(
      {
        name: a.status === 'active' ? 'Ends' : 'Ended',
        value:
          a.status === 'active'
            ? `${time(endsAt, TimestampStyles.LongDateTime)} (${time(endsAt, TimestampStyles.RelativeTime)})`
            : time(endsAt, TimestampStyles.LongDateTime),
        inline: true,
      },
      {
        name: 'Current bid',
        value:
          a.currentBidCents > 0
            ? `${formatAmount(a.currentBidCents)} — <@${a.currentBidderId ?? '0'}>`
            : `*(no bids — starts at ${formatAmount(a.startPriceCents)})*`,
        inline: true,
      },
      {
        name: 'Min increment',
        value: formatAmount(a.minIncrementCents),
        inline: true,
      },
    );

  if (bids.length > 0) {
    const lines = bids.slice(0, 10).map((b) => {
      const stamp = time(new Date(b.placedAt), TimestampStyles.RelativeTime);
      const marker = b.refundedAt ? '↩️' : '•';
      return `${marker} <@${b.userId}> · ${formatAmount(b.amountCents)} (${stamp})`;
    });
    embed.addFields({ name: 'Recent bids', value: lines.join('\n') });
  }

  if (a.status === 'ended' && a.currentBidderId) {
    embed.addFields({
      name: 'Winner',
      value: `<@${a.currentBidderId}> — ${formatAmount(a.currentBidCents)}`,
    });
  } else if (a.status === 'ended') {
    embed.addFields({ name: 'Winner', value: '*No bids — item returned to seller.*' });
  } else if (a.status === 'cancelled') {
    embed.addFields({ name: 'Status', value: 'This auction was cancelled.' });
  }

  embed.setFooter({ text: `Auction ${a.id}` });
  embed.setTimestamp(new Date(a.createdAt));
  return embed;
}

// Build the quick-bid buttons. The "+min" button bids exactly minIncrement
// above the current high bid (or startPrice if no bids yet). The "+5×min"
// button bids 5× the min increment above. The third button opens a custom
// amount modal.
export function buildAuctionButtons(
  a: Auction,
): ActionRowBuilder<ButtonBuilder>[] {
  if (a.status !== 'active') return [];
  const base =
    a.currentBidCents > 0 ? a.currentBidCents : a.startPriceCents;
  const oneStep =
    a.currentBidCents > 0 ? base + a.minIncrementCents : base;
  const fiveStep =
    a.currentBidCents > 0
      ? base + a.minIncrementCents * 5
      : base + a.minIncrementCents * 4;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`auc:bid:${a.id}:${oneStep}`)
        .setLabel(`Bid ${formatAmount(oneStep)}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`auc:bid:${a.id}:${fiveStep}`)
        .setLabel(`Bid ${formatAmount(fiveStep)}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`auc:bid-custom:${a.id}`)
        .setLabel('Custom bid')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function auctionMessagePayload(a: Auction, bids: AuctionBid[] = []) {
  return {
    embeds: [buildAuctionEmbed(a, bids)],
    components: buildAuctionButtons(a),
  };
}
