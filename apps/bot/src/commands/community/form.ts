import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { FormQuestionSchema, type FormQuestion } from '@discord-bot/shared';
import { z } from 'zod';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// Questions JSON parameter schema — accepts the same shape FormQuestionSchema
// expects but with all fields optional so the bot can apply sensible defaults
// when admins author a quick form from a slash command.
const InputQuestionSchema = z.object({
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).optional(),
  required: z.boolean().optional(),
  maxLength: z.number().int().min(1).max(4000).optional(),
  style: z.enum(['short', 'paragraph']).optional(),
});

function parseQuestions(raw: string): FormQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('questions must be a JSON array.');
  }
  const arr = z.array(InputQuestionSchema).min(1).max(5).parse(parsed);
  return arr.map((q) =>
    FormQuestionSchema.parse({
      label: q.label,
      ...(q.placeholder !== undefined ? { placeholder: q.placeholder } : {}),
      required: q.required ?? true,
      maxLength: q.maxLength ?? (q.style === 'paragraph' ? 1000 : 200),
      style: q.style ?? 'short',
    }),
  );
}

export const form: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('form')
    .setDescription('Manage onboarding application forms.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a new application form.')
        .addStringOption((o) =>
          o
            .setName('slug')
            .setDescription('URL-safe identifier used by /apply (e.g. "staff").')
            .setRequired(true)
            .setMaxLength(48),
        )
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Human-readable name shown to applicants.')
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((o) =>
          o
            .setName('questions')
            .setDescription(
              'JSON array of up to 5 questions: [{"label":"…","style":"short|paragraph"}].',
            )
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Optional description.').setMaxLength(500),
        )
        .addChannelOption((o) =>
          o
            .setName('review_channel')
            .setDescription('Channel to post staff review embeds to.')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addRoleOption((o) =>
          o.setName('approve_role').setDescription('Role granted on approval.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Update an existing form.')
        .addStringOption((o) =>
          o.setName('slug').setDescription('Slug of the form to edit.').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('name').setDescription('New name.').setMaxLength(120),
        )
        .addStringOption((o) =>
          o
            .setName('questions')
            .setDescription('Replacement questions (same JSON shape as /form add).'),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('New description.').setMaxLength(500),
        )
        .addChannelOption((o) =>
          o
            .setName('review_channel')
            .setDescription('New review channel.')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addRoleOption((o) =>
          o.setName('approve_role').setDescription('New role granted on approval.'),
        )
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Enable or disable the form.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Delete a form.')
        .addStringOption((o) =>
          o.setName('slug').setDescription('Slug of the form to delete.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List configured forms.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const name = interaction.options.getString('name', true);
        const rawQuestions = interaction.options.getString('questions', true);
        const description = interaction.options.getString('description') ?? undefined;
        const reviewChannel = interaction.options.getChannel('review_channel');
        const approveRole = interaction.options.getRole('approve_role');

        let questions: FormQuestion[];
        try {
          questions = parseQuestions(rawQuestions);
        } catch (err) {
          await interaction.reply({
            content:
              err instanceof Error ? err.message : 'questions must be a JSON array.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const created = await api.createForm(interaction.guildId, {
          slug,
          name,
          questions,
          createdBy: interaction.user.id,
          ...(description ? { description } : {}),
          ...(reviewChannel ? { reviewChannelId: reviewChannel.id } : {}),
          ...(approveRole ? { approveRoleId: approveRole.id } : {}),
        });
        await interaction.reply({
          content: `✅ Created form \`${created.slug}\` with ${created.questions.length} question${
            created.questions.length === 1 ? '' : 's'
          }.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'edit') {
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const existing = await api.getForm(interaction.guildId, slug);
        const name = interaction.options.getString('name') ?? undefined;
        const rawQuestions = interaction.options.getString('questions') ?? undefined;
        const description = interaction.options.getString('description') ?? undefined;
        const reviewChannel = interaction.options.getChannel('review_channel');
        const approveRole = interaction.options.getRole('approve_role');
        const enabled = interaction.options.getBoolean('enabled');

        let questions: FormQuestion[] | undefined;
        if (rawQuestions) {
          try {
            questions = parseQuestions(rawQuestions);
          } catch (err) {
            await interaction.reply({
              content:
                err instanceof Error ? err.message : 'questions must be a JSON array.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        }

        await api.updateForm(interaction.guildId, existing.id, {
          ...(name !== undefined ? { name } : {}),
          ...(questions ? { questions } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(reviewChannel ? { reviewChannelId: reviewChannel.id } : {}),
          ...(approveRole ? { approveRoleId: approveRole.id } : {}),
          ...(enabled !== null ? { enabled } : {}),
        });
        await interaction.reply({
          content: `✅ Updated form \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const slug = interaction.options.getString('slug', true).toLowerCase();
        const existing = await api.getForm(interaction.guildId, slug);
        await api.deleteForm(interaction.guildId, existing.id);
        await interaction.reply({
          content: `🗑️ Deleted form \`${slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { forms } = await api.listForms(interaction.guildId);
        if (forms.length === 0) {
          await interaction.reply({
            content: 'No forms configured. Use `/form add` or the dashboard.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Onboarding forms')
          .setColor(0x5865f2)
          .setDescription(
            forms
              .map(
                (f) =>
                  `• \`${f.slug}\` — **${f.name}** · ${f.questions.length} question${
                    f.questions.length === 1 ? '' : 's'
                  }${f.enabled ? '' : ' *(disabled)*'}`,
              )
              .join('\n'),
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  },
};
