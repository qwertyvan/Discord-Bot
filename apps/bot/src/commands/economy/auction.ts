import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { AuctionStatus } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';
import { auctionMessagePayload } from '../../util/auction-render.js';

const STATUS_CHOICES: { name: string; value: AuctionStatus }[] = [
  { name: 'Active', value: 'active' },
  { name: 'Ended', value: 'ended' },
  { name: 'Cancelled', value: 'cancelled' },
];

export const auction: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('auction')
    .setDescription('Open-bid timed auctions for inventory items.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('List recent auctions in this guild.')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by status.')
            .addChoices(...STATUS_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('List one of your inventory items for auction.')
        .addStringOption((o) =>
          o
            .setName('item')
            .setDescription('Slug of the item to auction.')
            .setRequired(true)
            .setMaxLength(48),
        )
        .addIntegerOption((o) =>
          o
            .setName('quantity')
            .setDescription('How many to list.')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1000),
        )
        .addIntegerOption((o) =>
          o
            .setName('start-price')
            .setDescription('Starting price (in your guild currency).')
            .setRequired(true)
            .setMinValue(0),
        )
        .addStringOption((o) =>
          o
            .setName('duration')
            .setDescription('How long the auction runs (e.g. 30m, 6h, 2d).')
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('min-increment')
            .setDescription('Minimum bid increment (default 1).')
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('View an auction by id.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Auction id.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('bid')
        .setDescription('Place a bid on an auction.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Auction id.').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('amount')
            .setDescription('Bid amount (must beat the current bid + min increment).')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel one of your active auctions (only if no bids).')
        .addStringOption((o) =>
          o.setName('id').setDescription('Auction id.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'list') {
        const status =
          (interaction.options.getString('status') as AuctionStatus | null) ??
          undefined;
        const { auctions } = await api.listAuctions(
          interaction.guildId,
          status ? { status, limit: 20 } : { limit: 20 },
        );
        if (auctions.length === 0) {
          await interaction.reply({
            content: 'No auctions found.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Recent auctions')
          .setColor(0x5865f2)
          .setDescription(
            auctions
              .map((a) => {
                const marker =
                  a.status === 'active'
                    ? '🟢'
                    : a.status === 'ended'
                      ? '🏁'
                      : '🛑';
                const itemLabel = a.itemName ?? a.itemSlug ?? a.itemId;
                const bidLabel =
                  a.currentBidCents > 0
                    ? `bid ${a.currentBidCents.toLocaleString()}`
                    : `starts at ${a.startPriceCents.toLocaleString()}`;
                const when =
                  a.status === 'active'
                    ? `ends <t:${Math.floor(new Date(a.endsAt).getTime() / 1000)}:R>`
                    : `ended <t:${Math.floor(new Date(a.endsAt).getTime() / 1000)}:R>`;
                return `${marker} \`${a.id}\` · **${itemLabel}** ×${a.quantity} · ${bidLabel} · ${when}`;
              })
              .join('\n'),
          );
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'create') {
        const slug = interaction.options.getString('item', true).toLowerCase();
        const quantity = interaction.options.getInteger('quantity', true);
        const startPrice = interaction.options.getInteger('start-price', true);
        const durationRaw = interaction.options.getString('duration', true);
        const minIncrement =
          interaction.options.getInteger('min-increment') ?? 1;

        const durationMs = parseDuration(durationRaw);
        if (durationMs === null || durationMs < 60_000) {
          await interaction.reply({
            content:
              'Duration must look like `30m`, `6h`, or `2d` and be at least 1 minute.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Resolve the slug to an item id from the seller's inventory so we
        // can return a clearer error than the API's "item not found".
        const { entries } = await api.listInventoryExt(
          interaction.guildId,
          interaction.user.id,
        );
        const owned = entries.find(
          (e) => e.item?.slug === slug && e.quantity > 0,
        );
        if (!owned || !owned.item) {
          await interaction.editReply(`You don't own any \`${slug}\`.`);
          return;
        }
        if (owned.quantity < quantity) {
          await interaction.editReply(
            `You only own ${owned.quantity} × ${owned.item.name}.`,
          );
          return;
        }

        const created = await api.createAuction(interaction.guildId, {
          sellerId: interaction.user.id,
          itemId: owned.item.id,
          quantity,
          startPriceCents: startPrice,
          minIncrementCents: minIncrement,
          durationMs,
        });
        await interaction.editReply({
          content: `🔨 Auction listed — \`${created.id}\`. Ends <t:${Math.floor(new Date(created.endsAt).getTime() / 1000)}:R>.`,
          ...auctionMessagePayload(created),
        });
        return;
      }

      if (sub === 'view') {
        const id = interaction.options.getString('id', true);
        const a = await api.getAuction(interaction.guildId, id);
        await interaction.reply(auctionMessagePayload(a, a.bids ?? []));
        return;
      }

      if (sub === 'bid') {
        const id = interaction.options.getString('id', true);
        const amount = interaction.options.getInteger('amount', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await api.placeBid(interaction.guildId, id, {
          userId: interaction.user.id,
          amountCents: amount,
        });
        const note = result.extended
          ? ' (anti-snipe: timer extended by 60s)'
          : '';
        await interaction.editReply(
          `✅ Bid of ${amount.toLocaleString()} placed on \`${id}\`${note}.`,
        );
        return;
      }

      if (sub === 'cancel') {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await api.cancelAuction(interaction.guildId, id, interaction.user.id);
        await interaction.editReply(`🛑 Cancelled auction \`${id}\`.`);
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
