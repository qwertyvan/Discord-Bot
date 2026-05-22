import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { getCommandRegistry } from '../registry.js';

/**
 * Group entries from the registry by their `group` key and return a stable
 * alphabetised list. Building this lazily here (instead of caching at module
 * load) keeps /help in sync with any registry mutations that happen during
 * tests or hot reload.
 */
export function buildHelpGroups(): Map<string, { name: string; description: string }[]> {
  const reg = getCommandRegistry();
  const groups = new Map<string, { name: string; description: string }[]>();
  for (const entry of reg.entries) {
    const list = groups.get(entry.group) ?? [];
    list.push({
      name: entry.command.data.name,
      description: entry.command.data.description,
    });
    groups.set(entry.group, list);
  }
  // Sort commands within each group alphabetically for a predictable browsing
  // experience. The category order itself is preserved as inserted (matches
  // registry.ts order).
  for (const list of groups.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  moderation: 'Moderation',
  onboarding: 'Onboarding',
  leveling: 'Leveling',
  economy: 'Economy',
  tickets: 'Tickets',
  scheduled: 'Scheduled',
  community: 'Community',
  starboard: 'Starboard',
  'forum-stage': 'Forum & Stage',
  utility: 'Utility',
  fun: 'Fun',
  voice: 'Voice',
  audio: 'Audio',
  admin: 'Admin',
  minigames: 'Minigames',
  backup: 'Backup',
  music: 'Music',
  giveaways: 'Giveaways',
  integrations: 'Integrations',
  safety: 'Safety',
  templates: 'Templates',
  privacy: 'Privacy',
};

function labelFor(group: string): string {
  return CATEGORY_LABELS[group] ?? group;
}

/**
 * Builds the embed showing all commands in a given category. Used both for
 * the initial /help response (when a category is selected) and when the
 * string-select component edits the message.
 */
export function buildCategoryEmbed(group: string): EmbedBuilder {
  const groups = buildHelpGroups();
  const list = groups.get(group) ?? [];
  const label = labelFor(group);
  const embed = new EmbedBuilder()
    .setTitle(`Help — ${label}`)
    .setColor(0x5865f2);
  if (list.length === 0) {
    embed.setDescription('No commands in this category.');
    return embed;
  }
  const description = list
    .map((c) => `\`/${c.name}\` — ${c.description}`)
    .join('\n')
    .slice(0, 4000);
  embed.setDescription(description);
  return embed;
}

/**
 * Builds the index embed listing every category with the count of commands
 * inside. The string-select menu beneath it lets the invoker drill down.
 */
export function buildOverviewEmbed(): EmbedBuilder {
  const groups = buildHelpGroups();
  const lines: string[] = [];
  for (const [group, list] of groups) {
    lines.push(`**${labelFor(group)}** — ${list.length} command${list.length === 1 ? '' : 's'}`);
  }
  return new EmbedBuilder()
    .setTitle('Help')
    .setDescription(
      [
        'Pick a category from the menu below to see the commands inside.',
        'Tip: `/help command:<name>` jumps straight to a single command.',
        '',
        ...lines,
      ].join('\n'),
    )
    .setColor(0x5865f2);
}

export function buildCategorySelect(currentGroup?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const groups = buildHelpGroups();
  const select = new StringSelectMenuBuilder()
    .setCustomId('help:cat')
    .setPlaceholder('Choose a category…');
  // Discord caps select menus at 25 options. The registry currently has 23
  // categories so we're safely under, but slice defensively in case more are
  // added later.
  const entries = [...groups.keys()].slice(0, 25);
  for (const group of entries) {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(labelFor(group))
      .setValue(group)
      .setDescription(`${groups.get(group)?.length ?? 0} commands`);
    if (currentGroup === group) option.setDefault(true);
    select.addOptions(option);
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildCommandEmbed(name: string): EmbedBuilder | null {
  const reg = getCommandRegistry();
  const entry = reg.entries.find((e) => e.command.data.name === name);
  if (!entry) return null;
  const data = entry.command.data;
  const embed = new EmbedBuilder()
    .setTitle(`/${data.name}`)
    .setDescription(data.description)
    .setColor(0x5865f2)
    .addFields({ name: 'Category', value: labelFor(entry.group), inline: true });
  // The builder JSON includes nested options/subcommands; surface them so the
  // user sees the full surface area without us re-implementing the rendering
  // Discord already does in the slash UI.
  const json = data.toJSON() as { options?: Array<{ name: string; description: string; type: number }> };
  if (json.options && json.options.length > 0) {
    embed.addFields({
      name: 'Options / Subcommands',
      value: json.options
        .map((o) => `\`${o.name}\` — ${o.description}`)
        .join('\n')
        .slice(0, 1024),
    });
  }
  return embed;
}

export const help: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse every command in the bot, grouped by category.')
    .addStringOption((o) =>
      o
        .setName('command')
        .setDescription('Jump directly to a single command by name.')
        .setRequired(false)
        .setAutocomplete(false),
    ),
  async execute(interaction) {
    const target = interaction.options.getString('command');
    if (target) {
      const embed = buildCommandEmbed(target.replace(/^\//, ''));
      if (!embed) {
        await interaction.reply({
          content: `Unknown command: \`${target}\`. Use \`/help\` to browse categories.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      embeds: [buildOverviewEmbed()],
      components: [buildCategorySelect()],
      flags: MessageFlags.Ephemeral,
    });
  },
};
