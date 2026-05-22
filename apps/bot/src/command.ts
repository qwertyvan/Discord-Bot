import type {
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';

export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | SlashCommandOptionsOnlyBuilder
  | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

export interface SlashCommand {
  data: SlashCommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

// Right-click "context menu" commands (Message and User targets). These
// share REST serialization with slash commands so the deploy script can
// flatten both into one /commands PUT.
export interface MessageContextCommand {
  data: ContextMenuCommandBuilder;
  execute(interaction: MessageContextMenuCommandInteraction): Promise<void>;
}
