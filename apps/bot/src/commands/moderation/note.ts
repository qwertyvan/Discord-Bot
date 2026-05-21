import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const note: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Manage private moderator notes on a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a note to a user.')
        .addUserOption((o) => o.setName('user').setDescription('Target user.').setRequired(true))
        .addStringOption((o) =>
          o.setName('content').setDescription('Note content.').setRequired(true).setMaxLength(1000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription("List a user's notes.")
        .addUserOption((o) => o.setName('user').setDescription('Target user.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a note by ID.')
        .addStringOption((o) => o.setName('id').setDescription('Note ID (UUID).').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const target = interaction.options.getUser('user', true);
        const content = interaction.options.getString('content', true);
        const created = await api.createModNote(interaction.guildId, {
          userId: target.id,
          moderatorId: interaction.user.id,
          content,
        });
        await interaction.reply({
          content: `📝 Note added for ${target} — \`${created.id}\``,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const target = interaction.options.getUser('user', true);
        const { notes } = await api.listModNotes(interaction.guildId, target.id);
        if (notes.length === 0) {
          await interaction.reply({ content: `No notes on ${target}.`, flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle(`Notes for ${target.tag}`)
          .setThumbnail(target.displayAvatarURL())
          .setColor(0x5865f2)
          .setFooter({ text: `${notes.length} note${notes.length === 1 ? '' : 's'}` });
        for (const n of notes.slice(0, 10)) {
          embed.addFields({
            name: `${time(new Date(n.createdAt), TimestampStyles.ShortDateTime)} · by <@${n.moderatorId}>`,
            value: `${n.content}\n\`${n.id}\``,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteModNote(interaction.guildId, id);
        await interaction.reply({ content: `🗑️ Note \`${id}\` deleted.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? `Failed: ${err.message}` : 'Failed.';
      if (interaction.replied) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
