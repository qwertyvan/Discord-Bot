import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const ping: SlashCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription("Check the bot's latency."),
  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pinging…', fetchReply: true });
    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    const ws = Math.round(interaction.client.ws.ping);
    await interaction.editReply(`Pong! Round-trip \`${roundTrip}ms\` · WebSocket \`${ws}ms\``);
  },
};
