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
import { ttsUrl } from '../../util/tts.js';
import { connectAndPlay } from '../../util/voice-player.js';

export const tts: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Text-to-speech announcements.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('say')
        .setDescription('Speak text into a voice channel.')
        .addStringOption((o) =>
          o.setName('text').setDescription('What to say (max 200 chars).').setRequired(true).setMaxLength(200),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Voice channel (defaults to your current one).')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('config')
        .setDescription('Configure welcome/goodbye TTS announcements.')
        .addSubcommand((s) =>
          s
            .setName('show')
            .setDescription('Show the current TTS configuration.'),
        )
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Update TTS configuration. Pass any combination of options.')
            .addBooleanOption((o) =>
              o.setName('enabled').setDescription('Enable/disable TTS announcements.'),
            )
            .addChannelOption((o) =>
              o
                .setName('voice_channel')
                .setDescription('Voice channel to speak into.')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
            )
            .addStringOption((o) =>
              o
                .setName('welcome_text')
                .setDescription('Spoken on member join. Empty string to clear.')
                .setMaxLength(500),
            )
            .addStringOption((o) =>
              o
                .setName('goodbye_text')
                .setDescription('Spoken on member leave. Empty string to clear.')
                .setMaxLength(500),
            )
            .addStringOption((o) =>
              o
                .setName('language')
                .setDescription('BCP-47 language code (e.g. en, es, fr).')
                .setMaxLength(8),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (!group && sub === 'say') {
        const text = interaction.options.getString('text', true);
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
        // Pull the configured language; falls back to "en" if config is unset.
        const cfg = await api.getTtsConfig(interaction.guildId).catch(() => null);
        const lang = cfg?.language ?? 'en';
        const url = ttsUrl(text, lang);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await connectAndPlay(interaction.guild, channel.id, url);
        if (!result.played) {
          await interaction.editReply({
            content:
              result.reason === 'voice deps not installed'
                ? 'Voice playback is unavailable on this deployment (voice deps not installed).'
                : `TTS playback failed: ${result.reason ?? 'unknown error'}.`,
          });
          return;
        }
        await interaction.editReply({ content: 'Spoken.' });
        return;
      }

      if (group === 'config') {
        // Both subcommands require ManageGuild — they read/write server config.
        const member = interaction.member as GuildMember | null;
        if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: 'You need Manage Server to view/change TTS settings.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (sub === 'show') {
          const cfg = await api.getTtsConfig(interaction.guildId);
          const embed = new EmbedBuilder()
            .setTitle('TTS configuration')
            .setColor(0x5865f2)
            .addFields(
              { name: 'Enabled', value: cfg.enabled ? 'yes' : 'no', inline: true },
              { name: 'Language', value: cfg.language, inline: true },
              {
                name: 'Voice channel',
                value: cfg.voiceChannelId ? `<#${cfg.voiceChannelId}>` : '_not set_',
                inline: true,
              },
              { name: 'Welcome text', value: cfg.welcomeText ?? '_not set_' },
              { name: 'Goodbye text', value: cfg.goodbyeText ?? '_not set_' },
            );
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return;
        }
        if (sub === 'set') {
          const enabled = interaction.options.getBoolean('enabled');
          const voiceChannel = interaction.options.getChannel('voice_channel') as
            | VoiceBasedChannel
            | null;
          const welcomeRaw = interaction.options.getString('welcome_text');
          const goodbyeRaw = interaction.options.getString('goodbye_text');
          const language = interaction.options.getString('language');

          // Conditional spread keeps optional fields literally absent (rather
          // than `undefined`) so `exactOptionalPropertyTypes` is happy.
          const body = {
            ...(enabled !== null ? { enabled } : {}),
            ...(voiceChannel ? { voiceChannelId: voiceChannel.id } : {}),
            ...(welcomeRaw !== null ? { welcomeText: welcomeRaw === '' ? null : welcomeRaw } : {}),
            ...(goodbyeRaw !== null ? { goodbyeText: goodbyeRaw === '' ? null : goodbyeRaw } : {}),
            ...(language ? { language } : {}),
          };
          const updated = await api.upsertTtsConfig(interaction.guildId, body);
          await interaction.reply({
            content:
              `TTS updated. Enabled: ${updated.enabled ? 'yes' : 'no'}, ` +
              `language: ${updated.language}, channel: ` +
              `${updated.voiceChannelId ? `<#${updated.voiceChannelId}>` : 'unset'}.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
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
