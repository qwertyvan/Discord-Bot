import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  Ticket as PrismaTicket,
  TicketCategory as PrismaTicketCategory,
  TicketConfig as PrismaTicketConfig,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateTicketCategorySchema,
  CreateTicketSchema,
  SnowflakeSchema,
  UpdateTicketConfigSchema,
  UpdateTicketSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { dispatchEvent } from '../webhook-dispatch.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const CategoryParams = z.object({ guildId: SnowflakeSchema, categoryId: z.string().uuid() });
const TicketParams = z.object({ guildId: SnowflakeSchema, ticketId: z.string().uuid() });

function serializeConfig(guildId: string, cfg: PrismaTicketConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    panelChannelId: cfg?.panelChannelId ?? null,
    panelMessageId: cfg?.panelMessageId ?? null,
    staffRoleId: cfg?.staffRoleId ?? null,
    defaultSlaSeconds: cfg?.defaultSlaSeconds ?? null,
    transcriptChannelId: cfg?.transcriptChannelId ?? null,
    slaReminderSeconds: cfg?.slaReminderSeconds ?? null,
    idleAutoCloseSeconds: cfg?.idleAutoCloseSeconds ?? null,
    transcriptsEnabled: cfg?.transcriptsEnabled ?? false,
  };
}

function serializeCategory(c: PrismaTicketCategory) {
  return {
    id: c.id,
    guildId: c.guildId,
    name: c.name,
    description: c.description,
    emoji: c.emoji,
    staffRoleId: c.staffRoleId,
    slaSeconds: c.slaSeconds,
    position: c.position,
  };
}

function serializeTicket(t: PrismaTicket) {
  return {
    id: t.id,
    guildId: t.guildId,
    categoryId: t.categoryId,
    userId: t.userId,
    channelId: t.channelId,
    number: t.number,
    status: t.status as 'open' | 'closed',
    subject: t.subject,
    assignedTo: t.assignedTo,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
    closedBy: t.closedBy,
    closeReason: t.closeReason,
    lastActivityAt: t.lastActivityAt?.toISOString() ?? null,
    slaReminderAt: t.slaReminderAt?.toISOString() ?? null,
  };
}

export const ticketsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Config
  app.get(
    '/guilds/:guildId/ticket-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.ticketConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/ticket-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpdateTicketConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of [
        'enabled',
        'panelChannelId',
        'panelMessageId',
        'staffRoleId',
        'defaultSlaSeconds',
        'transcriptChannelId',
        'slaReminderSeconds',
        'idleAutoCloseSeconds',
        'transcriptsEnabled',
      ] as const) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const cfg = await app.prisma.ticketConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          panelChannelId: patch.panelChannelId ?? null,
          panelMessageId: patch.panelMessageId ?? null,
          staffRoleId: patch.staffRoleId ?? null,
          defaultSlaSeconds: patch.defaultSlaSeconds ?? null,
          transcriptChannelId: patch.transcriptChannelId ?? null,
          slaReminderSeconds: patch.slaReminderSeconds ?? null,
          idleAutoCloseSeconds: patch.idleAutoCloseSeconds ?? null,
          transcriptsEnabled: patch.transcriptsEnabled ?? false,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // Categories
  app.get(
    '/guilds/:guildId/ticket-categories',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const cats = await app.prisma.ticketCategory.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { position: 'asc' },
      });
      return { categories: cats.map(serializeCategory) };
    },
  );

  app.post(
    '/guilds/:guildId/ticket-categories',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateTicketCategorySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const cat = await app.prisma.ticketCategory.create({
        data: {
          guildId,
          name: req.body.name,
          description: req.body.description ?? null,
          emoji: req.body.emoji ?? null,
          staffRoleId: req.body.staffRoleId ?? null,
          slaSeconds: req.body.slaSeconds ?? null,
          position: req.body.position ?? 0,
        },
      });
      return serializeCategory(cat);
    },
  );

  app.delete(
    '/guilds/:guildId/ticket-categories/:categoryId',
    { preHandler: app.requireBot(), schema: { params: CategoryParams } },
    async (req, reply) => {
      const result = await app.prisma.ticketCategory.deleteMany({
        where: { id: req.params.categoryId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Category not found.');
      return reply.code(204).send();
    },
  );

  // Tickets — create allocates per-guild number atomically.
  app.post(
    '/guilds/:guildId/tickets',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateTicketSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const ticket = await app.prisma.$transaction(async (tx) => {
        const last = await tx.ticket.findFirst({
          where: { guildId },
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const number = (last?.number ?? 0) + 1;
        return tx.ticket.create({
          data: {
            guildId,
            categoryId: req.body.categoryId ?? null,
            userId: req.body.userId,
            channelId: req.body.channelId,
            subject: req.body.subject ?? null,
            number,
          },
        });
      });
      const serialized = serializeTicket(ticket);
      dispatchEvent(app.prisma, guildId, 'ticket.opened', { ticket: serialized }).catch((err) =>
        req.log.warn({ err }, 'dispatchEvent(ticket.opened) failed'),
      );
      return serialized;
    },
  );

  app.get(
    '/guilds/:guildId/tickets',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: z.enum(['open', 'closed']).optional(),
          userId: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const items = await app.prisma.ticket.findMany({
        where: {
          guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.userId ? { userId: req.query.userId } : {}),
        },
        orderBy: { openedAt: 'desc' },
        take: req.query.limit,
      });
      return { tickets: items.map(serializeTicket) };
    },
  );

  app.get(
    '/guilds/:guildId/tickets/:ticketId',
    { preHandler: app.requireBot(), schema: { params: TicketParams } },
    async (req) => {
      const t = await app.prisma.ticket.findFirst({
        where: { id: req.params.ticketId, guildId: req.params.guildId },
      });
      if (!t) throw HttpError.notFound('Ticket not found.');
      return serializeTicket(t);
    },
  );

  app.patch(
    '/guilds/:guildId/tickets/:ticketId',
    {
      preHandler: app.requireBot(),
      schema: { params: TicketParams, body: UpdateTicketSchema },
    },
    async (req) => {
      const { guildId, ticketId } = req.params;
      const existing = await app.prisma.ticket.findFirst({ where: { id: ticketId, guildId } });
      if (!existing) throw HttpError.notFound('Ticket not found.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.status !== undefined) {
        update.status = patch.status;
        if (patch.status === 'closed' && existing.status !== 'closed') {
          update.closedAt = new Date();
        }
      }
      if (patch.assignedTo !== undefined) update.assignedTo = patch.assignedTo;
      if (patch.closedBy !== undefined) update.closedBy = patch.closedBy;
      if (patch.closeReason !== undefined) update.closeReason = patch.closeReason;
      if (patch.subject !== undefined) update.subject = patch.subject;

      const updated = await app.prisma.ticket.update({
        where: { id: ticketId },
        data: update,
      });
      const serialized = serializeTicket(updated);
      // Fire ticket.closed exactly once per transition (open → closed). We
      // checked `existing.status !== 'closed'` above when setting closedAt.
      if (
        patch.status === 'closed' &&
        existing.status !== 'closed'
      ) {
        dispatchEvent(app.prisma, guildId, 'ticket.closed', { ticket: serialized }).catch((err) =>
          req.log.warn({ err }, 'dispatchEvent(ticket.closed) failed'),
        );
      }
      return serialized;
    },
  );

  // Lookup by Discord channel id — used by the bot from in-channel commands.
  app.get(
    '/guilds/:guildId/tickets/by-channel/:channelId',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ guildId: SnowflakeSchema, channelId: SnowflakeSchema }) },
    },
    async (req) => {
      const t = await app.prisma.ticket.findFirst({
        where: { guildId: req.params.guildId, channelId: req.params.channelId },
      });
      if (!t) throw HttpError.notFound('No ticket for this channel.');
      return serializeTicket(t);
    },
  );

  // Bot bumps activity when a non-bot message hits a ticket thread.
  app.post(
    '/guilds/:guildId/tickets/by-channel/:channelId/activity',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ guildId: SnowflakeSchema, channelId: SnowflakeSchema }) },
    },
    async (req, reply) => {
      const updated = await app.prisma.ticket.updateMany({
        where: { guildId: req.params.guildId, channelId: req.params.channelId, status: 'open' },
        data: { lastActivityAt: new Date() },
      });
      return reply.code(updated.count > 0 ? 204 : 404).send();
    },
  );

  // SLA + auto-close lifecycle — bot drains both.
  app.get(
    '/tickets/sla-due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) },
    },
    async (req) => {
      // Pull all configs with SLA set, plus their open tickets — we filter in JS.
      const configs = await app.prisma.ticketConfig.findMany({
        where: { enabled: true, slaReminderSeconds: { not: null } },
      });
      const guildIds = configs.map((c) => c.guildId);
      if (guildIds.length === 0) return { tickets: [] };
      const tickets = await app.prisma.ticket.findMany({
        where: { status: 'open', guildId: { in: guildIds } },
        take: req.query.limit,
      });
      const byGuild = new Map(configs.map((c) => [c.guildId, c]));
      const now = Date.now();
      const due = tickets.filter((t) => {
        const cfg = byGuild.get(t.guildId);
        if (!cfg?.slaReminderSeconds) return false;
        const last = t.lastActivityAt?.getTime() ?? t.openedAt.getTime();
        if (now - last < cfg.slaReminderSeconds * 1000) return false;
        // If we already reminded after the latest activity, skip.
        if (t.slaReminderAt && t.slaReminderAt.getTime() >= last) return false;
        return true;
      });
      return {
        tickets: due.map((t) => ({
          ...serializeTicket(t),
          staffRoleId: byGuild.get(t.guildId)!.staffRoleId,
        })),
      };
    },
  );

  app.post(
    '/tickets/:ticketId/sla-reminder-sent',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ ticketId: z.string().uuid() }) },
    },
    async (req, reply) => {
      await app.prisma.ticket.updateMany({
        where: { id: req.params.ticketId },
        data: { slaReminderAt: new Date() },
      });
      return reply.code(204).send();
    },
  );

  app.get(
    '/tickets/idle-due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) },
    },
    async (req) => {
      const configs = await app.prisma.ticketConfig.findMany({
        where: { enabled: true, idleAutoCloseSeconds: { not: null } },
      });
      const guildIds = configs.map((c) => c.guildId);
      if (guildIds.length === 0) return { tickets: [] };
      const tickets = await app.prisma.ticket.findMany({
        where: { status: 'open', guildId: { in: guildIds } },
        take: req.query.limit,
      });
      const byGuild = new Map(configs.map((c) => [c.guildId, c]));
      const now = Date.now();
      const due = tickets.filter((t) => {
        const cfg = byGuild.get(t.guildId);
        if (!cfg?.idleAutoCloseSeconds) return false;
        const last = t.lastActivityAt?.getTime() ?? t.openedAt.getTime();
        return now - last >= cfg.idleAutoCloseSeconds * 1000;
      });
      return {
        tickets: due.map((t) => ({
          ...serializeTicket(t),
          transcriptsEnabled: byGuild.get(t.guildId)!.transcriptsEnabled,
          transcriptChannelId: byGuild.get(t.guildId)!.transcriptChannelId,
        })),
      };
    },
  );

  // Stats: counts + avg resolution time.
  app.get(
    '/guilds/:guildId/tickets/stats',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ guildId: SnowflakeSchema }) },
    },
    async (req) => {
      const { guildId } = req.params;
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
      const [open, closed, openedLast7d, closedLast7d] = await Promise.all([
        app.prisma.ticket.count({ where: { guildId, status: 'open' } }),
        app.prisma.ticket.count({ where: { guildId, status: 'closed' } }),
        app.prisma.ticket.count({ where: { guildId, openedAt: { gte: sevenDaysAgo } } }),
        app.prisma.ticket.count({
          where: { guildId, status: 'closed', closedAt: { gte: sevenDaysAgo } },
        }),
      ]);

      const closedTickets = await app.prisma.ticket.findMany({
        where: { guildId, status: 'closed', closedAt: { not: null } },
        orderBy: { closedAt: 'desc' },
        take: 100,
        select: { openedAt: true, closedAt: true },
      });
      let avgResolutionSec = 0;
      if (closedTickets.length > 0) {
        const total = closedTickets.reduce(
          (s, t) => s + (t.closedAt!.getTime() - t.openedAt.getTime()),
          0,
        );
        avgResolutionSec = Math.round(total / closedTickets.length / 1000);
      }
      return {
        guildId,
        openCount: open,
        closedCount: closed,
        openedLast7d,
        closedLast7d,
        avgResolutionSeconds: avgResolutionSec,
      };
    },
  );
};
