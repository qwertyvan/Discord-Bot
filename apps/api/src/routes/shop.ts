import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ShopItem as PrismaShopItem } from '@prisma/client';
import { z } from 'zod';
import {
  ShopItemKindExtSchema,
  SnowflakeSchema,
  UpsertShopItemSchema,
  type ShopItemExt,
  type ShopItemKindExt,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({
  guildId: SnowflakeSchema,
  id: z.string().uuid(),
});

function serialize(s: PrismaShopItem): ShopItemExt {
  // Legacy rows stored as 'virtual' map onto the extended 'consumable' kind so
  // /shop-items keeps a clean enum on the wire.
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

export const shopRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/shop-items',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          includeDisabled: z.coerce.boolean().default(false),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const rows = await app.prisma.shopItem.findMany({
        where: { guildId, ...(req.query.includeDisabled ? {} : { enabled: true }) },
        orderBy: [{ price: 'asc' }, { name: 'asc' }],
      });
      return { items: rows.map(serialize) };
    },
  );

  app.post(
    '/guilds/:guildId/shop-items',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertShopItemSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      if (body.kind === 'role' && !body.roleId) {
        throw HttpError.badRequest('roleId is required for kind=role.');
      }
      // Prisma turns the unique constraint into P2002; the global error
      // handler maps it to 409 — no extra wrapping needed here.
      const created = await app.prisma.shopItem.create({
        data: {
          guildId,
          slug: body.slug,
          name: body.name,
          description: body.description ?? null,
          price: body.priceCents,
          kind: body.kind,
          roleId: body.roleId ?? null,
          message: body.message ?? null,
          stock: body.stock ?? null,
          enabled: body.enabled,
        },
      });
      return serialize(created);
    },
  );

  app.patch(
    '/guilds/:guildId/shop-items/:id',
    {
      preHandler: app.requireBot(),
      schema: {
        params: ItemParams,
        body: UpsertShopItemSchema.partial(),
      },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const existing = await app.prisma.shopItem.findFirst({ where: { id, guildId } });
      if (!existing) throw HttpError.notFound('Item not found.');
      const body = req.body;
      const update: Record<string, unknown> = {};
      if (body.slug !== undefined) update.slug = body.slug;
      if (body.name !== undefined) update.name = body.name;
      if (body.description !== undefined) update.description = body.description;
      if (body.priceCents !== undefined) update.price = body.priceCents;
      if (body.kind !== undefined) update.kind = body.kind;
      if (body.roleId !== undefined) update.roleId = body.roleId;
      if (body.message !== undefined) update.message = body.message;
      if (body.stock !== undefined) update.stock = body.stock;
      if (body.enabled !== undefined) update.enabled = body.enabled;
      const updated = await app.prisma.shopItem.update({ where: { id }, data: update });
      return serialize(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/shop-items/:id',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.shopItem.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Item not found.');
      return reply.code(204).send();
    },
  );

  // Atomic buy: validate balance, decrement balance + stock, upsert inventory.
  // Returns the updated balance and the user's running quantity of the item.
  app.post(
    '/guilds/:guildId/shop-items/:id/buy',
    {
      preHandler: app.requireBot(),
      schema: {
        params: ItemParams,
        body: z.object({
          userId: SnowflakeSchema,
          quantity: z.number().int().positive().max(100).default(1),
        }),
      },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const { userId, quantity } = req.body;

      const item = await app.prisma.shopItem.findFirst({ where: { id, guildId } });
      if (!item) throw HttpError.notFound('Item not found.');
      if (!item.enabled) throw HttpError.conflict('Item is not available.');
      if (item.stock !== null && item.stock < quantity) {
        throw HttpError.conflict('Item out of stock.');
      }

      const cost = item.price * quantity;
      const balance = await app.prisma.balance.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (!balance || balance.amount < cost) {
        throw HttpError.badRequest('Insufficient balance.');
      }

      const [updatedItem, updatedBalance, entry] = await app.prisma.$transaction([
        app.prisma.shopItem.update({
          where: { id },
          data: item.stock !== null ? { stock: { decrement: quantity } } : {},
        }),
        app.prisma.balance.update({
          where: { guildId_userId: { guildId, userId } },
          data: { amount: { decrement: cost } },
        }),
        app.prisma.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: { guildId, userId, itemId: id },
          },
          create: { guildId, userId, itemId: id, quantity },
          update: { quantity: { increment: quantity } },
        }),
      ]);

      return {
        item: serialize(updatedItem),
        balance: updatedBalance.amount,
        quantity: entry.quantity,
        cost,
      };
    },
  );
};
