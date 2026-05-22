import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { captureGuild } from '../../util/template-capture.js';
import { applyTemplate } from '../../util/template-apply.js';
import { diff as diffPayloads } from '../../util/template-diff.js';

export const template: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Capture, share, and apply server templates.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('save')
        .setDescription("Capture this server's current structure into a template.")
        .addStringOption((o) =>
          o.setName('name').setDescription('Template name (max 120 chars).').setRequired(true).setMaxLength(120),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Short description.').setMaxLength(500),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription("List this server's templates."))
    .addSubcommand((s) => s.setName('public').setDescription('Browse the public template registry.'))
    .addSubcommand((s) =>
      s
        .setName('diff')
        .setDescription("Preview how a template differs from this server's current structure.")
        .addStringOption((o) => o.setName('id').setDescription('Template id.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('apply')
        .setDescription('Apply a template to this server (only adds missing items).')
        .addStringOption((o) => o.setName('id').setDescription('Template id.').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('on-conflict')
            .setDescription('How to handle name clashes.')
            .addChoices(
              { name: 'skip (default)', value: 'skip' },
              { name: 'rename new item', value: 'rename' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('share')
        .setDescription('Toggle whether a template is listed in the public registry.')
        .addStringOption((o) => o.setName('id').setDescription('Template id.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a template you own.')
        .addStringOption((o) => o.setName('id').setDescription('Template id.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'save') {
        const name = interaction.options.getString('name', true);
        const description = interaction.options.getString('description') ?? undefined;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const payload = captureGuild(interaction.guild);
        const tpl = await api.captureTemplate(interaction.guildId, {
          name,
          createdBy: interaction.user.id,
          payload,
          ...(description ? { description } : {}),
        });
        await interaction.editReply(
          `Saved template **${tpl.name}** (id \`${tpl.id}\`) — ${payload.roles.length} role(s), ${payload.channels.length} channel(s).`,
        );
        return;
      }

      if (sub === 'list') {
        const { templates } = await api.listTemplates(interaction.guildId);
        if (templates.length === 0) {
          await interaction.reply({
            content: 'No templates saved for this server yet. Use `/template save` to create one.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle("This server's templates")
          .setColor(0x5865f2)
          .setDescription(
            templates
              .map(
                (t) =>
                  `\`${t.id}\` — **${t.name}** ${t.public ? '(public)' : ''}${
                    t.description ? `\n  ${t.description}` : ''
                  }`,
              )
              .join('\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'public') {
        const { templates } = await api.listPublicTemplates();
        if (templates.length === 0) {
          await interaction.reply({
            content: 'No public templates yet.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Public template registry')
          .setColor(0x57f287)
          .setDescription(
            templates
              .slice(0, 25)
              .map((t) => `\`${t.id}\` — **${t.name}**${t.description ? ` — ${t.description}` : ''}`)
              .join('\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'diff') {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tpl = await api.getTemplate(id, interaction.guildId);
        const current = captureGuild(interaction.guild);
        const d = diffPayloads(current, tpl.payload);
        const lines: string[] = [];
        if (d.roles.added.length) lines.push(`**Roles to add:** ${d.roles.added.join(', ')}`);
        if (d.roles.changed.length)
          lines.push(
            `**Roles different:** ${d.roles.changed.map((c) => `${c.name} (${c.reason})`).join(', ')}`,
          );
        if (d.roles.removed.length)
          lines.push(`**Roles extra here:** ${d.roles.removed.join(', ')}`);
        if (d.channels.added.length)
          lines.push(`**Channels to add:** ${d.channels.added.join(', ')}`);
        if (d.channels.changed.length)
          lines.push(
            `**Channels different:** ${d.channels.changed.map((c) => `${c.name} (${c.reason})`).join(', ')}`,
          );
        if (d.channels.removed.length)
          lines.push(`**Channels extra here:** ${d.channels.removed.join(', ')}`);
        await interaction.editReply(
          lines.length === 0
            ? 'No structural differences — your server already matches the template.'
            : lines.join('\n'),
        );
        return;
      }

      if (sub === 'apply') {
        const id = interaction.options.getString('id', true);
        const onConflict =
          (interaction.options.getString('on-conflict') as 'skip' | 'rename' | null) ?? 'skip';
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const tpl = await api.getTemplate(id, interaction.guildId);
        const report = await applyTemplate(interaction.guild, tpl.payload, { onConflict });
        const summary = [
          `**Template applied:** ${tpl.name}`,
          `• Roles created: ${report.rolesCreated.length}, skipped: ${report.rolesSkipped.length}`,
          `• Channels created: ${report.channelsCreated.length}, skipped: ${report.channelsSkipped.length}`,
          ...(report.errors.length
            ? [
                `• Errors: ${report.errors.length}`,
                ...report.errors
                  .slice(0, 5)
                  .map((e) => `  - ${e.kind} ${e.name}: ${e.message}`),
              ]
            : []),
        ];
        await interaction.editReply(summary.join('\n'));
        return;
      }

      if (sub === 'share') {
        const id = interaction.options.getString('id', true);
        const updated = await api.shareTemplate(id);
        await interaction.reply({
          content: `Template **${updated.name}** is now ${updated.public ? 'public' : 'private'}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id', true);
        await api.deleteTemplate(id);
        await interaction.reply({
          content: 'Template deleted.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
