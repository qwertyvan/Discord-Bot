import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Report as PrismaReport } from '@prisma/client';
import { z } from 'zod';
import {
  CreateReportSchema,
  ReportActionSchema,
  ReportListQuerySchema,
  ReportStatusSchema,
  ReviewReportSchema,
  SnowflakeSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ReportParams = z.object({ guildId: SnowflakeSchema, reportId: z.string().uuid() });

function serializeReport(r: PrismaReport) {
  return {
    id: r.id,
    guildId: r.guildId,
    reporterId: r.reporterId,
    targetUserId: r.targetUserId,
    targetMessageId: r.targetMessageId,
    channelId: r.channelId,
    content: r.content,
    status: r.status as 'open' | 'reviewed',
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    actionTaken: (r.actionTaken as 'warn' | 'mute' | 'delete' | 'dismiss' | null) ?? null,
    reviewNote: r.reviewNote,
    createdAt: r.createdAt.toISOString(),
  };
}

export const reportsRoutes: FastifyPluginAsyncZod = async (app) => {
  // List reports for a guild — bot-bearer (the bot drives a /reports list
  // slash command).
  app.get(
    '/guilds/:guildId/reports',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, querystring: ReportListQuerySchema },
    },
    async (req) => {
      const items = await app.prisma.report.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { reports: items.map(serializeReport) };
    },
  );

  // Fetch a single report.
  app.get(
    '/guilds/:guildId/reports/:reportId',
    { preHandler: app.requireBot(), schema: { params: ReportParams } },
    async (req) => {
      const item = await app.prisma.report.findFirst({
        where: { id: req.params.reportId, guildId: req.params.guildId },
      });
      if (!item) throw HttpError.notFound('Report not found.');
      return serializeReport(item);
    },
  );

  // Create — the bot posts here on right-click "Report message" modal submit.
  app.post(
    '/guilds/:guildId/reports',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateReportSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.report.create({
        data: {
          guildId,
          reporterId: req.body.reporterId,
          targetUserId: req.body.targetUserId,
          channelId: req.body.channelId,
          content: req.body.content,
          ...(req.body.targetMessageId !== undefined
            ? { targetMessageId: req.body.targetMessageId }
            : {}),
        },
      });
      return serializeReport(item);
    },
  );

  // Mark a report reviewed and store the action taken + optional note. The
  // bot calls this once it has performed the corresponding Discord action.
  app.post(
    '/guilds/:guildId/reports/:reportId/review',
    {
      preHandler: app.requireBot(),
      schema: { params: ReportParams, body: ReviewReportSchema.extend({ reviewerId: SnowflakeSchema }) },
    },
    async (req) => {
      const existing = await app.prisma.report.findFirst({
        where: { id: req.params.reportId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Report not found.');
      const item = await app.prisma.report.update({
        where: { id: req.params.reportId },
        data: {
          status: 'reviewed',
          actionTaken: req.body.action,
          reviewNote: req.body.note ?? null,
          reviewedBy: req.body.reviewerId,
          reviewedAt: new Date(),
        },
      });
      return serializeReport(item);
    },
  );

  // Keep referenced schemas in scope so unused-import lint doesn't trip.
  void ReportStatusSchema;
  void ReportActionSchema;
};
