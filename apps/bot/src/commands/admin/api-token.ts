import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { PublicApiScope } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

const SCOPE_CHOICES: PublicApiScope[] = ['stats:read'];

export const apiToken: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('api-token')
    .setDescription('Manage scoped public-API tokens for this guild.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a new token. Sent via DM — shown once.')
        .addStringOption((o) =>
          o.setName('name').setDescription('Human-friendly label.').setRequired(true).setMaxLength(64),
        )
        .addStringOption((o) =>
          o
            .setName('scopes')
            .setDescription(`Comma-separated scopes. Valid: ${SCOPE_CHOICES.join(', ')}.`)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('revoke')
        .setDescription('Revoke a token by id.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Token id.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List tokens (names + scopes only).')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'create') {
        const name = interaction.options.getString('name', true);
        const rawScopes = interaction.options.getString('scopes', true);
        const scopes = rawScopes
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .filter((s): s is PublicApiScope => (SCOPE_CHOICES as string[]).includes(s));
        if (scopes.length === 0) {
          await interaction.reply({
            content: `No valid scopes. Valid: ${SCOPE_CHOICES.join(', ')}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const created = await api.createApiToken(interaction.guildId, {
          name,
          scopes,
          createdBy: interaction.user.id,
        });

        // Try DM first so the secret never appears in a guild channel.
        let dmed = false;
        try {
          await interaction.user.send({
            content: [
              `**API token created for ${interaction.guild?.name ?? interaction.guildId}**`,
              `Name: \`${name}\``,
              `Scopes: ${scopes.join(', ')}`,
              `Id: \`${created.id}\``,
              '',
              'Token (save it now — it will not be shown again):',
              `\`${created.token}\``,
            ].join('\n'),
          });
          dmed = true;
        } catch {
          // DMs closed — we still created the token, but we won't surface the
          // secret in the channel. The admin can revoke and try again.
        }

        await interaction.reply({
          content: dmed
            ? `Token created. Check your DMs for the secret. Id: \`${created.id}\`.`
            : `Token created (id: \`${created.id}\`) but I couldn't DM you the secret. Enable DMs from server members and run \`/api-token revoke\` then create a new one.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'revoke') {
        const id = interaction.options.getString('id', true);
        await api.revokeApiToken(interaction.guildId, id);
        await interaction.reply({
          content: `Token \`${id}\` revoked.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { tokens } = await api.listApiTokens(interaction.guildId);
        if (tokens.length === 0) {
          await interaction.reply({
            content: 'No API tokens configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('API tokens')
          .setColor(0x5865f2)
          .setDescription(
            tokens
              .map(
                (t) =>
                  `• \`${t.id}\` — ${t.name}${t.revokedAt ? ' (revoked)' : ''}\n  scopes: ${t.scopes.join(', ') || '—'}\n  last used: ${t.lastUsedAt ?? 'never'}`,
              )
              .join('\n\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
