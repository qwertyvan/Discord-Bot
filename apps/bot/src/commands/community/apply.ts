import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// `/apply <slug>` opens a Discord modal built from the form's questions. The
// member fills out up to 5 inputs; the modal-submit handler in
// events/interactionCreate.ts persists the Application and posts the staff
// review embed.
export const apply: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Apply to an onboarding form (e.g. staff, partner).')
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('slug')
        .setDescription('Which form to apply to.')
        .setRequired(true)
        .setAutocomplete(true),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const slug = interaction.options.getString('slug', true);

    let form;
    try {
      form = await api.getForm(interaction.guildId, slug);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 404
          ? `No form with slug \`${slug}\`.`
          : err instanceof ApiError
            ? err.message
            : 'Failed to load form.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!form.enabled) {
      await interaction.reply({
        content: `The form **${form.name}** is currently disabled.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build a modal from the form's questions. Discord modals allow up to 5
    // ActionRows, each holding exactly one TextInput; we cap at 5 even though
    // the schema also caps at 5.
    const modal = new ModalBuilder()
      .setCustomId(`apply-modal:${form.id}`)
      .setTitle(form.name.slice(0, 45));

    const rows: ActionRowBuilder<TextInputBuilder>[] = [];
    for (const [index, q] of form.questions.slice(0, 5).entries()) {
      const input = new TextInputBuilder()
        .setCustomId(`q:${index}`)
        .setLabel(q.label.slice(0, 45))
        .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(q.required)
        .setMaxLength(q.maxLength);
      if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
      rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }
    modal.addComponents(...rows);

    await interaction.showModal(modal);
  },
  async autocomplete(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.respond([]);
      return;
    }
    const focused = interaction.options.getFocused().toLowerCase();
    try {
      const { forms } = await api.listForms(interaction.guildId);
      const matches = forms
        .filter((f) => f.enabled)
        .filter(
          (f) =>
            !focused ||
            f.slug.toLowerCase().includes(focused) ||
            f.name.toLowerCase().includes(focused),
        )
        .slice(0, 25)
        .map((f) => ({ name: `${f.name} (${f.slug})`.slice(0, 100), value: f.slug }));
      await interaction.respond(matches);
    } catch {
      await interaction.respond([]).catch(() => undefined);
    }
  },
};
