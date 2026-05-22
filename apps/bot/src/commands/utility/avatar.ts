import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

/**
 * /avatar — show a user's avatar. The `scope` option picks between their
 * global avatar (the one on their Discord account) and the per-guild server
 * avatar that members may have set. When `scope` is omitted we prefer the
 * server avatar if available, falling back to the global one.
 */
export const avatar: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Show a user's avatar.")
    .addUserOption((o) =>
      o.setName('user').setDescription('The user (defaults to you).'),
    )
    .addStringOption((o) =>
      o
        .setName('scope')
        .setDescription('Which avatar to show.')
        .addChoices(
          { name: 'global', value: 'global' },
          { name: 'server', value: 'server' },
        ),
    ),
  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const scope = (interaction.options.getString('scope') ?? 'auto') as 'global' | 'server' | 'auto';

    const member =
      interaction.inGuild() && interaction.guild
        ? await interaction.guild.members.fetch(user.id).catch(() => null)
        : null;

    let url: string;
    let labelScope: string;
    if (scope === 'global') {
      url = user.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
      labelScope = 'global';
    } else if (scope === 'server') {
      if (!member) {
        await interaction.reply({
          content: 'You can only request a server avatar inside a server.',
        });
        return;
      }
      url = member.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
      labelScope = 'server';
    } else {
      // Auto: prefer the per-guild member avatar if the member has one
      // distinct from the global one; otherwise fall back to global.
      const memberSpecific = member?.avatar
        ? member.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false })
        : null;
      url = memberSpecific ?? user.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
      labelScope = memberSpecific ? 'server' : 'global';
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: `${user.tag} — ${labelScope} avatar` })
      .setImage(url)
      .setURL(url)
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed] });
  },
};
