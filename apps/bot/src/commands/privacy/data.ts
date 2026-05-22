import {
  AttachmentBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// /data-export — assembles every user-scoped row across the bot and DMs
// the requester a JSON file. Per GDPR Article 15 (right of access).
export const dataExport: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('data-export')
    .setDescription('Receive a copy of your data the bot stores about you (DM).')
    .setContexts(0, 1)
    .addStringOption((o) =>
      o
        .setName('guild')
        .setDescription('Limit export to a specific guild ID (defaults to all).'),
    ),
  async execute(interaction) {
    const guildOption = interaction.options.getString('guild') ?? undefined;
    // If the user runs this in a guild without a guild option, default to
    // the current guild — most users will mean "my data in this server".
    const guildId =
      guildOption ??
      (interaction.inGuild() && interaction.guildId ? interaction.guildId : undefined);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await api.requestDataExport({
        userId: interaction.user.id,
        ...(guildId ? { guildId } : {}),
      });
      const json = JSON.stringify(result.payload, null, 2);
      const buf = Buffer.from(json, 'utf8');
      const file = new AttachmentBuilder(buf, {
        name: `discord-bot-export-${interaction.user.id}-${Date.now()}.json`,
      });

      let dmDelivered = false;
      try {
        await interaction.user.send({
          content:
            '📦 Here is your data export. The bot does not retain DM contents, so this contains only guild-scoped data.',
          files: [file],
        });
        dmDelivered = true;
      } catch {
        dmDelivered = false;
      }

      if (dmDelivered) {
        await interaction.editReply('✅ I sent your data export to your DMs.');
      } else {
        // Fall back to ephemeral inline attachment.
        await interaction.editReply({
          content:
            "⚠️ I couldn't DM you (DMs disabled?). Here's the export as an ephemeral attachment instead:",
          files: [file],
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to assemble export.';
      await interaction.editReply(msg);
    }
  },
};

// /data-delete — kicks off the two-step deletion workflow. Returns a token
// via DM that the user must echo back via /data-delete-confirm.
export const dataDelete: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('data-delete')
    .setDescription('Begin deleting your data from the bot (requires DM confirmation).')
    .setContexts(0, 1)
    .addStringOption((o) =>
      o
        .setName('guild')
        .setDescription('Limit deletion to a specific guild ID (defaults to all).'),
    ),
  async execute(interaction) {
    const guildOption = interaction.options.getString('guild') ?? undefined;
    const guildId =
      guildOption ??
      (interaction.inGuild() && interaction.guildId ? interaction.guildId : undefined);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const req = await api.requestDataDelete({
        userId: interaction.user.id,
        ...(guildId ? { guildId } : {}),
      });
      const scope = guildId ? `guild \`${guildId}\`` : 'all guilds';
      const instructions = [
        '🛑 **Data-deletion confirmation token**',
        '',
        'You requested permanent deletion of your data in ' + scope + '.',
        '',
        `Confirm by running: \`/data-delete-confirm token:${req.token}\``,
        '',
        'If you did not request this, ignore this message — no data has been deleted yet.',
      ].join('\n');

      let dmDelivered = false;
      try {
        await interaction.user.send({ content: instructions });
        dmDelivered = true;
      } catch {
        dmDelivered = false;
      }

      if (dmDelivered) {
        await interaction.editReply(
          '📩 I DMed you a confirmation token. Re-run `/data-delete-confirm` with that token within a reasonable time.',
        );
      } else {
        // Can't DM, so deliver via ephemeral reply.
        await interaction.editReply({
          content:
            "⚠️ I couldn't DM you. Use this token with `/data-delete-confirm`:\n```\n" +
            req.token +
            '\n```',
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.editReply(msg);
    }
  },
};

// /data-delete-confirm — executes the deletion after token + userId match.
export const dataDeleteConfirm: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('data-delete-confirm')
    .setDescription('Confirm a pending data-deletion request using the token DMed to you.')
    .setContexts(0, 1)
    .addStringOption((o) =>
      o
        .setName('token')
        .setDescription('The confirmation token from your DM.')
        .setRequired(true)
        .setMaxLength(64),
    ),
  async execute(interaction) {
    const token = interaction.options.getString('token', true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await api.confirmDataDelete({
        token,
        userId: interaction.user.id,
      });
      const total = Object.values(result.deleted).reduce((s, n) => s + n, 0);
      await interaction.editReply(
        `✅ Deletion complete. ${total} row(s) removed across ${
          Object.keys(result.deleted).length
        } tables.`,
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.editReply(msg);
    }
  },
};
