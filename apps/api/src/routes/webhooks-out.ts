import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  OutboundWebhook as PrismaOutboundWebhook,
  PublicApiToken as PrismaPublicApiToken,
  WebhookDelivery as PrismaWebhookDelivery,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  CreateOutboundWebhookSchema,
  CreatePublicApiTokenSchema,
  SnowflakeSchema,
  UpdateOutboundWebhookSchema,
  type OutboundEventType,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { encryptToken } from '../crypto.js';
import { hashPublicToken } from '../plugins/public-token-auth.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const WebhookParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });
const TokenParams = z.object({ guildId: SnowflakeSchema, tokenId: z.string().uuid() });

function serializeWebhook(w: PrismaOutboundWebhook) {
  return {
    id: w.id,
    guildId: w.guildId,
    url: w.url,
    events: w.events as OutboundEventType[],
    active: w.active,
    createdAt: w.createdAt.toISOString(),
    lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: w.lastStatus,
  };
}

function serializeDelivery(d: PrismaWebhookDelivery) {
  return {
    id: d.id,
    webhookId: d.webhookId,
    eventType: d.eventType,
    payload: (d.payload ?? {}) as Record<string, unknown>,
    status: d.status,
    attemptCount: d.attemptCount,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

function serializeToken(t: PrismaPublicApiToken) {
  return {
    id: t.id,
    guildId: t.guildId,
    name: t.name,
    scopes: t.scopes,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  };
}

function generateSecret(): string {
  // 32 bytes → 64 hex chars. Plenty of entropy for HMAC keys.
  return randomBytes(32).toString('hex');
}

function generatePublicToken(): string {
  // 32 bytes base64url → ~43 chars; prefixed to make leaks identifiable.
  return `dbk_${randomBytes(32).toString('base64url')}`;
}

export const webhooksOutRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Outbound webhooks CRUD ───────────────────────────────────────────
  app.get(
    '/guilds/:guildId/webhooks',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.outboundWebhook.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
      });
      return { webhooks: items.map(serializeWebhook) };
    },
  );

  app.post(
    '/guilds/:guildId/webhooks',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateOutboundWebhookSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const plaintextSecret = req.body.secret ?? generateSecret();
      const secretEncrypted = encryptToken(plaintextSecret, app.config.TOKEN_ENCRYPTION_KEY);

      const created = await app.prisma.outboundWebhook.create({
        data: {
          guildId,
          url: req.body.url,
          secretEncrypted,
          events: req.body.events,
          active: req.body.active ?? true,
        },
      });
      // Surface the plaintext secret exactly once.
      return { ...serializeWebhook(created), secret: plaintextSecret };
    },
  );

  app.patch(
    '/guilds/:guildId/webhooks/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: WebhookParams, body: UpdateOutboundWebhookSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const existing = await app.prisma.outboundWebhook.findFirst({
        where: { id, guildId },
      });
      if (!existing) throw HttpError.notFound('Webhook not found.');
      const update: Record<string, unknown> = {};
      if (req.body.url !== undefined) update.url = req.body.url;
      if (req.body.events !== undefined) update.events = req.body.events;
      if (req.body.active !== undefined) update.active = req.body.active;
      const updated = await app.prisma.outboundWebhook.update({
        where: { id },
        data: update,
      });
      return serializeWebhook(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/webhooks/:id',
    { preHandler: app.requireBot(), schema: { params: WebhookParams } },
    async (req, reply) => {
      const result = await app.prisma.outboundWebhook.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Webhook not found.');
      return reply.code(204).send();
    },
  );

  app.get(
    '/guilds/:guildId/webhooks/:id/deliveries',
    {
      preHandler: app.requireBot(),
      schema: {
        params: WebhookParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const hook = await app.prisma.outboundWebhook.findFirst({
        where: { id, guildId },
        select: { id: true },
      });
      if (!hook) throw HttpError.notFound('Webhook not found.');
      const items = await app.prisma.webhookDelivery.findMany({
        where: { webhookId: id },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { deliveries: items.map(serializeDelivery) };
    },
  );

  app.post(
    '/guilds/:guildId/webhooks/:id/test',
    { preHandler: app.requireBot(), schema: { params: WebhookParams } },
    async (req) => {
      const { guildId, id } = req.params;
      const hook = await app.prisma.outboundWebhook.findFirst({
        where: { id, guildId },
      });
      if (!hook) throw HttpError.notFound('Webhook not found.');
      const payload: Record<string, unknown> = {
        ok: true,
        guildId,
        webhookId: id,
        message: 'This is a test delivery from the dashboard / /webhooks test command.',
        timestamp: new Date().toISOString(),
      };
      const delivery = await app.prisma.webhookDelivery.create({
        data: {
          webhookId: id,
          eventType: 'webhook.test',
          payload: payload as Prisma.InputJsonValue,
        },
      });
      return { enqueued: true, deliveryId: delivery.id };
    },
  );

  // ─── Public API tokens ────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/api-tokens',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.publicApiToken.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
      });
      return { tokens: items.map(serializeToken) };
    },
  );

  app.post(
    '/guilds/:guildId/api-tokens',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreatePublicApiTokenSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const plaintext = generatePublicToken();
      const created = await app.prisma.publicApiToken.create({
        data: {
          guildId,
          name: req.body.name,
          tokenHash: hashPublicToken(plaintext),
          scopes: req.body.scopes,
          createdBy: req.body.createdBy,
        },
      });
      return { ...serializeToken(created), token: plaintext };
    },
  );

  app.delete(
    '/guilds/:guildId/api-tokens/:tokenId',
    { preHandler: app.requireBot(), schema: { params: TokenParams } },
    async (req, reply) => {
      const { guildId, tokenId } = req.params;
      const existing = await app.prisma.publicApiToken.findFirst({
        where: { id: tokenId, guildId },
      });
      if (!existing) throw HttpError.notFound('Token not found.');
      if (existing.revokedAt) {
        // Already revoked — treat as idempotent success.
        return reply.code(204).send();
      }
      await app.prisma.publicApiToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
      });
      return reply.code(204).send();
    },
  );
};
