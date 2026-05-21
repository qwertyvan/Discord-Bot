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
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function parseEmoji(raw: string | null): APIMessageComponentEmoji | null {
  if (!raw) return null;
  const custom = /^<(a)?:([\w_]+):(\d+)>$/.exec(raw);
  if (custom) return { id: custom[3]!, name: custom[2]!, animated: custom[1] === 'a' };
  return { name: raw };
}

export const ticketSetup: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Publish the ticket open panel to a channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post the panel.')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel | null;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply('Pick a text channel.');
      return;
    }
    try {
      const cfg = await api.getTicketConfig(interaction.guildId);
      if (!cfg.enabled) {
        await interaction.editReply('Tickets are not enabled. Toggle them on in the dashboard first.');
        return;
      }
      const { categories } = await api.listTicketCategories(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('Open a ticket')
        .setColor(0x5865f2)
        .setDescription(
          categories.length === 0
            ? 'Click the button below to open a support ticket.'
            : 'Pick a category below to open a support ticket.',
        );

      const components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] = [];

      if (categories.length === 0) {
        const button = new ButtonBuilder()
          .setCustomId('ticket:open')
          .setLabel('Open ticket')
          .setStyle(ButtonStyle.Primary);
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
      } else if (categories.length <= 5) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (const c of categories.slice(0, 5)) {
          const b = new ButtonBuilder()
            .setCustomId(`ticket:open:${c.id}`)
            .setLabel(c.name.slice(0, 80))
            .setStyle(ButtonStyle.Primary);
          const emoji = parseEmoji(c.emoji);
          if (emoji) b.setEmoji(emoji);
          row.addComponents(b);
        }
        components.push(row);
      } else {
        const select = new StringSelectMenuBuilder()
          .setCustomId('ticket:open:select')
          .setPlaceholder('Pick a ticket category…');
        for (const c of categories) {
          const o = new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.id);
          if (c.description) o.setDescription(c.description);
          const emoji = parseEmoji(c.emoji);
          if (emoji) o.setEmoji(emoji);
          select.addOptions(o);
        }
        components.push(
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        );
      }

      const msg = await channel.send({ embeds: [embed], components });
      await api.updateTicketConfig(interaction.guildId, {
        panelChannelId: channel.id,
        panelMessageId: msg.id,
      });
      await interaction.editReply(`✅ Panel posted in ${channel}.`);
    } catch (err) {
      const m = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.editReply(m);
    }
  },
};
