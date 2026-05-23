import { EmbedBuilder, TimestampStyles, time, type User } from 'discord.js';
import type { MarketListing, ShopItemExt } from '@discord-bot/shared';

const STATUS_COLOR: Record<MarketListing['status'], number> = {
  active: 0x57f287,
  sold: 0x5865f2,
  cancelled: 0xed4245,
  expired: 0x747f8d,
};

const STATUS_LABEL: Record<MarketListing['status'], string> = {
  active: '🛒 Listing · Active',
  sold: '✅ Listing · Sold',
  cancelled: '🚫 Listing · Cancelled',
  expired: '⌛ Listing · Expired',
};

// Render a marketplace listing as a Discord embed. `seller` is optional; when
// omitted we fall back to a mention of the snowflake.
export function buildListingEmbed(
  listing: MarketListing,
  item: ShopItemExt | null,
  seller?: User | null,
): EmbedBuilder {
  const name = item?.name ?? listing.item?.name ?? '(unknown item)';
  const slug = item?.slug ?? listing.item?.slug ?? null;
  const embed = new EmbedBuilder()
    .setTitle(STATUS_LABEL[listing.status])
    .setColor(STATUS_COLOR[listing.status])
    .setDescription(
      [
        `**Item:** ${name}${slug ? ` \`${slug}\`` : ''}`,
        `**Quantity:** ×${listing.quantity}`,
        `**Price:** ${listing.priceCents.toLocaleString()}`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Seller',
        value: seller ? `${seller}` : `<@${listing.sellerId}>`,
        inline: true,
      },
      {
        name: listing.status === 'active' ? 'Expires' : 'Closed',
        value:
          listing.status === 'active'
            ? `${time(new Date(listing.expiresAt), TimestampStyles.RelativeTime)}`
            : listing.completedAt
              ? time(new Date(listing.completedAt), TimestampStyles.LongDateTime)
              : '—',
        inline: true,
      },
    );

  if (listing.status === 'sold' && listing.buyerId) {
    embed.addFields({
      name: 'Buyer',
      value: `<@${listing.buyerId}>`,
      inline: true,
    });
  }

  embed.setFooter({ text: `Listing ${listing.id}` });
  embed.setTimestamp(new Date(listing.listedAt));
  return embed;
}
