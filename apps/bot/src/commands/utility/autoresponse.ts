import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const autoresponse: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('autoresponse')
    .setDescription('Configure auto-responses (keyword → reply).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a new auto-response.')
        .addStringOption((o) =>
          o.setName('trigger').setDescription('Trigger text or substring.').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o.setName('response').setDescription('Response message.').setRequired(true).setMaxLength(2000),
        )
        .addStringOption((o) =>
          o
            .setName('match')
            .setDescription('How to match (default contains).')
            .addChoices(
              { name: 'contains', value: 'contains' },
              { name: 'whole word', value: 'word' },
              { name: 'exact message', value: 'exact' },
            ),
        )
        .addBooleanOption((o) => o.setName('case_sensitive').setDescription('Case-sensitive match.')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List configured auto-responses.'))
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete an auto-response by ID.')
        .addStringOption((o) => o.setName('id').setDescription('Auto-response ID.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const trigger = interaction.options.getString('trigger', true);
        const response = interaction.options.getString('response', true);
        const matchType = (interaction.options.getString('match') ?? 'contains') as
          | 'contains'
          | 'word'
          | 'exact';
        const caseSensitive = interaction.options.getBoolean('case_sensitive') ?? false;
        const created = await api.createAutoResponse(interaction.guildId, {
          trigger,
          response,
          matchType,
          caseSensitive,
          enabled: true,
        });
        await interaction.reply({
          content: `✅ Auto-response added: \`${created.id}\``,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { autoResponses } = await api.listAutoResponses(interaction.guildId);
        if (autoResponses.length === 0) {
          await interaction.reply({ content: 'No auto-responses configured.', flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('Auto-responses')
          .setFooter({ text: `${autoResponses.length} configured` });
        for (const ar of autoResponses.slice(0, 15)) {
          embed.addFields({
            name: `\`${ar.id}\`${ar.enabled ? '' : ' *(disabled)*'}`,
            value: `**Trigger:** ${ar.trigger} *(${ar.matchType}${ar.caseSensitive ? ', case-sensitive' : ''})*\n**Response:** ${ar.response.slice(0, 200)}${ar.response.length > 200 ? '…' : ''}`,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteAutoResponse(interaction.guildId, id);
        await interaction.reply({ content: `🗑️ Removed \`${id}\`.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
