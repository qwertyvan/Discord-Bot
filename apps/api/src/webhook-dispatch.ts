import type { PrismaClient, Prisma } from '@prisma/client';
import type { OutboundEventType } from '@discord-bot/shared';

/**
 * Enqueue a WebhookDelivery row for every active OutboundWebhook in the given
 * guild that's subscribed to the event type. The actual HTTP delivery is
 * performed asynchronously by the webhook worker (see workers/webhook-worker.ts).
 *
 * This is intentionally fire-and-forget from the caller's perspective: if no
 * webhooks match, nothing happens. Failures during the enqueue step are
 * logged by the caller (we never throw out of here for a logging side-effect).
 */
export async function dispatchEvent(
  prisma: PrismaClient,
  guildId: string,
  eventType: OutboundEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  // Postgres array containment: webhook is subscribed if `events` includes eventType.
  const webhooks = await prisma.outboundWebhook.findMany({
    where: {
      guildId,
      active: true,
      events: { has: eventType },
    },
    select: { id: true },
  });
  if (webhooks.length === 0) return;

  await prisma.webhookDelivery.createMany({
    data: webhooks.map((w) => ({
      webhookId: w.id,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    })),
  });
}
