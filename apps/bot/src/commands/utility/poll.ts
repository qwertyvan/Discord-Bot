import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';
import { pollMessagePayload } from '../../util/poll-render.js';

export const poll: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create or end a poll.')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a poll in this channel.')
        .addStringOption((o) =>
          o.setName('question').setDescription('Poll question.').setRequired(true).setMaxLength(300),
        )
        .addStringOption((o) =>
          o
            .setName('options')
            .setDescription('Comma-separated options (2–10).')
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption((o) =>
          o.setName('duration').setDescription('Optional auto-close, e.g. 1h, 24h, 3d.'),
        )
        .addBooleanOption((o) =>
          o.setName('anonymous').setDescription('Hide voter identities (always hidden in DMs too).'),
        )
        .addBooleanOption((o) =>
          o.setName('multi').setDescription('Allow each voter to pick more than one option.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('Close a poll immediately.')
        .addStringOption((o) => o.setName('poll_id').setDescription('Poll ID.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const question = interaction.options.getString('question', true);
      const raw = interaction.options.getString('options', true);
      const durationRaw = interaction.options.getString('duration');
      const anonymous = interaction.options.getBoolean('anonymous') ?? false;
      const multiSelect = interaction.options.getBoolean('multi') ?? false;

      const options = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (options.length < 2 || options.length > 10) {
        await interaction.reply({
          content: 'Provide between 2 and 10 comma-separated options.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let closesAt: string | undefined;
      if (durationRaw) {
        const ms = parseDuration(durationRaw);
        if (ms === null) {
          await interaction.reply({
            content: 'Invalid duration. Use formats like `1h`, `24h`, `3d`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        closesAt = new Date(Date.now() + ms).toISOString();
      }

      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'Polls must be created in a text channel.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const created = await api.createPoll(interaction.guildId, {
          channelId: channel.id,
          authorId: interaction.user.id,
          question,
          options,
          anonymous,
          multiSelect,
          ...(closesAt ? { closesAt } : {}),
        });
        const payload = pollMessagePayload(created);
        const message = await (channel as TextChannel).send(payload);
        await api.updatePoll(interaction.guildId, created.id, { messageId: message.id });
        await interaction.editReply(`✅ Poll posted: \`${created.id}\``);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to create poll.';
        await interaction.editReply(msg);
      }
      return;
    }

    if (sub === 'end') {
      const pollId = interaction.options.getString('poll_id', true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const closed = await api.updatePoll(interaction.guildId, pollId, { close: true });
        if (closed.channelId && closed.messageId) {
          const channel = interaction.guild.channels.cache.get(closed.channelId);
          if (channel && channel.type === ChannelType.GuildText) {
            const msg = await (channel as TextChannel).messages.fetch(closed.messageId).catch(() => null);
            if (msg) await msg.edit(pollMessagePayload(closed)).catch(() => {});
          }
        }
        await interaction.editReply('🔒 Poll closed.');
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to close poll.';
        await interaction.editReply(msg);
      }
    }
  },
};
