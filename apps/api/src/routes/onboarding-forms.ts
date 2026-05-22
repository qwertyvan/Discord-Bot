import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  Application as PrismaApplication,
  OnboardingForm as PrismaOnboardingForm,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import {
  ApplicationAnswersSchema,
  ApplicationStatusSchema,
  CreateApplicationSchema,
  FormQuestionSchema,
  ReviewApplicationSchema,
  SnowflakeSchema,
  UpsertOnboardingFormSchema,
  type ApplicationAnswers,
  type ApplicationStatus,
  type FormQuestion,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const FormSlugParams = z.object({ guildId: SnowflakeSchema, slug: z.string().min(1).max(48) });
const FormIdParams = z.object({ guildId: SnowflakeSchema, formId: z.string().uuid() });
const ApplicationParams = z.object({
  guildId: SnowflakeSchema,
  applicationId: z.string().uuid(),
});

function serializeForm(f: PrismaOnboardingForm) {
  // `questions` is stored as JSON; parse defensively so an admin who hand-edits
  // the DB row can't crash the route.
  const parsed = z.array(FormQuestionSchema).safeParse(f.questions);
  const questions: FormQuestion[] = parsed.success ? parsed.data : [];
  return {
    id: f.id,
    guildId: f.guildId,
    slug: f.slug,
    name: f.name,
    description: f.description,
    questions,
    reviewChannelId: f.reviewChannelId,
    approveRoleId: f.approveRoleId,
    approveDmMessage: f.approveDmMessage,
    rejectDmTemplate: f.rejectDmTemplate,
    enabled: f.enabled,
    createdBy: f.createdBy,
    createdAt: f.createdAt.toISOString(),
  };
}

function serializeApplication(a: PrismaApplication) {
  const parsed = ApplicationAnswersSchema.safeParse(a.answers);
  const answers: ApplicationAnswers = parsed.success ? parsed.data : {};
  return {
    id: a.id,
    guildId: a.guildId,
    formId: a.formId,
    userId: a.userId,
    answers,
    status: a.status as ApplicationStatus,
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    reviewNote: a.reviewNote,
    reviewMessageId: a.reviewMessageId,
    createdAt: a.createdAt.toISOString(),
  };
}

export const onboardingFormsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Form CRUD ──────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/onboarding-forms',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.onboardingForm.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'asc' },
      });
      return { forms: items.map(serializeForm) };
    },
  );

  app.get(
    '/guilds/:guildId/onboarding-forms/:slug',
    { preHandler: app.requireBot(), schema: { params: FormSlugParams } },
    async (req) => {
      const item = await app.prisma.onboardingForm.findUnique({
        where: { guildId_slug: { guildId: req.params.guildId, slug: req.params.slug } },
      });
      if (!item) throw HttpError.notFound('Form not found.');
      return serializeForm(item);
    },
  );

  app.post(
    '/guilds/:guildId/onboarding-forms',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertOnboardingFormSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      if (!req.body.slug || !req.body.name || !req.body.questions) {
        throw HttpError.badRequest('slug, name and questions are required.');
      }
      try {
        const created = await app.prisma.onboardingForm.create({
          data: {
            guildId,
            slug: req.body.slug,
            name: req.body.name,
            description: req.body.description ?? null,
            questions: req.body.questions as unknown as Prisma.InputJsonValue,
            reviewChannelId: req.body.reviewChannelId ?? null,
            approveRoleId: req.body.approveRoleId ?? null,
            approveDmMessage: req.body.approveDmMessage ?? null,
            rejectDmTemplate: req.body.rejectDmTemplate ?? null,
            enabled: req.body.enabled ?? true,
            createdBy: req.body.createdBy ?? '0',
          },
        });
        return serializeForm(created);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw HttpError.conflict('A form with that slug already exists.');
        }
        throw err;
      }
    },
  );

  app.patch(
    '/guilds/:guildId/onboarding-forms/:formId',
    {
      preHandler: app.requireBot(),
      schema: { params: FormIdParams, body: UpsertOnboardingFormSchema },
    },
    async (req) => {
      const existing = await app.prisma.onboardingForm.findFirst({
        where: { id: req.params.formId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Form not found.');
      const data: Prisma.OnboardingFormUpdateInput = {};
      if (req.body.slug !== undefined) data.slug = req.body.slug;
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.questions !== undefined) {
        data.questions = req.body.questions as unknown as Prisma.InputJsonValue;
      }
      if (req.body.reviewChannelId !== undefined) data.reviewChannelId = req.body.reviewChannelId;
      if (req.body.approveRoleId !== undefined) data.approveRoleId = req.body.approveRoleId;
      if (req.body.approveDmMessage !== undefined) data.approveDmMessage = req.body.approveDmMessage;
      if (req.body.rejectDmTemplate !== undefined) data.rejectDmTemplate = req.body.rejectDmTemplate;
      if (req.body.enabled !== undefined) data.enabled = req.body.enabled;
      try {
        const updated = await app.prisma.onboardingForm.update({
          where: { id: req.params.formId },
          data,
        });
        return serializeForm(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw HttpError.conflict('A form with that slug already exists.');
        }
        throw err;
      }
    },
  );

  app.delete(
    '/guilds/:guildId/onboarding-forms/:formId',
    { preHandler: app.requireBot(), schema: { params: FormIdParams } },
    async (req, reply) => {
      const result = await app.prisma.onboardingForm.deleteMany({
        where: { id: req.params.formId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Form not found.');
      return reply.code(204).send();
    },
  );

  // ─── Applications ────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/applications',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: ApplicationStatusSchema.optional(),
          formId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.application.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.formId ? { formId: req.query.formId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { applications: items.map(serializeApplication) };
    },
  );

  app.get(
    '/guilds/:guildId/applications/:applicationId',
    { preHandler: app.requireBot(), schema: { params: ApplicationParams } },
    async (req) => {
      const item = await app.prisma.application.findFirst({
        where: { id: req.params.applicationId, guildId: req.params.guildId },
      });
      if (!item) throw HttpError.notFound('Application not found.');
      return serializeApplication(item);
    },
  );

  app.post(
    '/guilds/:guildId/applications',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateApplicationSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const form = await app.prisma.onboardingForm.findFirst({
        where: { id: req.body.formId, guildId },
      });
      if (!form) throw HttpError.notFound('Form not found.');
      const created = await app.prisma.application.create({
        data: {
          guildId,
          formId: req.body.formId,
          userId: req.body.userId,
          answers: req.body.answers as unknown as Prisma.InputJsonValue,
        },
      });
      return serializeApplication(created);
    },
  );

  app.patch(
    '/guilds/:guildId/applications/:applicationId',
    {
      preHandler: app.requireBot(),
      schema: { params: ApplicationParams, body: ReviewApplicationSchema },
    },
    async (req) => {
      const existing = await app.prisma.application.findFirst({
        where: { id: req.params.applicationId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Application not found.');
      const data: Prisma.ApplicationUpdateInput = {};
      if (req.body.status !== undefined) data.status = req.body.status;
      if (req.body.reviewedBy !== undefined) data.reviewedBy = req.body.reviewedBy;
      if (req.body.reviewedAt !== undefined) data.reviewedAt = new Date(req.body.reviewedAt);
      if (req.body.reviewNote !== undefined) data.reviewNote = req.body.reviewNote;
      if (req.body.reviewMessageId !== undefined) data.reviewMessageId = req.body.reviewMessageId;
      const updated = await app.prisma.application.update({
        where: { id: req.params.applicationId },
        data,
      });
      return serializeApplication(updated);
    },
  );
};
