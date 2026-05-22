import {
  ActionRowBuilder,
  ChannelType,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type Client,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';
import { log } from '../logger.js';
import { getCommandRegistry } from '../commands/registry.js';
import { api, ApiError } from '../api-client.js';
import { pollMessagePayload } from '../util/poll-render.js';
import { suggestionMessagePayload } from '../util/suggestion-render.js';
import {
  getActiveRound,
  clearActiveRound,
} from '../commands/minigames/trivia.js';
import { hangmanMessagePayload } from '../commands/minigames/hangman.js';
import { dispatchOnCommand } from '../plugins/index.js';
import { giveawayMessagePayload } from '../util/giveaway-render.js';
import { applicationMessagePayload } from '../util/application-render.js';
import { renderBlackjack } from '../commands/economy/blackjack.js';
import { buildCategoryEmbed, buildCategorySelect } from '../commands/utility/help.js';

export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        // Fire-and-forget metrics bump. The label is the bare command name so
        // {command} cardinality stays bounded to the registered command set.
        api
          .postMetric('bot_commands_total', { command: interaction.commandName })
          .catch(() => undefined);
        // Fan out to plugins before host handling so plugins can observe the
        // command even if a builtin or custom handler errors. The dispatcher
        // catches and isolates plugin failures.
        dispatchOnCommand(interaction);
        const command = getCommandRegistry().byName.get(interaction.commandName);
        if (command) {
          await command.execute(interaction);
          return;
        }
        // Fall back to per-guild custom commands.
        if (interaction.inGuild() && interaction.guildId && interaction.guild) {
          try {
            const cc = await api.getCustomCommand(interaction.guildId, interaction.commandName);
            const { renderTemplate } = await import('../util/template-vars.js');
            const content = renderTemplate(cc.response, {
              user: interaction.user,
              guild: interaction.guild,
            });
            await interaction.reply({
              content,
              allowedMentions: { users: [interaction.user.id] },
            });
            api.touchCustomCommand(interaction.guildId, interaction.commandName).catch(() => {});
            return;
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              log.warn('Unknown command', { name: interaction.commandName });
              return;
            }
            throw err;
          }
        }
        log.warn('Unknown command', { name: interaction.commandName });
        return;
      }

      if (interaction.isAutocomplete()) {
        const command = getCommandRegistry().byName.get(interaction.commandName);
        if (command?.autocomplete) {
          await command.autocomplete(interaction);
        } else {
          // No handler — respond with empty so Discord doesn't time us out.
          await interaction.respond([]).catch(() => undefined);
        }
        return;
      }

      if (interaction.isMessageContextMenuCommand()) {
        const cmd = getCommandRegistry().contextByName.get(interaction.commandName);
        if (cmd) {
          await cmd.execute(interaction);
          return;
        }
        log.warn('Unknown context command', { name: interaction.commandName });
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('report-modal:')) {
          await handleReportModal(interaction);
          return;
        }
        if (interaction.customId.startsWith('apply-modal:')) {
          await handleApplyModal(interaction);
          return;
        }
        if (interaction.customId.startsWith('apply-reject:')) {
          await handleApplyRejectModal(interaction);
          return;
        }
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
        if (interaction.customId.startsWith('sgst:')) {
          await handleSuggestionVote(interaction);
          return;
        }
        if (interaction.customId.startsWith('tv:ans:')) {
          await handleTriviaAnswer(interaction);
          return;
        }
        if (interaction.customId.startsWith('hm:g:')) {
          await handleHangmanGuess(interaction);
          return;
        }
        if (interaction.customId.startsWith('gw:enter:')) {
          await handleGiveawayEnter(interaction);
          return;
        }
        if (interaction.customId.startsWith('apply:approve:')) {
          await handleApplicationApprove(interaction);
          return;
        }
        if (interaction.customId.startsWith('apply:reject:')) {
          await handleApplicationReject(interaction);
          return;
        }
        if (
          interaction.customId.startsWith('bj:hit:') ||
          interaction.customId.startsWith('bj:stand:')
        ) {
          await handleBlackjackButton(interaction);
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
        if (interaction.customId === 'help:cat') {
          await handleHelpCategorySelect(interaction);
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

async function handleTriviaAnswer(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.channel) return;
  const [, , questionId, choiceIndexRaw] = interaction.customId.split(':');
  if (!questionId || choiceIndexRaw === undefined) return;
  const choiceIndex = Number(choiceIndexRaw);
  if (!Number.isInteger(choiceIndex)) return;

  const channelId = interaction.channel.id;
  const round = getActiveRound(channelId);
  if (!round || round.questionId !== questionId) {
    await interaction.reply({
      content: 'That trivia round has ended.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (round.answered.has(interaction.user.id)) {
    await interaction.reply({
      content: 'You already answered this round.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  round.answered.add(interaction.user.id);

  const correct = choiceIndex === round.correctIndex;

  try {
    await api.incrementTriviaScore(interaction.guildId, {
      userId: interaction.user.id,
      correct,
    });
  } catch (err) {
    log.warn('trivia score increment failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (correct) {
    clearActiveRound(channelId);
    await interaction.update({ components: [] }).catch(() => {});
    await interaction.followUp({
      content: `🎉 <@${interaction.user.id}> got it! Correct answer.`,
      allowedMentions: { users: [interaction.user.id] },
    });
    return;
  }
  await interaction.reply({
    content: '❌ Not quite — try again or wait for another player.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHangmanGuess(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const [, , gameId, letterRaw] = interaction.customId.split(':');
  if (!gameId || !letterRaw) return;
  const letter = letterRaw.toUpperCase();

  try {
    const game = await api.getHangmanGame(gameId);
    if (game.status !== 'active') {
      await interaction.reply({
        content: 'This hangman game is over.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const wordUpper = game.word.toUpperCase();
    const revealedLetters = new Set(
      game.revealed
        .toUpperCase()
        .split('')
        .filter((c) => c !== '_' && c !== ' '),
    );
    const missArr = game.misses ? game.misses.split('') : [];
    const guessed = new Set<string>([...revealedLetters, ...missArr]);
    if (guessed.has(letter)) {
      await interaction.reply({
        content: `**${letter}** has already been tried.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let newRevealed = game.revealed;
    let newMisses = game.misses;
    let nextStatus: 'active' | 'won' | 'lost' | 'abandoned' = 'active';

    if (wordUpper.includes(letter)) {
      const reveals = new Set(revealedLetters);
      reveals.add(letter);
      newRevealed = [...wordUpper]
        .map((ch) => (ch === ' ' ? ' ' : reveals.has(ch) ? ch : '_'))
        .join('');
      if (!newRevealed.includes('_')) nextStatus = 'won';
    } else {
      newMisses = missArr.concat(letter).join('');
      if (newMisses.length >= game.maxMisses) nextStatus = 'lost';
    }

    const updated = await api.updateHangmanGame(game.id, {
      revealed: newRevealed,
      misses: newMisses,
      status: nextStatus,
    });

    const payload = hangmanMessagePayload(updated);
    await interaction.update(payload).catch(() => {});
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to process guess.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

async function handleGiveawayEnter(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const [, , giveawayId] = interaction.customId.split(':');
  if (!giveawayId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const g = await api.getGiveaway(interaction.guildId, giveawayId);
    if (g.status !== 'active') {
      await interaction.editReply('This giveaway is no longer accepting entries.');
      return;
    }
    if (new Date(g.endsAt).getTime() <= Date.now()) {
      await interaction.editReply('This giveaway has already ended.');
      return;
    }

    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (!member) {
      await interaction.editReply('Could not verify your membership.');
      return;
    }

    if (g.requireRoleId && !member.roles.cache.has(g.requireRoleId)) {
      await interaction.editReply(`You need <@&${g.requireRoleId}> to enter this giveaway.`);
      return;
    }

    if (g.requireMinLevel !== null && g.requireMinLevel > 0) {
      try {
        const ml = await api.getMemberLevel(interaction.guildId, interaction.user.id);
        if (ml.level < g.requireMinLevel) {
          await interaction.editReply(
            `You need to be at least level **${g.requireMinLevel}** to enter (you are level ${ml.level}).`,
          );
          return;
        }
      } catch (err) {
        // If leveling isn't configured, treat as not meeting requirement.
        if (err instanceof ApiError && err.status === 404) {
          await interaction.editReply(
            `You need to be at least level **${g.requireMinLevel}** to enter, but leveling is not enabled.`,
          );
          return;
        }
        throw err;
      }
    }

    const bonusMatches = g.weightedBonusRoles.filter((r) => member.roles.cache.has(r)).length;
    const weight = 1 + bonusMatches;

    const updated = await api.enterGiveaway(interaction.guildId, giveawayId, {
      userId: interaction.user.id,
      weight,
    });

    if (updated.messageId && updated.channelId) {
      const channel = interaction.guild.channels.cache.get(updated.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const message = await (channel as TextChannel).messages
          .fetch(updated.messageId)
          .catch(() => null);
        if (message) {
          await message
            .edit(giveawayMessagePayload(updated, updated.entryCount))
            .catch(() => {});
        }
      }
    }

    await interaction.editReply(
      weight > 1
        ? `🎉 Entry confirmed with ${weight}× weight (bonus roles).`
        : '🎉 Entry confirmed. Good luck!',
    );
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Entry failed.';
    await interaction.editReply(msg);
  }
}

async function handleReportModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  // customId is "report-modal:<messageId>:<targetUserId>:<channelId>".
  const [, messageId, targetUserId, channelId] = interaction.customId.split(':');
  if (!messageId || !targetUserId || !channelId) {
    await interaction.reply({
      content: 'Could not parse the report context.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const reason = interaction.fields.getTextInputValue('reason').trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Best-effort fetch the source message so we can store its content in the
  // report; if the message is gone we still file the report so staff have a
  // record of what was happening.
  let sourceContent = '';
  const channel = interaction.guild.channels.cache.get(channelId);
  if (channel && channel.type === ChannelType.GuildText) {
    const msg = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
    if (msg) sourceContent = msg.content;
  }
  // Persist the reason alongside the source content so a reviewing mod sees
  // both. Cap at the column limit.
  const content = (`Reason: ${reason}\n---\n${sourceContent}`).slice(0, 2000);

  try {
    await api.createReport(interaction.guildId, {
      reporterId: interaction.user.id,
      targetUserId,
      targetMessageId: messageId,
      channelId,
      content,
    });
    await interaction.editReply('✅ Report filed. A moderator will review it.');
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to file report.';
    await interaction.editReply(msg);
  }
}

async function handleSuggestionVote(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const [, direction, suggestionId] = interaction.customId.split(':');
  if (!suggestionId || (direction !== 'up' && direction !== 'down')) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const updated = await api.voteSuggestion(interaction.guildId, suggestionId, {
      userId: interaction.user.id,
      vote: direction === 'up' ? 1 : -1,
    });
    if (updated.messageId && updated.channelId) {
      const channel = interaction.guild.channels.cache.get(updated.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const message = await (channel as TextChannel).messages
          .fetch(updated.messageId)
          .catch(() => null);
        if (message) await message.edit(suggestionMessagePayload(updated)).catch(() => {});
      }
    }
    await interaction.editReply(`${direction === 'up' ? '👍' : '👎'} Vote recorded.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Vote failed.';
    await interaction.editReply(msg);
  }
}

// ─── Onboarding forms / applications ────────────────────────────────────

async function handleApplyModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  // customId is "apply-modal:<formId>".
  const formId = interaction.customId.slice('apply-modal:'.length);
  if (!formId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { forms } = await api.listForms(interaction.guildId);
    const form = forms.find((f) => f.id === formId);
    if (!form) {
      await interaction.editReply('That form no longer exists.');
      return;
    }

    // Reconstruct {label: answer} from the question order — we wrote the
    // inputs as q:0, q:1, … in the order forms.questions yielded them.
    const answers: Record<string, string> = {};
    for (const [index, q] of form.questions.entries()) {
      const raw = interaction.fields.getTextInputValue(`q:${index}`) ?? '';
      answers[q.label] = raw.slice(0, q.maxLength);
    }

    const created = await api.createApplication(interaction.guildId, {
      formId: form.id,
      userId: interaction.user.id,
      answers,
    });

    // Post the staff review embed if a review channel is configured.
    if (form.reviewChannelId) {
      const channel = interaction.guild.channels.cache.get(form.reviewChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const message = await (channel as TextChannel)
          .send(applicationMessagePayload(created, form.name))
          .catch(() => null);
        if (message) {
          await api
            .updateApplication(interaction.guildId, created.id, {
              reviewMessageId: message.id,
            })
            .catch(() => undefined);
        }
      }
    }

    await interaction.editReply(
      `✅ Application submitted for **${form.name}**. Staff will review it.`,
    );
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to submit application.';
    await interaction.editReply(msg);
  }
}

async function handleApplicationApprove(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const applicationId = interaction.customId.slice('apply:approve:'.length);
  if (!applicationId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const existing = await api.getApplication(interaction.guildId, applicationId);
    if (existing.status !== 'pending') {
      await interaction.editReply(`This application is already **${existing.status}**.`);
      return;
    }
    // We don't have a getFormById call, so look it up via the list.
    const { forms } = await api.listForms(interaction.guildId);
    const f = forms.find((x) => x.id === existing.formId);
    const formName = f?.name ?? 'application';
    const approveRoleId = f?.approveRoleId ?? null;
    const approveDmMessage = f?.approveDmMessage ?? null;

    const updated = await api.updateApplication(interaction.guildId, applicationId, {
      status: 'approved',
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
    });

    // Grant the approval role if configured.
    if (approveRoleId) {
      const member = await interaction.guild.members
        .fetch(existing.userId)
        .catch(() => null);
      if (member) {
        await member.roles
          .add(approveRoleId, `Application ${applicationId} approved`)
          .catch(() => undefined);
      }
    }

    // DM the user, if a template is set.
    if (approveDmMessage) {
      const user = await interaction.client.users.fetch(existing.userId).catch(() => null);
      if (user) await user.send({ content: approveDmMessage }).catch(() => undefined);
    }

    // Edit the original review message to reflect the new status.
    if (interaction.message) {
      await interaction.message
        .edit(applicationMessagePayload(updated, formName))
        .catch(() => undefined);
    }

    await interaction.editReply(`✅ Approved application from <@${existing.userId}>.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to approve.';
    await interaction.editReply(msg);
  }
}

async function handleApplicationReject(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const applicationId = interaction.customId.slice('apply:reject:'.length);
  if (!applicationId) return;

  // Open a follow-up modal to capture the rejection reason. The reason is
  // applied + DM'd inside handleApplyRejectModal.
  const modal = new ModalBuilder()
    .setCustomId(`apply-reject:${applicationId}`)
    .setTitle('Reject application');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason (sent to the applicant)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput),
  );

  await interaction.showModal(modal);
}

async function handleApplyRejectModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
  const applicationId = interaction.customId.slice('apply-reject:'.length);
  if (!applicationId) return;
  const reason = interaction.fields.getTextInputValue('reason').trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const existing = await api.getApplication(interaction.guildId, applicationId);
    if (existing.status !== 'pending') {
      await interaction.editReply(`This application is already **${existing.status}**.`);
      return;
    }
    const { forms } = await api.listForms(interaction.guildId);
    const f = forms.find((x) => x.id === existing.formId);
    const formName = f?.name ?? 'application';
    const rejectDmTemplate = f?.rejectDmTemplate ?? null;

    const updated = await api.updateApplication(interaction.guildId, applicationId, {
      status: 'rejected',
      reviewedBy: interaction.user.id,
      reviewedAt: new Date().toISOString(),
      reviewNote: reason,
    });

    // DM the user. If a template is set, append the reason underneath; else
    // send a default message with the reason inline.
    const dmContent = rejectDmTemplate
      ? `${rejectDmTemplate}\n\n**Reason:** ${reason}`
      : `Your application to **${formName}** was not approved.\n\n**Reason:** ${reason}`;
    const user = await interaction.client.users.fetch(existing.userId).catch(() => null);
    if (user) await user.send({ content: dmContent }).catch(() => undefined);

    // Edit the original review message to reflect the rejection. We have to
    // look it up via the persisted review message id since the modal-submit
    // interaction doesn't carry a reference to the originating message.
    if (updated.reviewMessageId && f?.reviewChannelId) {
      const channel = interaction.guild.channels.cache.get(f.reviewChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const message = await (channel as TextChannel).messages
          .fetch(updated.reviewMessageId)
          .catch(() => null);
        if (message) {
          await message
            .edit(applicationMessagePayload(updated, formName))
            .catch(() => undefined);
        }
      }
    }

    await interaction.editReply(`❌ Rejected application from <@${existing.userId}>.`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Failed to reject.';
    await interaction.editReply(msg);
  }
}

// Blackjack hit / stand buttons. customId format: `bj:<action>:<gameId>`.
// We re-render the same embed each click; once the round resolves the
// components are stripped so further clicks are no-ops.
async function handleBlackjackButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const [, action, gameId] = interaction.customId.split(':');
  if (!gameId || (action !== 'hit' && action !== 'stand')) return;

  // Only the player who started the round can act on it. Hot-button hijacks
  // would let third parties drain another user's bet.
  const originalUserId = interaction.message.interaction?.user.id;
  if (originalUserId && originalUserId !== interaction.user.id) {
    await interaction.reply({
      content: 'Only the player who started this hand can hit or stand.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const cfg = await api.getEconomyConfig(interaction.guildId);
    const { state } =
      action === 'hit'
        ? await api.blackjackHit(interaction.guildId, gameId)
        : await api.blackjackStand(interaction.guildId, gameId);
    const { embed, components } = renderBlackjack(state, cfg.currencySymbol);
    await interaction.update({ embeds: [embed], components });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Action failed.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleHelpCategorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const group = interaction.values[0];
  if (!group) {
    await interaction.deferUpdate().catch(() => {});
    return;
  }
  // The original /help message is ephemeral and component-driven. update()
  // edits it in place without producing a follow-up — perfect for a category
  // browser. We rebuild the select so the picked option shows as the default.
  await interaction.update({
    embeds: [buildCategoryEmbed(group)],
    components: [buildCategorySelect(group)],
  });
}
