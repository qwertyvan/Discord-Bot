import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

const responses = [
  'It is certain.',
  'It is decidedly so.',
  'Without a doubt.',
  'Yes — definitely.',
  'You may rely on it.',
  'As I see it, yes.',
  'Most likely.',
  'Outlook good.',
  'Yes.',
  'Signs point to yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  "Don't count on it.",
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
];

export const eightball: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a question.')
    .addStringOption((o) =>
      o.setName('question').setDescription('Your question.').setRequired(true).setMaxLength(300),
    ),
  async execute(interaction) {
    const question = interaction.options.getString('question', true);
    const answer = responses[Math.floor(Math.random() * responses.length)];
    await interaction.reply(`🎱 **Q:** ${question}\n**A:** ${answer}`);
  },
};
