import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import {
  buildCastEmbed,
  buildSkillEmbed,
} from '../../util/fishing-render.js';

// The cast timer lives server-side; we mirror the same constant here so
// the bot can enable the button after the wait. If the constants ever
// drift, the API still gates resolve via the resolved/stale checks.
const CAST_DURATION_MS = 30_000;

function reelButton(castId: string, enabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`fish:reel:${castId}`)
      .setLabel(enabled ? 'Reel in' : 'Waiting…')
      .setEmoji('🎣')
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!enabled),
  );
}

export const fish: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('fish')
    .setDescription('Cast a line, build a fishing skill, and reel in rare catches.')
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('cast').setDescription('Cast a line. Reel in after 30 seconds.'),
    )
    .addSubcommand((s) =>
      s
        .setName('skill')
        .setDescription('Show fishing skill / level.')
        .addUserOption((o) =>
          o.setName('user').setDescription('Defaults to you.'),
        ),
    )
    .addSubcommand((s) => s.setName('drops').setDescription('List the guild\'s fishing drops.'))
    .addSubcommandGroup((g) =>
      g
        .setName('admin')
        .setDescription('Admin: manage the fishing drop table.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a fishing drop (ManageGuild).')
            .addStringOption((o) =>
              o
                .setName('slug')
                .setDescription('Stable identifier (kebab/snake, ≤48 chars).')
                .setRequired(true)
                .setMaxLength(48),
            )
            .addStringOption((o) =>
              o
                .setName('name')
                .setDescription('Display name shown on catch.')
                .setRequired(true)
                .setMaxLength(120),
            )
            .addStringOption((o) =>
              o.setName('emoji').setDescription('Emoji shown on catch (default 🐟).').setMaxLength(64),
            )
            .addStringOption((o) =>
              o
                .setName('item-slug')
                .setDescription('Optional shop-item slug to deposit on catch.')
                .setMaxLength(48),
            )
            .addIntegerOption((o) =>
              o
                .setName('min-level')
                .setDescription('Skill level required to roll this drop (default 1).')
                .setMinValue(1)
                .setMaxValue(99),
            )
            .addIntegerOption((o) =>
              o
                .setName('weight')
                .setDescription('Selection weight (default 10).')
                .setMinValue(1)
                .setMaxValue(10_000),
            )
            .addIntegerOption((o) =>
              o
                .setName('currency-min')
                .setDescription('Min currency awarded (default 0).')
                .setMinValue(0),
            )
            .addIntegerOption((o) =>
              o
                .setName('currency-max')
                .setDescription('Max currency awarded (default 0).')
                .setMinValue(0),
            )
            .addIntegerOption((o) =>
              o
                .setName('xp')
                .setDescription('XP awarded on catch (default 5).')
                .setMinValue(0)
                .setMaxValue(10_000),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a fishing drop by slug (ManageGuild).')
            .addStringOption((o) =>
              o.setName('slug').setDescription('Drop slug.').setRequired(true).setMaxLength(48),
            ),
        )
        .addSubcommand((s) =>
          s.setName('seed').setDescription('Insert the stock drop table (ManageGuild).'),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'admin') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: 'You need Manage Server to use `/fish admin`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await handleAdmin(interaction, sub);
      return;
    }

    try {
      if (sub === 'cast') {
        const cast = await api.castFishingLine(interaction.guildId, interaction.user.id);
        // Initial reply (disabled button). We'll edit it once the timer ends.
        await interaction.reply({
          embeds: [buildCastEmbed(cast)],
          components: [reelButton(cast.id, false)],
          flags: MessageFlags.Ephemeral,
        });
        // Wait the 30s server-side timer, then enable the "Reel in" button.
        // Auto-resolve in the scheduler will also catch abandoned casts, so
        // there's no harm if the user dismisses the ephemeral reply.
        const start = new Date(cast.startedAt).getTime();
        const elapsed = Date.now() - start;
        const wait = Math.max(0, CAST_DURATION_MS - elapsed);
        setTimeout(() => {
          interaction
            .editReply({
              embeds: [buildCastEmbed(cast)],
              components: [reelButton(cast.id, true)],
            })
            .catch(() => undefined);
        }, wait);
        return;
      }

      if (sub === 'skill') {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const skill = await api.getFishingSkill(interaction.guildId, target.id);
        await interaction.reply({
          embeds: [buildSkillEmbed(skill, target.displayName)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'drops') {
        const { drops } = await api.listFishingDrops(interaction.guildId);
        if (drops.length === 0) {
          await interaction.reply({
            content:
              'No fishing drops configured. Ask a mod to run `/fish admin seed`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = drops.map((d) => {
          const currency =
            d.currencyMax > 0 || d.currencyMin > 0
              ? ` · ${d.currencyMin}-${d.currencyMax} 💰`
              : '';
          return `${d.emoji} **${d.name}** \`${d.slug}\` · min lvl ${d.minLevel} · weight ${d.weight}${currency} · +${d.xpReward} xp`;
        });
        // Truncate to fit comfortably inside an embed description; the full
        // list still scrolls in the embed.
        const embed = new EmbedBuilder()
          .setTitle('🎣 Fishing drops')
          .setColor(0x5dade2)
          .setDescription(lines.join('\n').slice(0, 4000));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Fishing failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  },
};

async function handleAdmin(
  interaction: Parameters<SlashCommand['execute']>[0],
  sub: string,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  try {
    if (sub === 'add') {
      const slug = interaction.options.getString('slug', true).toLowerCase();
      const name = interaction.options.getString('name', true);
      const emoji = interaction.options.getString('emoji') ?? '🐟';
      const itemSlug = interaction.options.getString('item-slug');
      const minLevel = interaction.options.getInteger('min-level') ?? 1;
      const weight = interaction.options.getInteger('weight') ?? 10;
      const currencyMin = interaction.options.getInteger('currency-min') ?? 0;
      const currencyMax = interaction.options.getInteger('currency-max') ?? 0;
      const xp = interaction.options.getInteger('xp') ?? 5;

      let itemId: string | null = null;
      if (itemSlug) {
        // Resolve slug → id through the extended shop endpoint.
        const { items } = await api.listShopItems(interaction.guildId, { includeDisabled: true });
        const match = items.find((i) => i.slug === itemSlug);
        if (!match) {
          await interaction.reply({
            content: `No shop item with slug \`${itemSlug}\` in this guild.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        itemId = match.id;
      }

      const drop = await api.createFishingDrop(interaction.guildId, {
        slug,
        name,
        emoji,
        minLevel,
        weight,
        currencyMin,
        currencyMax,
        xpReward: xp,
        enabled: true,
        ...(itemId ? { itemId } : {}),
      });
      await interaction.reply({
        content: `✅ Added drop **${drop.name}** (\`${drop.slug}\`).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove') {
      const slug = interaction.options.getString('slug', true).toLowerCase();
      const { drops } = await api.listFishingDrops(interaction.guildId);
      const drop = drops.find((d) => d.slug === slug);
      if (!drop) {
        await interaction.reply({
          content: `No drop with slug \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await api.deleteFishingDrop(interaction.guildId, drop.id);
      await interaction.reply({
        content: `🗑️ Removed **${drop.name}** (\`${slug}\`).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'seed') {
      const { inserted, total } = await api.seedFishingDrops(interaction.guildId);
      await interaction.reply({
        content: `🐟 Seeded ${inserted} new drop${inserted === 1 ? '' : 's'} (table size: ${total}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Admin command failed.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
