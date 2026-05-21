import {
  ChannelType,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type Client,
  type MessageComponentInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';
import { log } from '../logger.js';
import { getCommandRegistry } from '../commands/registry.js';
import { api, ApiError } from '../api-client.js';
import { pollMessagePayload } from '../util/poll-render.js';

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
        if (interaction.customId.startsWith('poll:vote:')) {
          await handlePollVote(interaction);
          return;
        }
        if (interaction.customId.startsWith('ticket:open')) {
          const categoryId = interaction.customId.split(':')[2] ?? null;
          await handleTicketOpen(interaction, categoryId);
          return;
        }
        if (interaction.customId.startsWith('rsvp:')) {
          await handleRsvp(interaction);
          return;
        }
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('rr:select:')) {
          await handleReactionRoleSelect(interaction);
          return;
        }
        if (interaction.customId === 'ticket:open:select') {
          await handleTicketOpen(interaction, interaction.values[0] ?? null);
          return;
        }
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

async function handlePollVote(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const [, , pollId, optionId] = interaction.customId.split(':');
  if (!pollId || !optionId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const current = await api.getPoll(interaction.guildId, pollId);
    if (current.closedAt) {
      await interaction.editReply('That poll is closed.');
      return;
    }
    // v0.5 keeps the vote model simple: clicking a button sets the vote to
    // that single option, even for multi-select polls. Richer interactions
    // (toggle, clear) can be added via a select-menu component later.
    void current;
    const updated = await api.votePoll(interaction.guildId, pollId, {
      userId: interaction.user.id,
      optionIds: [optionId],
    });
    if (updated.channelId && updated.messageId) {
      const channel = interaction.guild.channels.cache.get(updated.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const message = await (channel as TextChannel).messages
          .fetch(updated.messageId)
          .catch(() => null);
        if (message) await message.edit(pollMessagePayload(updated)).catch(() => {});
      }
    }
    const picked = updated.options.find((o) => o.id === optionId);
    await interaction.editReply(`✅ Voted for **${picked?.label ?? 'option'}**.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Vote failed.';
    await interaction.editReply(msg);
  }
}

async function handleTicketOpen(
  interaction: MessageComponentInteraction,
  categoryId: string | null,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const cfg = await api.getTicketConfig(interaction.guildId);
    if (!cfg.enabled) {
      await interaction.editReply('Tickets are not currently enabled.');
      return;
    }
    let category = null;
    let staffRoleId = cfg.staffRoleId;
    if (categoryId) {
      const { categories } = await api.listTicketCategories(interaction.guildId);
      category = categories.find((c) => c.id === categoryId) ?? null;
      if (category?.staffRoleId) staffRoleId = category.staffRoleId;
    }

    const panelChannelId = cfg.panelChannelId ?? interaction.channelId;
    const panelChannel = panelChannelId
      ? interaction.guild.channels.cache.get(panelChannelId)
      : null;
    if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
      await interaction.editReply('Ticket panel channel is missing — ask a mod to re-run /ticket-setup.');
      return;
    }
    const parent = panelChannel as TextChannel;

    const thread = await parent.threads.create({
      name: `ticket-${interaction.user.username.slice(0, 24)}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: 'Ticket opened',
    });
    await thread.members.add(interaction.user.id).catch(() => {});

    let staffMention = '';
    if (staffRoleId) {
      const role = interaction.guild.roles.cache.get(staffRoleId);
      if (role) {
        await thread.send({
          content: `Pinging staff: ${role}`,
          allowedMentions: { roles: [role.id] },
        });
        staffMention = ` (notified ${role})`;
      }
    }

    const ticket = await api.createTicket(interaction.guildId, {
      userId: interaction.user.id,
      channelId: thread.id,
      ...(category ? { categoryId: category.id } : {}),
    });

    await thread.send({
      content: [
        `🎫 **Ticket #${ticket.number}** opened by <@${interaction.user.id}>${category ? ` · ${category.name}` : ''}`,
        'A staff member will be with you shortly. Use `/ticket close` when resolved.',
      ].join('\n'),
      allowedMentions: { users: [interaction.user.id] },
    });

    await interaction.editReply(`✅ Opened ticket #${ticket.number}${staffMention}: ${thread}`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to open ticket.';
    await interaction.editReply(msg);
  }
  void PermissionFlagsBits; // referenced elsewhere; keep import live
}

async function handleRsvp(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const [, statusRaw, eventId] = interaction.customId.split(':');
  if (!eventId || !statusRaw || !['yes', 'maybe', 'no'].includes(statusRaw)) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const updated = await api.rsvpEvent(interaction.guildId, eventId, {
      userId: interaction.user.id,
      status: statusRaw as 'yes' | 'maybe' | 'no',
    });
    if (updated.messageId && updated.channelId) {
      const channel = interaction.guild.channels.cache.get(updated.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const { eventMessagePayload } = await import('../util/event-render.js');
        const message = await (channel as TextChannel).messages
          .fetch(updated.messageId)
          .catch(() => null);
        if (message) await message.edit(eventMessagePayload(updated)).catch(() => {});
      }
    }
    const label = statusRaw === 'yes' ? '✅ Going' : statusRaw === 'maybe' ? '🤔 Maybe' : '❌ Not going';
    await interaction.editReply(`${label} for **${updated.title}**.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to RSVP.';
    await interaction.editReply(msg);
  }
}
