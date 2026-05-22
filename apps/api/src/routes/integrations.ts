import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { IntegrationSubscription, Prisma } from '@prisma/client';
import { z } from 'zod';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import {
  CreateIntegrationSchema,
  SnowflakeSchema,
  UpdateIntegrationSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { incCounter } from '../util/metrics.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, integrationId: z.string().uuid() });

function serializeIntegration(s: IntegrationSubscription) {
  return {
    id: s.id,
    guildId: s.guildId,
    channelId: s.channelId,
    name: s.name,
    kind: s.kind as 'rss' | 'webhook',
    rssUrl: s.rssUrl,
    lastSeenGuid: s.lastSeenGuid,
    lastPolledAt: s.lastPolledAt?.toISOString() ?? null,
    pollInterval: s.pollInterval,
    token: s.token,
    secret: s.secret,
    twitchUsername: s.twitchUsername,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
  };
}

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

export const integrationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── CRUD (bot + admin shares this; admin routes proxy via session auth) ──
  app.get(
    '/guilds/:guildId/integrations',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const subs = await app.prisma.integrationSubscription.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
      });
      return { integrations: subs.map(serializeIntegration) };
    },
  );

  app.post(
    '/guilds/:guildId/integrations',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateIntegrationSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      if (req.body.kind === 'rss') {
        const sub = await app.prisma.integrationSubscription.create({
          data: {
            guildId,
            channelId: req.body.channelId,
            name: req.body.name,
            kind: 'rss',
            rssUrl: req.body.rssUrl,
            pollInterval: req.body.pollInterval ?? 600,
          },
        });
        return serializeIntegration(sub);
      }
      if (req.body.kind === 'twitch') {
        const sub = await app.prisma.integrationSubscription.create({
          data: {
            guildId,
            channelId: req.body.channelId,
            name: req.body.name,
            kind: 'twitch',
            twitchUsername: req.body.twitchUsername.toLowerCase(),
            pollInterval: req.body.pollInterval ?? 120,
          },
        });
        return serializeIntegration(sub);
      }
      // webhook
      const sub = await app.prisma.integrationSubscription.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          name: req.body.name,
          kind: 'webhook',
          token: randomToken(),
          secret: req.body.secret ?? null,
        },
      });
      return serializeIntegration(sub);
    },
  );

  app.patch(
    '/guilds/:guildId/integrations/:integrationId',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams, body: UpdateIntegrationSchema },
    },
    async (req) => {
      const { guildId, integrationId } = req.params;
      const existing = await app.prisma.integrationSubscription.findFirst({
        where: { id: integrationId, guildId },
      });
      if (!existing) throw HttpError.notFound('Integration not found.');
      const update: Record<string, unknown> = {};
      for (const k of ['channelId', 'name', 'rssUrl', 'pollInterval', 'enabled', 'secret'] as const) {
        const v = (req.body as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const updated = await app.prisma.integrationSubscription.update({
        where: { id: integrationId },
        data: update,
      });
      return serializeIntegration(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/integrations/:integrationId',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.integrationSubscription.deleteMany({
        where: { id: req.params.integrationId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Integration not found.');
      return reply.code(204).send();
    },
  );

  // ─── RSS poll lifecycle ───────────────────────────────────────────────
  app.get(
    '/rss/due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) },
    },
    async (req) => {
      const now = Date.now();
      const subs = await app.prisma.integrationSubscription.findMany({
        where: { kind: 'rss', enabled: true, rssUrl: { not: null } },
        take: req.query.limit,
      });
      const due = subs.filter((s) => {
        const last = s.lastPolledAt?.getTime() ?? 0;
        return now - last >= s.pollInterval * 1000;
      });
      return { integrations: due.map(serializeIntegration) };
    },
  );

  app.post(
    '/integrations/:integrationId/rss-state',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ integrationId: z.string().uuid() }),
        body: z.object({
          lastSeenGuid: z.string().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const updated = await app.prisma.integrationSubscription.update({
        where: { id: req.params.integrationId },
        data: {
          lastPolledAt: new Date(),
          ...(req.body.lastSeenGuid !== undefined ? { lastSeenGuid: req.body.lastSeenGuid } : {}),
        },
      });
      return serializeIntegration(updated);
    },
  );

  // ─── Twitch poll lifecycle ────────────────────────────────────────────
  app.get(
    '/twitch/due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) },
    },
    async (req) => {
      const now = Date.now();
      const subs = await app.prisma.integrationSubscription.findMany({
        where: { kind: 'twitch', enabled: true, twitchUsername: { not: null } },
        take: req.query.limit,
      });
      const due = subs.filter((s) => {
        const last = s.lastPolledAt?.getTime() ?? 0;
        return now - last >= s.pollInterval * 1000;
      });
      return { integrations: due.map(serializeIntegration) };
    },
  );

  app.post(
    '/integrations/:integrationId/twitch-state',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ integrationId: z.string().uuid() }),
        body: z.object({
          // The Twitch stream id; null means the streamer is offline.
          streamId: z.string().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const updated = await app.prisma.integrationSubscription.update({
        where: { id: req.params.integrationId },
        data: {
          lastPolledAt: new Date(),
          // We reuse lastSeenGuid as "last seen stream id" for Twitch.
          ...(req.body.streamId !== undefined ? { lastSeenGuid: req.body.streamId } : {}),
        },
      });
      return serializeIntegration(updated);
    },
  );

  // ─── Credentials (per-guild API keys) ─────────────────────────────────
  app.get(
    '/guilds/:guildId/integration-credentials',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const rows = await app.prisma.integrationCredential.findMany({
        where: { guildId: req.params.guildId },
        orderBy: [{ provider: 'asc' }, { key: 'asc' }],
      });
      return {
        credentials: rows.map((r) => ({
          guildId: r.guildId,
          provider: r.provider,
          key: r.key,
          hasValue: r.value.length > 0,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // Bot-side: fetch the decrypted credential value. Caller must already
  // possess BOT_API_TOKEN. Returns 404 if not set.
  app.get(
    '/guilds/:guildId/integration-credentials/:provider/:key/value',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({
          guildId: SnowflakeSchema,
          provider: z.string().min(1).max(32),
          key: z.string().min(1).max(32),
        }),
      },
    },
    async (req) => {
      const row = await app.prisma.integrationCredential.findUnique({
        where: {
          guildId_provider_key: {
            guildId: req.params.guildId,
            provider: req.params.provider,
            key: req.params.key,
          },
        },
      });
      if (!row) throw HttpError.notFound('Credential not set.');
      const { decryptToken } = await import('../crypto.js');
      try {
        const value = decryptToken(row.value, app.config.TOKEN_ENCRYPTION_KEY);
        return { provider: row.provider, key: row.key, value };
      } catch {
        throw HttpError.notFound('Credential corrupt — re-set via the dashboard.');
      }
    },
  );

  // ─── Pending posts queue ──────────────────────────────────────────────
  app.get(
    '/posts/due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) },
    },
    async (req) => {
      const posts = await app.prisma.pendingPost.findMany({
        orderBy: { createdAt: 'asc' },
        take: req.query.limit,
      });
      return {
        posts: posts.map((p) => ({
          id: p.id,
          guildId: p.guildId,
          channelId: p.channelId,
          content: p.content,
          embedJson: p.embedJson as Record<string, unknown> | null,
          source: p.source,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/posts',
    {
      preHandler: app.requireBot(),
      schema: {
        body: z.object({
          guildId: SnowflakeSchema,
          channelId: SnowflakeSchema,
          content: z.string().max(2000).optional(),
          embedJson: z.unknown().optional(),
          source: z.string().max(80).optional(),
        }),
      },
    },
    async (req) => {
      const post = await app.prisma.pendingPost.create({
        data: {
          guildId: req.body.guildId,
          channelId: req.body.channelId,
          content: req.body.content ?? null,
          embedJson: (req.body.embedJson ?? null) as Prisma.InputJsonValue,
          source: req.body.source ?? null,
        },
      });
      return { id: post.id };
    },
  );

  app.delete(
    '/posts/:postId',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ postId: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { count } = await app.prisma.pendingPost.deleteMany({
        where: { id: req.params.postId },
      });
      if (count > 0) incCounter('pending_posts_drained_total');
      return reply.code(204).send();
    },
  );

  // ─── Inbound webhook (public, no bot auth) ────────────────────────────
  app.post(
    '/webhooks/in/:token',
    {
      // No bot/session auth: the token in the URL is the credential. The
      // global CSRF guard only fires on /admin/* and /auth/logout, so public
      // POSTs to /webhooks/in/* are unaffected.
      schema: {
        params: z.object({ token: z.string().min(8).max(128) }),
      },
    },
    async (req, reply) => {
      try {
        const sub = await app.prisma.integrationSubscription.findUnique({
          where: { token: req.params.token },
        });
        if (!sub || !sub.enabled || sub.kind !== 'webhook') {
          incCounter('webhook_deliveries_total', { status: 'fail' });
          throw HttpError.notFound('Webhook not found.');
        }

        // GitHub-specific path: detect by X-GitHub-Event and render via the
        // GitHub payload parser. GitHub signs the raw body, not the parsed
        // JSON; for v0.15 we rely on the URL token as the credential and
        // accept payloads without HMAC verification here.
        const githubEvent = req.headers['x-github-event'];
        if (typeof githubEvent === 'string') {
          const { renderGitHubEvent } = await import('../services/github-webhook.js');
          const embed = renderGitHubEvent(githubEvent, req.body);
          if (!embed) {
            incCounter('webhook_deliveries_total', { status: 'ok' });
            return reply.code(202).send({ accepted: true, skipped: true });
          }
          await app.prisma.pendingPost.create({
            data: {
              guildId: sub.guildId,
              channelId: sub.channelId,
              content: null,
              embedJson: embed as unknown as Prisma.InputJsonValue,
              source: `github:${githubEvent}`,
            },
          });
          incCounter('webhook_deliveries_total', { status: 'ok' });
          return reply.code(202).send({ accepted: true });
        }

        // Generic JSON payload path with optional shared-secret HMAC.
        if (sub.secret) {
          const signature = req.headers['x-signature-256'];
          if (typeof signature !== 'string') {
            incCounter('webhook_deliveries_total', { status: 'fail' });
            throw HttpError.unauthorized('Missing X-Signature-256 header.');
          }
          const expected =
            'sha256=' +
            createHmac('sha256', sub.secret).update(JSON.stringify(req.body ?? {})).digest('hex');
          const a = Buffer.from(signature);
          const b = Buffer.from(expected);
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            incCounter('webhook_deliveries_total', { status: 'fail' });
            throw HttpError.unauthorized('Bad signature.');
          }
        }

        const body = (req.body ?? {}) as {
          content?: string;
          embed?: Record<string, unknown>;
          message?: string;
          title?: string;
          text?: string;
        };
        const content =
          body.content ?? body.message ?? body.text ?? (body.title ? `**${body.title}**` : null);
        if (!content && !body.embed) {
          incCounter('webhook_deliveries_total', { status: 'fail' });
          throw HttpError.badRequest('Payload must include content, message, text, title, or embed.');
        }

        await app.prisma.pendingPost.create({
          data: {
            guildId: sub.guildId,
            channelId: sub.channelId,
            content,
            embedJson: (body.embed ?? null) as Prisma.InputJsonValue,
            source: sub.name,
          },
        });

        incCounter('webhook_deliveries_total', { status: 'ok' });
        return reply.code(202).send({ accepted: true });
      } catch (err) {
        // Counters for HttpError paths are already incremented above; only
        // catch unanticipated errors here so we don't double-count.
        if (!(err instanceof HttpError)) {
          incCounter('webhook_deliveries_total', { status: 'fail' });
        }
        throw err;
      }
    },
  );
};
