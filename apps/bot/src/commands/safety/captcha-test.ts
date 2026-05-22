import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { generateImageCaptcha, generateMathChallenge } from '../../util/captcha.js';

/**
 * Sends the invoker a sample challenge (math or image) so admins can preview
 * what new joiners receive. Does not persist a PendingVerification.
 */
export const captchaTest: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('captcha-test')
    .setDescription('Preview a captcha challenge in your DMs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('kind')
        .setDescription('Type of challenge.')
        .addChoices({ name: 'math', value: 'math' }, { name: 'image', value: 'image' }),
    ),
  async execute(interaction) {
    const kind = (interaction.options.getString('kind') ?? 'math') as 'math' | 'image';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (kind === 'image') {
        const c = generateImageCaptcha();
        await interaction.user.send({
          content: `Sample image captcha (answer: \`${c.text}\`):`,
          files: [new AttachmentBuilder(c.pngBuffer, { name: 'captcha.png' })],
        });
      } else {
        const m = generateMathChallenge();
        await interaction.user.send({
          content: `Sample math captcha: **${m.question}** (answer: \`${m.answer}\`)`,
        });
      }
      await interaction.editReply('📬 Sent you a DM with a sample challenge.');
    } catch {
      await interaction.editReply(
        'Could not DM you — make sure your DMs are open to server members.',
      );
    }
  },
};
