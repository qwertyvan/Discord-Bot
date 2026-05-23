import {
  ActionRowBuilder,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { buildListingEmbed } from '../../util/listing-render.js';

// `/market` — peer-to-peer item trades. The marketplace endpoint enforces
// tenure / cap rules and escrows items at creation; the bot side stays
// stateless and just translates Discord input.
export const market: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('Peer-to-peer item marketplace.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Browse active listings.')
        .addStringOption((o) =>
          o.setName('item').setDescription('Filter by item slug.').setMaxLength(48),
        )
        .addUserOption((o) =>
          o.setName('seller').setDescription('Filter by seller.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('sell')
        .setDescription('Create a listing from your inventory.')
        .addStringOption((o) =>
          o
            .setName('item')
            .setDescription('Slug of the item to sell (from your inventory).')
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
            .setName('price')
            .setDescription('Total price (in your guild currency).')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1_000_000_000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('buy')
        .setDescription('Confirm a purchase from an active listing.')
        .addStringOption((o) =>
          o
            .setName('listing-id')
            .setDescription('Listing UUID (see /market list).')
            .setRequired(true)
            .setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel one of your active listings.')
        .addStringOption((o) =>
          o
            .setName('listing-id')
            .setDescription('Listing UUID.')
            .setRequired(true)
            .setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s.setName('mine').setDescription('Show your active listings.'),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Marketplace admin (ManageGuild).')
        .addSubcommand((s) =>
          s
            .setName('config')
            .setDescription('Enable/disable marketplace + tenure/cap config.')
            .addBooleanOption((o) =>
              o.setName('enabled').setDescription('Allow new listings.'),
            )
            .addIntegerOption((o) =>
              o
                .setName('min-tenure-days')
                .setDescription('Min days in server before listing.')
                .setMinValue(0)
                .setMaxValue(365),
            )
            .addIntegerOption((o) =>
              o
                .setName('max-active-per-user')
                .setDescription('Concurrent listings cap per user.')
                .setMinValue(1)
                .setMaxValue(100),
            ),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const guildId = interaction.guildId;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'admin' && sub === 'config') {
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: 'You need ManageGuild to edit marketplace config.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const enabled = interaction.options.getBoolean('enabled');
        const minTenureDays = interaction.options.getInteger('min-tenure-days');
        const maxActive = interaction.options.getInteger('max-active-per-user');
        const body: Parameters<typeof api.upsertMarketConfig>[1] = {};
        if (enabled !== null) body.enabled = enabled;
        if (minTenureDays !== null) body.minTenureDays = minTenureDays;
        if (maxActive !== null) body.maxActiveListingsPerUser = maxActive;

        const cfg = await api.upsertMarketConfig(guildId, body);
        const embed = new EmbedBuilder()
          .setTitle('Marketplace config')
          .setColor(0x5865f2)
          .addFields(
            { name: 'Enabled', value: cfg.enabled ? 'yes' : 'no', inline: true },
            {
              name: 'Min tenure (days)',
              value: String(cfg.minTenureDays),
              inline: true,
            },
            {
              name: 'Max active per user',
              value: String(cfg.maxActiveListingsPerUser),
              inline: true,
            },
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'list') {
        const itemSlug = interaction.options.getString('item')?.toLowerCase();
        const seller = interaction.options.getUser('seller');
        const { listings } = await api.listListings(guildId, {
          status: 'active',
          ...(itemSlug ? { itemSlug } : {}),
          ...(seller ? { sellerId: seller.id } : {}),
          limit: 25,
        });
        if (listings.length === 0) {
          await interaction.reply({
            content: 'No active listings match those filters.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Market — ${listings.length} active listing(s)`)
          .setColor(0x57f287)
          .setDescription(
            listings
              .map((l, i) => {
                const name = l.item?.name ?? '(unknown)';
                const slug = l.item?.slug ? ` \`${l.item.slug}\`` : '';
                return `**${i + 1}.** ×${l.quantity} ${name}${slug} — **${l.priceCents.toLocaleString()}** · seller <@${l.sellerId}> · \`${l.id.slice(0, 8)}\``;
              })
              .join('\n'),
          )
          .setFooter({ text: 'Pick a listing below to view details.' });

        const select = new StringSelectMenuBuilder()
          .setCustomId(`market:view`)
          .setPlaceholder('View a listing')
          .addOptions(
            listings.slice(0, 25).map((l) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  `×${l.quantity} ${l.item?.name ?? '(unknown)'} — ${l.priceCents.toLocaleString()}`.slice(
                    0,
                    100,
                  ),
                )
                .setValue(l.id)
                .setDescription(`id: ${l.id.slice(0, 8)}`),
            ),
          );
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          select,
        );
        await interaction.reply({
          embeds: [embed],
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'mine') {
        const { listings } = await api.listListings(guildId, {
          status: 'active',
          sellerId: interaction.user.id,
        });
        if (listings.length === 0) {
          await interaction.reply({
            content: 'You have no active listings.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = listings.map((l) => {
          const name = l.item?.name ?? '(unknown)';
          return `- \`${l.id.slice(0, 8)}\` · ×${l.quantity} **${name}** — ${l.priceCents.toLocaleString()}`;
        });
        const embed = new EmbedBuilder()
          .setTitle('Your active listings')
          .setColor(0xfee75c)
          .setDescription(lines.join('\n'));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'sell') {
        const slug = interaction.options.getString('item', true).toLowerCase();
        const quantity = interaction.options.getInteger('quantity', true);
        const price = interaction.options.getInteger('price', true);

        // Resolve the slug locally against the seller's inventory so we can
        // give a clean error if they don't own it.
        const { entries } = await api.listInventoryExt(
          guildId,
          interaction.user.id,
        );
        const owned = entries.find(
          (e) => e.item?.slug === slug && e.quantity > 0,
        );
        if (!owned || !owned.item) {
          await interaction.reply({
            content: `You don't own any \`${slug}\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (owned.quantity < quantity) {
          await interaction.reply({
            content: `You only own ${owned.quantity} × ${owned.item.name}.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // The API needs the seller's join date to enforce minTenureDays.
        // We pull it from the GuildMember; fall back to "now" only if the
        // member object is unavailable (which the API will then reject).
        let sellerJoinedAt = new Date().toISOString();
        if (interaction.member instanceof GuildMember && interaction.member.joinedAt) {
          sellerJoinedAt = interaction.member.joinedAt.toISOString();
        }

        const listing = await api.createListing(guildId, {
          sellerId: interaction.user.id,
          itemId: owned.item.id,
          quantity,
          priceCents: price,
          sellerJoinedAt,
        });
        const embed = buildListingEmbed(listing, owned.item, interaction.user);
        await interaction.reply({
          content: `🛒 Listed ×${quantity} **${owned.item.name}** for ${price.toLocaleString()}.`,
          embeds: [embed],
        });
        return;
      }

      if (sub === 'buy') {
        const id = interaction.options.getString('listing-id', true);
        const listing = await api.buyListing(guildId, id, interaction.user.id);
        const embed = buildListingEmbed(listing, listing.item ?? null, null);
        await interaction.reply({
          content: `✅ Purchased ×${listing.quantity} **${listing.item?.name ?? 'item'}** for ${listing.priceCents.toLocaleString()}.`,
          embeds: [embed],
        });
        return;
      }

      if (sub === 'cancel') {
        const id = interaction.options.getString('listing-id', true);
        const listing = await api.cancelListing(guildId, id, interaction.user.id);
        const embed = buildListingEmbed(listing, listing.item ?? null, interaction.user);
        await interaction.reply({
          content: `🚫 Cancelled. ×${listing.quantity} **${listing.item?.name ?? 'item'}** returned to your inventory.`,
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
