import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { sweepMemberMilestones } from '../../scheduler.js';

export const milestone: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('milestone')
    .setDescription('Configure member milestones (joinaversary, tenure roles, boost rewards).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('config').setDescription('Show the current milestone configuration.'),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('joinaversary')
        .setDescription('Joinaversary configuration.')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Set the joinaversary channel + message template.')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Channel to announce joinaversaries in.')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            )
            .addStringOption((o) =>
              o
                .setName('template')
                .setDescription('Message template. {user} {server} {years}')
                .setRequired(true)
                .setMaxLength(500),
            )
            .addIntegerOption((o) =>
              o
                .setName('reward')
                .setDescription('Currency to award the member (default 0).')
                .setMinValue(0)
                .setMaxValue(1_000_000),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('boost')
        .setDescription('Boost-reward configuration.')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Set the boost announcement channel and reward.')
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Channel to thank new boosters in.')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to grant new boosters.'),
            )
            .addIntegerOption((o) =>
              o
                .setName('reward')
                .setDescription('Currency to award new boosters (default 0).')
                .setMinValue(0)
                .setMaxValue(1_000_000),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('tenure')
        .setDescription('Manage tenure-role rules.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Auto-grant a role at N days of tenure.')
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to grant.').setRequired(true),
            )
            .addIntegerOption((o) =>
              o
                .setName('days')
                .setDescription('Days of tenure required.')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(36_500),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove the tenure rule for a role.')
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to remove the rule for.').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName('list').setDescription('List all tenure-role rules.'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('test-joinaversary')
        .setDescription('Manually fire the joinaversary embed for a member (testing).')
        .addUserOption((o) =>
          o.setName('user').setDescription('Member to celebrate.').setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const guildId = interaction.guildId;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (!group && sub === 'config') {
        const cfg = await api.getMilestoneConfig(guildId);
        const lines = [
          `**Enabled:** ${cfg.enabled ? 'yes' : 'no'}`,
          '',
          '__Joinaversary__',
          `  Channel: ${cfg.joinaversaryChannelId ? `<#${cfg.joinaversaryChannelId}>` : '_(unset)_'}`,
          `  Template: ${cfg.joinaversaryTemplate ? `\`${cfg.joinaversaryTemplate.slice(0, 200)}\`` : '_(default)_'}`,
          `  Reward: ${cfg.joinaversaryReward}`,
          '',
          '__Boost__',
          `  Channel: ${cfg.boostChannelId ? `<#${cfg.boostChannelId}>` : '_(unset)_'}`,
          `  Role: ${cfg.boostRoleId ? `<@&${cfg.boostRoleId}>` : '_(unset)_'}`,
          `  Reward: ${cfg.boostReward}`,
        ].join('\n');
        await interaction.reply({ content: lines, flags: MessageFlags.Ephemeral });
        return;
      }

      if (group === 'joinaversary' && sub === 'set') {
        const channel = interaction.options.getChannel('channel', true);
        const template = interaction.options.getString('template', true);
        const reward = interaction.options.getInteger('reward') ?? undefined;
        await api.upsertMilestoneConfig(guildId, {
          joinaversaryChannelId: channel.id,
          joinaversaryTemplate: template,
          ...(reward !== undefined ? { joinaversaryReward: reward } : {}),
          enabled: true,
        });
        await interaction.reply({
          content: `🎂 Joinaversary set in <#${channel.id}> (reward: ${reward ?? 0}).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (group === 'boost' && sub === 'set') {
        const channel = interaction.options.getChannel('channel', true);
        const role = interaction.options.getRole('role');
        const reward = interaction.options.getInteger('reward') ?? undefined;
        await api.upsertMilestoneConfig(guildId, {
          boostChannelId: channel.id,
          boostRoleId: role?.id ?? null,
          ...(reward !== undefined ? { boostReward: reward } : {}),
          enabled: true,
        });
        await interaction.reply({
          content: `🚀 Boost rewards configured in <#${channel.id}>${role ? ` with role <@&${role.id}>` : ''} (reward: ${reward ?? 0}).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (group === 'tenure' && sub === 'add') {
        const role = interaction.options.getRole('role', true);
        const days = interaction.options.getInteger('days', true);
        // Ensure the parent config exists + is enabled so the sweep sees this guild.
        await api.upsertMilestoneConfig(guildId, { enabled: true });
        await api.createTenureRole(guildId, { roleId: role.id, daysRequired: days });
        await interaction.reply({
          content: `✅ <@&${role.id}> will be auto-granted at ${days} day(s) of tenure.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (group === 'tenure' && sub === 'remove') {
        const role = interaction.options.getRole('role', true);
        await api.deleteTenureRoleByRoleId(guildId, role.id);
        await interaction.reply({
          content: `🗑️ Tenure rule for <@&${role.id}> removed.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (group === 'tenure' && sub === 'list') {
        const { rules } = await api.listTenureRoles(guildId);
        if (rules.length === 0) {
          await interaction.reply({
            content: '_No tenure rules configured._',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = rules.map((r) => `• <@&${r.roleId}> — ${r.daysRequired} day(s)`).join('\n');
        await interaction.reply({
          content: `**Tenure rules:**\n${lines}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!group && sub === 'test-joinaversary') {
        const user = interaction.options.getUser('user', true);
        const cfg = await api.getMilestoneConfig(guildId);
        if (!cfg.joinaversaryChannelId) {
          await interaction.reply({
            content: 'No joinaversary channel configured. Set it with `/milestone joinaversary set` first.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const channel = interaction.guild?.channels.cache.get(cfg.joinaversaryChannelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: 'Joinaversary channel is missing or not a text channel.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
        const years = 1;
        const template =
          cfg.joinaversaryTemplate ??
          '🎉 Happy {years}-year joinaversary, {user}! Thanks for being part of **{server}**.';
        const content = template
          .replaceAll('{user}', `<@${user.id}>`)
          .replaceAll('{username}', member?.displayName ?? user.username)
          .replaceAll('{server}', interaction.guild?.name ?? '')
          .replaceAll('{years}', String(years));
        const embed = new EmbedBuilder()
          .setTitle('🎂 Joinaversary (test)')
          .setDescription(content)
          .setColor(0xf59e0b)
          .setThumbnail(user.displayAvatarURL({ size: 256, extension: 'png' }))
          .setTimestamp(new Date());
        await channel.send({ embeds: [embed], allowedMentions: { users: [user.id] } });
        await interaction.reply({
          content: `🎂 Test joinaversary fired in <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        // Also trigger a sweep so real awards/role grants flow in the test guild.
        void sweepMemberMilestones(interaction.client);
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
