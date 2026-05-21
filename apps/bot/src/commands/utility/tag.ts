import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const tag: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Show or manage server canned-content tags.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Display a tag.')
        .addStringOption((o) => o.setName('name').setDescription('Tag name.').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all tags in this server.'))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a new tag (requires Manage Messages).')
        .addStringOption((o) => o.setName('name').setDescription('Tag name.').setRequired(true))
        .addStringOption((o) =>
          o.setName('content').setDescription('Tag content.').setRequired(true).setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit a tag (requires Manage Messages).')
        .addStringOption((o) => o.setName('name').setDescription('Tag name.').setRequired(true))
        .addStringOption((o) =>
          o.setName('content').setDescription('New content.').setRequired(true).setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a tag (requires Manage Messages).')
        .addStringOption((o) => o.setName('name').setDescription('Tag name.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    const requiresManage = ['add', 'edit', 'remove'].includes(sub);
    if (requiresManage) {
      const perms = interaction.memberPermissions;
      if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({
          content: 'You need Manage Messages to add/edit/remove tags.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      if (sub === 'show') {
        const name = interaction.options.getString('name', true);
        const t = await api.getTag(interaction.guildId, name);
        await api.touchTag(interaction.guildId, name).catch(() => {});
        await interaction.reply({ content: t.content, allowedMentions: { parse: [] } });
      } else if (sub === 'list') {
        const { tags } = await api.listTags(interaction.guildId);
        if (tags.length === 0) {
          await interaction.reply({ content: 'No tags yet — try `/tag add`.', flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Tags')
          .setColor(0x5865f2)
          .setDescription(tags.map((t) => `\`${t.name}\` — ${t.uses} uses`).join('\n'));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'add') {
        const name = interaction.options.getString('name', true);
        const content = interaction.options.getString('content', true);
        await api.createTag(interaction.guildId, {
          name: name.toLowerCase(),
          content,
          authorId: interaction.user.id,
        });
        await interaction.reply({ content: `✅ Created tag \`${name}\`.`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'edit') {
        const name = interaction.options.getString('name', true);
        const content = interaction.options.getString('content', true);
        await api.updateTag(interaction.guildId, name, { content });
        await interaction.reply({ content: `✅ Updated tag \`${name}\`.`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'remove') {
        const name = interaction.options.getString('name', true);
        await api.deleteTag(interaction.guildId, name);
        await interaction.reply({ content: `🗑️ Deleted tag \`${name}\`.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
