import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const appeal: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Submit or check an appeal.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('submit')
        .setDescription('Submit an appeal to the moderation team.')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Your appeal message.')
            .setRequired(true)
            .setMaxLength(2000),
        )
        .addStringOption((o) =>
          o
            .setName('mod_action_id')
            .setDescription('Optional ModAction ID this appeal relates to.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Check the status of an appeal.')
        .addStringOption((o) => o.setName('id').setDescription('Appeal ID.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'submit') {
        const message = interaction.options.getString('message', true);
        const modActionId = interaction.options.getString('mod_action_id') ?? undefined;
        const created = await api.createAppeal(interaction.guildId, {
          userId: interaction.user.id,
          message,
          ...(modActionId ? { modActionId } : {}),
        });
        await interaction.reply({
          content: `📨 Appeal submitted. ID: \`${created.id}\`. Staff will review it.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'status') {
        const id = interaction.options.getString('id', true);
        const a = await api.getAppeal(interaction.guildId, id);
        if (a.userId !== interaction.user.id) {
          await interaction.reply({
            content: 'You can only check your own appeals.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = [
          `**Appeal** \`${a.id}\``,
          `Status: **${a.status}**`,
          `Submitted: <t:${Math.floor(new Date(a.createdAt).getTime() / 1000)}:R>`,
          ...(a.reviewNote ? [`Note: ${a.reviewNote}`] : []),
        ];
        await interaction.reply({
          content: lines.join('\n'),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
