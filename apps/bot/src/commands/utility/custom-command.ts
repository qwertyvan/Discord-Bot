import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { syncCustomCommands } from '../../util/custom-commands-sync.js';

export const customCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('custom-command')
    .setDescription('Define a guild-specific slash command.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a custom slash command.')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Command name (lowercase, 1-32 chars).')
            .setRequired(true)
            .setMaxLength(32),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription("What the command does.").setRequired(true).setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName('response')
            .setDescription('The reply. Supports {user}, {username}, {server}, {memberCount}, {random:a,b,c}.')
            .setRequired(true)
            .setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Update the description or response.')
        .addStringOption((o) => o.setName('name').setDescription('Command name.').setRequired(true))
        .addStringOption((o) =>
          o.setName('description').setDescription('New description.').setMaxLength(100),
        )
        .addStringOption((o) =>
          o.setName('response').setDescription('New response.').setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a custom command.')
        .addStringOption((o) => o.setName('name').setDescription('Command name.').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List the guild\'s custom commands.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const name = interaction.options.getString('name', true).toLowerCase();
        const description = interaction.options.getString('description', true);
        const response = interaction.options.getString('response', true);
        await api.createCustomCommand(interaction.guildId, {
          name,
          description,
          response,
          createdBy: interaction.user.id,
        });
        const { count } = await syncCustomCommands(interaction.guildId);
        await interaction.reply({
          content: `✅ Added \`/${name}\`. Guild now has ${count} custom command${count === 1 ? '' : 's'}.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'edit') {
        const name = interaction.options.getString('name', true).toLowerCase();
        const description = interaction.options.getString('description') ?? undefined;
        const response = interaction.options.getString('response') ?? undefined;
        if (!description && !response) {
          await interaction.reply({
            content: 'Provide a new description or response.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await api.updateCustomCommand(interaction.guildId, name, {
          ...(description ? { description } : {}),
          ...(response ? { response } : {}),
        });
        if (description) {
          // Description shows up in Discord's UI — re-register.
          await syncCustomCommands(interaction.guildId);
        }
        await interaction.reply({
          content: `✅ Updated \`/${name}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const name = interaction.options.getString('name', true).toLowerCase();
        await api.deleteCustomCommand(interaction.guildId, name);
        const { count } = await syncCustomCommands(interaction.guildId);
        await interaction.reply({
          content: `🗑️ Removed \`/${name}\`. ${count} custom command${count === 1 ? '' : 's'} remaining.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { commands } = await api.listCustomCommands(interaction.guildId);
        if (commands.length === 0) {
          await interaction.reply({
            content: 'No custom commands defined.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Custom commands')
          .setColor(0x5865f2)
          .setDescription(
            commands.map((c) => `\`/${c.name}\` — ${c.description} · ${c.uses} uses`).join('\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
