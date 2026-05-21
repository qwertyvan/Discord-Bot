import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

const DICE_PATTERN = /^(\d{1,3})d(\d{1,4})$/i;

export const roll: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice. Format: NdM (e.g. 2d20). Defaults to 1d6.')
    .addStringOption((o) =>
      o.setName('dice').setDescription('Dice notation, e.g. 2d20. Defaults to 1d6.'),
    ),
  async execute(interaction) {
    const raw = interaction.options.getString('dice') ?? '1d6';
    const match = DICE_PATTERN.exec(raw.trim());
    if (!match) {
      await interaction.reply({ content: `Invalid dice format: \`${raw}\`. Use \`NdM\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > 100) {
      await interaction.reply({ content: 'Roll between 1 and 100 dice.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (sides < 2 || sides > 1000) {
      await interaction.reply({ content: 'Dice must have between 2 and 1000 sides.', flags: MessageFlags.Ephemeral });
      return;
    }
    const rolls: number[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const value = Math.floor(Math.random() * sides) + 1;
      rolls.push(value);
      total += value;
    }
    const detail = count > 1 ? ` — [${rolls.join(', ')}]` : '';
    await interaction.reply(`🎲 \`${count}d${sides}\` → **${total}**${detail}`);
  },
};
