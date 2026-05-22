import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { OutboundEventType } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

const EVENT_CHOICES: OutboundEventType[] = [
  'modaction.created',
  'ticket.opened',
  'ticket.closed',
  'suggestion.created',
  'suggestion.reviewed',
  'member.join',
  'member.leave',
];

function parseEvents(raw: string): OutboundEventType[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.filter((p): p is OutboundEventType =>
    (EVENT_CHOICES as string[]).includes(p),
  );
}

export const webhooksOut: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('webhooks')
    .setDescription('Manage outbound webhook subscriptions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Subscribe a URL to events. Returns the signing secret once.')
        .addStringOption((o) =>
          o.setName('url').setDescription('Target HTTPS URL.').setRequired(true).setMaxLength(2048),
        )
        .addStringOption((o) =>
          o
            .setName('events')
            .setDescription(
              `Comma- or space-separated. Valid: ${EVENT_CHOICES.join(', ')}.`,
            )
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a webhook subscription.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Webhook id (from /webhooks list).').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List configured webhooks.'))
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Enqueue a webhook.test delivery for a given subscription.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Webhook id.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const url = interaction.options.getString('url', true);
        const rawEvents = interaction.options.getString('events', true);
        const events = parseEvents(rawEvents);
        if (events.length === 0) {
          await interaction.reply({
            content: `No valid events recognized. Valid: ${EVENT_CHOICES.join(', ')}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const created = await api.createOutboundWebhook(interaction.guildId, { url, events });
        await interaction.reply({
          content: [
            `Webhook \`${created.id}\` registered for: ${events.join(', ')}.`,
            'Signing secret (shown ONCE — save it now):',
            `\`${created.secret}\``,
            'Verify deliveries with `HMAC_SHA256(secret, "<timestamp>.<body>")` against the `X-DBot-Signature` header.',
          ].join('\n'),
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteOutboundWebhook(interaction.guildId, id);
        await interaction.reply({
          content: `Removed webhook \`${id}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { webhooks } = await api.listOutboundWebhooks(interaction.guildId);
        if (webhooks.length === 0) {
          await interaction.reply({
            content: 'No outbound webhooks configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Outbound webhooks')
          .setColor(0x5865f2)
          .setDescription(
            webhooks
              .map(
                (w) =>
                  `• \`${w.id}\` — ${w.active ? 'active' : 'paused'}\n  ${w.url}\n  events: ${w.events.join(', ')}\n  last: ${w.lastStatus ?? '—'} @ ${w.lastDeliveryAt ?? '—'}`,
              )
              .join('\n\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'test') {
        const id = interaction.options.getString('id', true);
        const result = await api.testOutboundWebhook(interaction.guildId, id);
        await interaction.reply({
          content: `Enqueued test delivery \`${result.deliveryId}\`. Check the URL within ~5 seconds.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
