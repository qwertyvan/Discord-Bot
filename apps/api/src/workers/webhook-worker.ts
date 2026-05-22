import { createHmac } from 'node:crypto';
import { request } from 'undici';
import type { FastifyInstance } from 'fastify';
import { decryptToken } from '../crypto.js';

const TICK_MS = 5_000;
const BATCH_LIMIT = 25;
const MAX_ATTEMPTS = 5;
// Backoff schedule indexed by current attempt count *before* the failing
// attempt is added. attemptCount=0 → 1m, 1 → 5m, 2 → 15m, 3 → 1h, 4 → 6h.
// After attemptCount reaches MAX_ATTEMPTS we mark status=-1 and stop.
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Background worker that drains WebhookDelivery rows. Started from the API
 * entry point (index.ts) after buildApp() resolves. Each tick:
 *   1. Selects up to BATCH_LIMIT rows where deliveredAt IS NULL and
 *      (nextRetryAt IS NULL OR nextRetryAt <= now).
 *   2. For each row, looks up the webhook, decrypts the secret, signs the
 *      body with HMAC-SHA256(`${timestamp}.${body}`), and POSTs.
 *   3. On 2xx/3xx: marks deliveredAt + status; bumps the webhook's
 *      lastDeliveryAt / lastStatus.
 *   4. On failure: increments attemptCount and schedules nextRetryAt by the
 *      backoff table. At MAX_ATTEMPTS, sets status=-1 and gives up.
 */
export function startWebhookWorker(app: FastifyInstance): () => void {
  let running = false;
  const handle = setInterval(() => {
    if (running) return;
    running = true;
    tick(app)
      .catch((err) => app.log.warn({ err }, 'webhook-worker tick failed'))
      .finally(() => {
        running = false;
      });
  }, TICK_MS);
  // Don't keep the event loop alive if Fastify is shutting down.
  handle.unref();
  return () => clearInterval(handle);
}

async function tick(app: FastifyInstance): Promise<void> {
  const now = new Date();
  const deliveries = await app.prisma.webhookDelivery.findMany({
    where: {
      deliveredAt: null,
      status: { gte: 0 },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    take: BATCH_LIMIT,
    orderBy: { createdAt: 'asc' },
    include: { webhook: true },
  });
  if (deliveries.length === 0) return;

  await Promise.all(deliveries.map((d) => deliverOne(app, d)));
}

async function deliverOne(
  app: FastifyInstance,
  delivery: {
    id: string;
    webhookId: string;
    eventType: string;
    payload: unknown;
    attemptCount: number;
    webhook: {
      id: string;
      url: string;
      secretEncrypted: string;
      active: boolean;
    };
  },
): Promise<void> {
  // Inactive webhook: park the delivery (status=-2 distinguishes "skipped"
  // from "permanently failed"=-1). We still mark deliveredAt so the row stops
  // selecting.
  if (!delivery.webhook.active) {
    await app.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: -2, deliveredAt: new Date() },
    });
    return;
  }

  let secret: string;
  try {
    secret = decryptToken(delivery.webhook.secretEncrypted, app.config.TOKEN_ENCRYPTION_KEY);
  } catch (err) {
    app.log.warn({ err, webhookId: delivery.webhookId }, 'webhook secret decrypt failed');
    await markFailure(app, delivery.id, delivery.attemptCount, 0);
    return;
  }

  const body = JSON.stringify(delivery.payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  let status = 0;
  try {
    const res = await request(delivery.webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'DiscordBot-Webhook/0.28',
        'x-dbot-event': delivery.eventType,
        'x-dbot-timestamp': timestamp,
        'x-dbot-signature': signature,
      },
      body,
      bodyTimeout: REQUEST_TIMEOUT_MS,
      headersTimeout: REQUEST_TIMEOUT_MS,
    });
    status = res.statusCode;
    // Drain body so the connection can be reused / released.
    await res.body.dump().catch(() => {});
  } catch (err) {
    app.log.debug({ err, webhookId: delivery.webhookId }, 'webhook POST failed');
    status = 0;
  }

  if (status >= 200 && status < 400) {
    await app.prisma.$transaction([
      app.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          deliveredAt: new Date(),
          attemptCount: { increment: 1 },
          nextRetryAt: null,
        },
      }),
      app.prisma.outboundWebhook.update({
        where: { id: delivery.webhookId },
        data: { lastDeliveryAt: new Date(), lastStatus: status },
      }),
    ]);
    return;
  }

  await markFailure(app, delivery.id, delivery.attemptCount, status);
  await app.prisma.outboundWebhook.update({
    where: { id: delivery.webhookId },
    data: { lastDeliveryAt: new Date(), lastStatus: status },
  });
}

async function markFailure(
  app: FastifyInstance,
  deliveryId: string,
  attemptCount: number,
  observedStatus: number,
): Promise<void> {
  const nextAttempt = attemptCount + 1;
  if (nextAttempt >= MAX_ATTEMPTS) {
    await app.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: -1,
        attemptCount: nextAttempt,
        // Stamp deliveredAt so it stops selecting; -1 still signals "failed".
        deliveredAt: new Date(),
        nextRetryAt: null,
      },
    });
    return;
  }
  const backoffMs = BACKOFF_MS[attemptCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
  await app.prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: observedStatus,
      attemptCount: nextAttempt,
      nextRetryAt: new Date(Date.now() + backoffMs),
    },
  });
}

