import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type APIMessageComponentEmoji,
  type TextChannel,
} from 'discord.js';
import type { ReactionRolePanel } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

/**
 * Build the components (button rows or a select menu) that drive a reaction
 * role panel. Buttons are used when <= 5 options and `useDropdown` is false;
 * otherwise a single-select dropdown.
 */
export function buildPanelComponents(panel: ReactionRolePanel) {
  const opts = [...panel.options].sort((a, b) => a.position - b.position);
  if (panel.useDropdown || opts.length > 5) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rr:select:${panel.id}`)
      .setPlaceholder('Pick a role…')
      .setMinValues(0)
      .setMaxValues(panel.exclusive ? 1 : opts.length);
    for (const o of opts) {
      const option = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.id);
      if (o.description) option.setDescription(o.description);
      const emoji = parseEmoji(o.emoji);
      if (emoji) option.setEmoji(emoji);
      select.addOptions(option);
    }
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const o of opts) {
    const button = new ButtonBuilder()
      .setCustomId(`rr:button:${panel.id}:${o.id}`)
      .setLabel(o.label)
      .setStyle(ButtonStyle.Secondary);
    const emoji = parseEmoji(o.emoji);
    if (emoji) button.setEmoji(emoji);
    row.addComponents(button);
  }
  return [row];
}

function parseEmoji(raw: string | null): APIMessageComponentEmoji | null {
  if (!raw) return null;
  const custom = /^<(a)?:([\w_]+):(\d+)>$/.exec(raw);
  if (custom) {
    return { id: custom[3]!, name: custom[2]!, animated: custom[1] === 'a' };
  }
  return { name: raw };
}

export const rolePanel: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('role-panel')
    .setDescription('Manage reaction-role panels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('List configured panels.'),
    )
    .addSubcommand((s) =>
      s
        .setName('post')
        .setDescription('Publish a panel to its configured channel.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Panel name.').setRequired(true).setAutocomplete(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      try {
        const { panels } = await api.listReactionRolePanels(interaction.guildId);
        if (panels.length === 0) {
          await interaction.reply({
            content: 'No panels configured. Create one in the dashboard.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Reaction-role panels')
          .setColor(0x5865f2)
          .setDescription(panels.map((p) => `• **${p.name}** — <#${p.channelId}> · ${p.options.length} option${p.options.length === 1 ? '' : 's'}${p.messageId ? '' : ' *(not posted)*'}`).join('\n'));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed.';
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'post') {
      const name = interaction.options.getString('name', true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { panels } = await api.listReactionRolePanels(interaction.guildId);
        const panel = panels.find((p) => p.name === name);
        if (!panel) {
          await interaction.editReply(`No panel named "${name}".`);
          return;
        }
        const channel = interaction.guild.channels.cache.get(panel.channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.editReply('Configured channel is missing or not a text channel.');
          return;
        }
        const components = buildPanelComponents(panel);
        const embed = new EmbedBuilder()
          .setTitle(panel.name)
          .setColor(0x5865f2)
          .setDescription(panel.description ?? 'Pick a role below.');
        const message = await (channel as TextChannel).send({ embeds: [embed], components });
        await api.updateReactionRolePanel(interaction.guildId, panel.id, { messageId: message.id });
        await interaction.editReply(`✅ Posted **${panel.name}** in ${channel}.`);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to post panel.';
        await interaction.editReply(msg);
      }
    }
  },
};
