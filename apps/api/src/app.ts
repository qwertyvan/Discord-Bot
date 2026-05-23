import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { ApiErrorCodes } from '@discord-bot/shared';
import configPlugin from './plugins/config.js';
import prismaPlugin from './plugins/prisma.js';
import botAuthPlugin from './plugins/bot-auth.js';
import sessionAuthPlugin from './plugins/session-auth.js';
import discordOAuthPlugin from './plugins/discord-oauth.js';
import csrfPlugin from './plugins/csrf.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import adminAuditPlugin from './plugins/admin-audit.js';
import publicTokenAuthPlugin from './plugins/public-token-auth.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { buildLokiStream } from './util/loki.js';
import { guildsRoutes } from './routes/guilds.js';
import { modActionsRoutes } from './routes/mod-actions.js';
import { modNotesRoutes } from './routes/mod-notes.js';
import { auditEventsRoutes } from './routes/audit-events.js';
import { automodRoutes } from './routes/automod.js';
import { warningPolicyRoutes } from './routes/warning-policy.js';
import { welcomeRoutes } from './routes/welcome.js';
import { verificationRoutes } from './routes/verification.js';
import { reactionRolesRoutes } from './routes/reaction-roles.js';
import { pollsRoutes } from './routes/polls.js';
import { remindersRoutes } from './routes/reminders.js';
import { tagsRoutes } from './routes/tags.js';
import { autoResponsesRoutes } from './routes/auto-responses.js';
import { autoReactionsRoutes } from './routes/auto-reactions.js';
import { levelingRoutes } from './routes/leveling.js';
import { economyRoutes } from './routes/economy.js';
import { shopRoutes } from './routes/shop.js';
import { inventoryRoutes } from './routes/inventory.js';
import { gamesRoutes } from './routes/games.js';
import { lootRoutes } from './routes/loot.js';
import { ticketsRoutes } from './routes/tickets.js';
import { statsRoutes } from './routes/stats.js';
import { integrationsRoutes } from './routes/integrations.js';
import { feedsRoutes } from './routes/feeds.js';
import { userTimezoneRoutes } from './routes/user-timezone.js';
import { scheduledRoutes } from './routes/scheduled.js';
import { shortLinksRoutes } from './routes/short-links.js';
import { customCommandsRoutes } from './routes/custom-commands.js';
import { communityRoutes } from './routes/community.js';
import { voiceRoutes } from './routes/voice.js';
import { voiceClaimRoutes } from './routes/voice-claim.js';
import { audioRoutes } from './routes/audio.js';
import { insightsRoutes } from './routes/insights.js';
import { activityRolesRoutes } from './routes/activity-roles.js';
import { minigamesRoutes } from './routes/minigames.js';
import { backupRoutes } from './routes/backup.js';
import { appealsRoutes } from './routes/appeals.js';
import { webhooksOutRoutes } from './routes/webhooks-out.js';
import { publicRoutes } from './routes/public.js';
import { musicRoutes } from './routes/music.js';
import { giveawaysRoutes } from './routes/giveaways.js';
import { auctionsRoutes } from './routes/auctions.js';
import { starboardRoutes } from './routes/starboard.js';
import { countersRoutes } from './routes/counters.js';
import { forumStageRoutes } from './routes/forum-stage.js';
import { antiRaidRoutes } from './routes/anti-raid.js';
import { linkSafetyRoutes } from './routes/link-safety.js';
import { reportsRoutes } from './routes/reports.js';
import { templatesRoutes } from './routes/templates.js';
import { privacyRoutes } from './routes/privacy.js';
import { invitesRoutes } from './routes/invites.js';
import { quotesRoutes } from './routes/quotes.js';
import { milestonesRoutes } from './routes/milestones.js';
import { onboardingFormsRoutes } from './routes/onboarding-forms.js';
import { karaokeRoutes } from './routes/karaoke.js';
import { serverPetRoutes } from './routes/server-pet.js';
import { profileRoutes } from './routes/profile.js';
import { achievementsRoutes } from './routes/achievements.js';
import { questsRoutes } from './routes/quests.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { fishingRoutes } from './routes/fishing.js';
import { duelsRoutes } from './routes/duels.js';
import { authRoutes } from './routes/auth.js';
import { adminGuildsRoutes } from './routes/admin/guilds.js';
import { adminReactionRolesRoutes } from './routes/admin/reaction-roles.js';
import { HttpError } from './errors.js';

export async function buildApp() {
  const lokiStream = buildLokiStream();
  // When Loki is configured we hand pino our own write stream (which both
  // forwards to stdout and buffers for batched POSTs); pino-pretty would
  // intercept the stream so we skip it in this mode.
  const loggerOptions = (
    lokiStream
      ? { level: process.env.LOG_LEVEL ?? 'info', stream: lokiStream }
      : {
          level: process.env.LOG_LEVEL ?? 'info',
          ...(process.env.NODE_ENV === 'development'
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
                },
              }
            : {}),
        }
  ) as NonNullable<FastifyServerOptions['logger']>;

  const app = Fastify({ logger: loggerOptions }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(configPlugin);
  await app.register(cors, {
    origin: app.config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(prismaPlugin);
  await app.register(botAuthPlugin);
  await app.register(sessionAuthPlugin);
  await app.register(discordOAuthPlugin);
  await app.register(rateLimitPlugin);
  await app.register(csrfPlugin);
  await app.register(adminAuditPlugin);
  await app.register(publicTokenAuthPlugin);

  await app.register(metricsRoutes);
  await app.register(healthRoutes);
  await app.register(heartbeatRoutes);
  await app.register(guildsRoutes);
  await app.register(modActionsRoutes);
  await app.register(modNotesRoutes);
  await app.register(auditEventsRoutes);
  await app.register(automodRoutes);
  await app.register(warningPolicyRoutes);
  await app.register(welcomeRoutes);
  await app.register(verificationRoutes);
  await app.register(reactionRolesRoutes);
  await app.register(pollsRoutes);
  await app.register(remindersRoutes);
  await app.register(tagsRoutes);
  await app.register(autoResponsesRoutes);
  await app.register(autoReactionsRoutes);
  await app.register(levelingRoutes);
  await app.register(economyRoutes);
  await app.register(shopRoutes);
  await app.register(inventoryRoutes);
  await app.register(gamesRoutes);
  await app.register(lootRoutes);
  await app.register(ticketsRoutes);
  await app.register(statsRoutes);
  await app.register(integrationsRoutes);
  await app.register(feedsRoutes);
  await app.register(userTimezoneRoutes);
  await app.register(scheduledRoutes);
  await app.register(shortLinksRoutes);
  await app.register(customCommandsRoutes);
  await app.register(communityRoutes);
  await app.register(voiceRoutes);
  await app.register(voiceClaimRoutes);
  await app.register(audioRoutes);
  await app.register(insightsRoutes);
  await app.register(activityRolesRoutes);
  await app.register(minigamesRoutes);
  await app.register(backupRoutes);
  await app.register(appealsRoutes);
  await app.register(webhooksOutRoutes);
  await app.register(publicRoutes);
  await app.register(musicRoutes);
  await app.register(giveawaysRoutes);
  await app.register(auctionsRoutes);
  await app.register(starboardRoutes);
  await app.register(countersRoutes);
  await app.register(forumStageRoutes);
  await app.register(antiRaidRoutes);
  await app.register(linkSafetyRoutes);
  await app.register(reportsRoutes);
  await app.register(templatesRoutes);
  await app.register(privacyRoutes);
  await app.register(invitesRoutes);
  await app.register(quotesRoutes);
  await app.register(milestonesRoutes);
  await app.register(onboardingFormsRoutes);
  await app.register(karaokeRoutes);
  await app.register(serverPetRoutes);
  await app.register(profileRoutes);
  await app.register(achievementsRoutes);
  await app.register(questsRoutes);
  await app.register(marketplaceRoutes);
  await app.register(fishingRoutes);
  await app.register(duelsRoutes);
  await app.register(authRoutes);
  await app.register(adminGuildsRoutes);
  await app.register(adminReactionRolesRoutes);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: ApiErrorCodes.BadRequest,
          message: 'Request validation failed.',
          details: err.validation,
        },
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') {
        return reply.code(404).send({
          error: { code: ApiErrorCodes.NotFound, message: 'Record not found.' },
        });
      }
      if (err.code === 'P2002') {
        return reply.code(409).send({
          error: {
            code: ApiErrorCodes.Conflict,
            message: 'Unique constraint violation.',
            details: { target: err.meta?.target },
          },
        });
      }
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({
      error: { code: ApiErrorCodes.Internal, message: 'Internal server error.' },
    });
  });

  return app;
}
