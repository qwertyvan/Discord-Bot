import {
  Events,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { log } from '../logger.js';
import { getCommandRegistry } from '../commands/registry.js';
import { api, ApiError } from '../api-client.js';

export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = getCommandRegistry().byName.get(interaction.commandName);
        if (!command) {
          log.warn('Unknown command', { name: interaction.commandName });
          return;
        }
        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === 'verify') {
          await handleVerify(interaction);
          return;
        }
        if (interaction.customId.startsWith('rr:button:')) {
          await handleReactionRoleButton(interaction);
          return;
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('rr:select:')) {
        await handleReactionRoleSelect(interaction);
        return;
      }
    } catch (err) {
      log.error('Interaction handler threw', {
        kind: interaction.type,
        err: err instanceof Error ? err.message : String(err),
      });
      const content = 'Something went wrong handling that interaction.';
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    }
  });
}

async function handleVerify(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const cfg = await api.getVerificationConfig(interaction.guildId);
    if (!cfg.enabled || !cfg.verifiedRoleId) {
      await interaction.editReply('Verification is not currently enabled.');
      return;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (member.roles.cache.has(cfg.verifiedRoleId)) {
      await interaction.editReply('You are already verified.');
      return;
    }
    await member.roles.add(cfg.verifiedRoleId, 'Verification button');
    await interaction.editReply('✅ Verified — welcome!');
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Verification failed.';
    await interaction.editReply(msg);
  }
}

async function handleReactionRoleButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const [, , panelId, optionId] = interaction.customId.split(':');
  if (!panelId || !optionId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const panel = await api.getReactionRolePanel(interaction.guildId, panelId);
    const option = panel.options.find((o) => o.id === optionId);
    if (!option) {
      await interaction.editReply('That role option no longer exists.');
      return;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (member.roles.cache.has(option.roleId)) {
      await member.roles.remove(option.roleId, `Reaction-role panel ${panel.name}`);
      await interaction.editReply(`➖ Removed **${option.label}**.`);
    } else {
      if (panel.exclusive) {
        // Remove every other role in this panel before adding the new one.
        const otherRoleIds = panel.options.filter((o) => o.id !== option.id).map((o) => o.roleId);
        for (const id of otherRoleIds) {
          if (member.roles.cache.has(id)) {
            await member.roles.remove(id, `Reaction-role exclusive group: ${panel.name}`);
          }
        }
      }
      await member.roles.add(option.roleId, `Reaction-role panel ${panel.name}`);
      await interaction.editReply(`➕ Added **${option.label}**.`);
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to toggle role.';
    await interaction.editReply(msg);
  }
}

async function handleReactionRoleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const [, , panelId] = interaction.customId.split(':');
  if (!panelId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const panel = await api.getReactionRolePanel(interaction.guildId, panelId);
    const member = await interaction.guild.members.fetch(interaction.user.id);

    const selectedOptionIds = new Set(interaction.values);
    const optionRoleMap = new Map(panel.options.map((o) => [o.id, o.roleId]));
    const allPanelRoleIds = new Set(panel.options.map((o) => o.roleId));

    if (panel.exclusive) {
      // User picked at most one option. Remove all panel roles, then add the
      // selected one if any.
      for (const roleId of allPanelRoleIds) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId, `Reaction-role exclusive: ${panel.name}`);
        }
      }
      const picked = [...selectedOptionIds][0];
      if (picked) {
        const roleId = optionRoleMap.get(picked);
        if (roleId) await member.roles.add(roleId, `Reaction-role panel ${panel.name}`);
      }
      await interaction.editReply('✅ Role updated.');
      return;
    }

    // Non-exclusive: add selected roles the user doesn't have; remove panel
    // roles the user no longer has selected.
    for (const opt of panel.options) {
      const wants = selectedOptionIds.has(opt.id);
      const has = member.roles.cache.has(opt.roleId);
      if (wants && !has) {
        await member.roles.add(opt.roleId, `Reaction-role panel ${panel.name}`);
      } else if (!wants && has) {
        await member.roles.remove(opt.roleId, `Reaction-role panel ${panel.name}`);
      }
    }
    await interaction.editReply('✅ Roles updated.');
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to update roles.';
    await interaction.editReply(msg);
  }
}
