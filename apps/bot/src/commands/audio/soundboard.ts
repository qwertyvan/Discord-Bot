import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { connectAndPlay, disconnect } from '../../util/voice-player.js';

export const soundboard: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('soundboard')
    .setDescription('Per-guild soundboard library.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a clip to the soundboard.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Clip name (lowercase, alphanumeric).').setRequired(true).setMaxLength(64),
        )
        .addStringOption((o) =>
          o.setName('url').setDescription('Playable audio URL.').setRequired(true).setMaxLength(2048),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a clip.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Clip name.').setRequired(true).setMaxLength(64),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List soundboard clips.'))
    .addSubcommand((s) =>
      s
        .setName('play')
        .setDescription('Play a clip into your current voice channel.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Clip name.').setRequired(true).setMaxLength(64),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Voice channel (defaults to your current one).')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('stop')
        .setDescription('Disconnect the bot from voice in this server.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();

    // Permission check for add/remove — ManageGuild only.
    if (sub === 'add' || sub === 'remove') {
      const member = interaction.member as GuildMember | null;
      if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: 'You need Manage Server to modify the soundboard.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    try {
      if (sub === 'add') {
        const name = interaction.options.getString('name', true).toLowerCase();
        const url = interaction.options.getString('url', true);
        await api.createClip(interaction.guildId, {
          name,
          url,
          uploaderId: interaction.user.id,
        });
        await interaction.reply({
          content: `Added clip \`${name}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const name = interaction.options.getString('name', true).toLowerCase();
        await api.deleteClip(interaction.guildId, name);
        await interaction.reply({
          content: `Removed clip \`${name}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { clips } = await api.listClips(interaction.guildId);
        if (clips.length === 0) {
          await interaction.reply({
            content: 'No clips in the soundboard yet.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Soundboard clips')
          .setColor(0x5865f2)
          .setDescription(clips.map((c) => `\`${c.name}\` — <${c.url}>`).join('\n').slice(0, 4000));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'play') {
        const name = interaction.options.getString('name', true).toLowerCase();
        const explicit = interaction.options.getChannel('channel') as VoiceBasedChannel | null;
        const member = interaction.member as GuildMember | null;
        const channel = explicit ?? member?.voice.channel ?? null;
        if (!channel) {
          await interaction.reply({
            content: 'Join a voice channel first, or specify one.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const clip = await api.getClip(interaction.guildId, name);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await connectAndPlay(interaction.guild, channel.id, clip.url);
        if (!result.played) {
          await interaction.editReply({
            content:
              result.reason === 'voice deps not installed'
                ? 'Voice playback is unavailable on this deployment (voice deps not installed).'
                : `Could not play \`${name}\`: ${result.reason ?? 'unknown error'}.`,
          });
          return;
        }
        await interaction.editReply({ content: `Played \`${name}\`.` });
      } else if (sub === 'stop') {
        const result = await disconnect(interaction.guildId);
        if (result === null) {
          await interaction.reply({
            content: 'Voice deps not installed.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (!result) {
          await interaction.reply({
            content: 'I am not in a voice channel here.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply({
          content: 'Disconnected.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => undefined);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
