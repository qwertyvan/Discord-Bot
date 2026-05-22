import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  InventoryEntry as PrismaInventoryEntry,
  ShopItem as PrismaShopItem,
} from '@prisma/client';
import { z } from 'zod';
import {
  ConsumeItemSchema,
  GiftRequestSchema,
  ShopItemKindExtSchema,
  SnowflakeSchema,
  type ConsumeItemResult,
  type InventoryEntryExt,
  type ShopItemExt,
  type ShopItemKindExt,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const UserParams = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
});
const GuildParams = z.object({ guildId: SnowflakeSchema });

function serializeItem(s: PrismaShopItem): ShopItemExt {
  const rawKind = s.kind === 'virtual' ? 'consumable' : s.kind;
  const parsed = ShopItemKindExtSchema.safeParse(rawKind);
  const kind: ShopItemKindExt = parsed.success ? parsed.data : 'consumable';
  return {
    id: s.id,
    guildId: s.guildId,
    slug: s.slug,
    name: s.name,
    description: s.description,
    priceCents: s.price,
    stock: s.stock,
    kind,
    roleId: s.roleId,
    message: s.message,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
  };
}

function serializeEntry(
  e: PrismaInventoryEntry & { item: PrismaShopItem | null },
): InventoryEntryExt {
  return {
    guildId: e.guildId,
    userId: e.userId,
    itemId: e.itemId,
    quantity: e.quantity,
    acquiredAt: e.acquiredAt.toISOString(),
    ...(e.item ? { item: serializeItem(e.item) } : {}),
  };
}

export const inventoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/inventory/:userId',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const entries = await app.prisma.inventoryEntry.findMany({
        where: { guildId, userId, quantity: { gt: 0 } },
        include: { item: true },
        orderBy: { acquiredAt: 'desc' },
      });
      return { entries: entries.map(serializeEntry) };
    },
  );

  // Transfer N units of one item between users in the same guild. Both ends
  // mutate in a single transaction so a crash mid-flight can't dupe items.
  app.post(
    '/guilds/:guildId/inventory/transfer',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: GiftRequestSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { fromUserId, toUserId, itemId, quantity } = req.body;
      if (fromUserId === toUserId) {
        throw HttpError.badRequest('Cannot gift to yourself.');
      }
      const source = await app.prisma.inventoryEntry.findUnique({
        where: {
          guildId_userId_itemId: { guildId, userId: fromUserId, itemId },
        },
        include: { item: true },
      });
      if (!source || source.quantity < quantity) {
        throw HttpError.badRequest('You do not own enough of that item.');
      }

      const [decremented, recipient] = await app.prisma.$transaction([
        app.prisma.inventoryEntry.update({
          where: {
            guildId_userId_itemId: { guildId, userId: fromUserId, itemId },
          },
          data: { quantity: { decrement: quantity } },
          include: { item: true },
        }),
        app.prisma.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: { guildId, userId: toUserId, itemId },
          },
          create: { guildId, userId: toUserId, itemId, quantity },
          update: { quantity: { increment: quantity } },
          include: { item: true },
        }),
      ]);

      return {
        from: serializeEntry(decremented),
        to: serializeEntry(recipient),
      };
    },
  );

  // /use endpoint. Decrements quantity; the bot side actually grants the
  // Discord role for kind=role items (the API can't talk to the gateway).
  // The response tells the bot which role to grant and the flavour message
  // to display.
  app.post(
    '/guilds/:guildId/inventory/consume',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: ConsumeItemSchema },
    },
    async (req): Promise<ConsumeItemResult> => {
      const { guildId } = req.params;
      const { userId, itemId, quantity } = req.body;
      const entry = await app.prisma.inventoryEntry.findUnique({
        where: { guildId_userId_itemId: { guildId, userId, itemId } },
        include: { item: true },
      });
      if (!entry || entry.quantity < quantity) {
        throw HttpError.badRequest('You do not own enough of that item.');
      }
      if (!entry.item) {
        throw HttpError.notFound('Item no longer exists.');
      }

      // Role items aren't "consumed" in the consumable sense: granting a role
      // is idempotent so we decrement by quantity anyway but keep the row in
      // place for audit history.
      const updated = await app.prisma.inventoryEntry.update({
        where: { guildId_userId_itemId: { guildId, userId, itemId } },
        data: { quantity: { decrement: quantity } },
        include: { item: true },
      });

      return {
        item: serializeItem(entry.item),
        remaining: updated.quantity,
        message: entry.item.message ?? null,
        roleGranted: entry.item.kind === 'role' ? entry.item.roleId : null,
      };
    },
  );
};
