import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// ─── Form questions ──────────────────────────────────────────────────────
// Discord modal label cap is 45 chars; we keep one question per modal row
// (max 5 rows). `maxLength` mirrors Discord's TextInput cap (1–4000).

export const FormQuestionStyleSchema = z.enum(['short', 'paragraph']);
export type FormQuestionStyle = z.infer<typeof FormQuestionStyleSchema>;

export const FormQuestionSchema = z.object({
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).optional(),
  required: z.boolean(),
  maxLength: z.number().int().min(1).max(4000),
  style: FormQuestionStyleSchema,
});

export type FormQuestion = z.infer<typeof FormQuestionSchema>;

// Slugs are used in `/apply <slug>` so we restrict to URL-safe characters.
export const FormSlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Slugs must be lowercase alphanumerics, "-" or "_".');

export const OnboardingFormSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: FormSlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  questions: z.array(FormQuestionSchema).min(1).max(5),
  reviewChannelId: SnowflakeSchema.nullable(),
  approveRoleId: SnowflakeSchema.nullable(),
  approveDmMessage: z.string().max(2000).nullable(),
  rejectDmTemplate: z.string().max(2000).nullable(),
  enabled: z.boolean(),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
});

export type OnboardingForm = z.infer<typeof OnboardingFormSchema>;

// Used for both POST (create) and PATCH (update); on POST slug/name/questions
// are required and on PATCH everything is optional.
export const UpsertOnboardingFormSchema = z.object({
  slug: FormSlugSchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  questions: z.array(FormQuestionSchema).min(1).max(5).optional(),
  reviewChannelId: SnowflakeSchema.nullable().optional(),
  approveRoleId: SnowflakeSchema.nullable().optional(),
  approveDmMessage: z.string().max(2000).nullable().optional(),
  rejectDmTemplate: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  createdBy: SnowflakeSchema.optional(),
});

export type UpsertOnboardingFormInput = z.infer<typeof UpsertOnboardingFormSchema>;

// ─── Applications ────────────────────────────────────────────────────────

export const ApplicationStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

// Answers are keyed by the question label as captured at submit time so
// historic submissions remain readable even if the form's questions change.
export const ApplicationAnswersSchema = z.record(z.string(), z.string());
export type ApplicationAnswers = z.infer<typeof ApplicationAnswersSchema>;

export const ApplicationSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  formId: z.string().uuid(),
  userId: SnowflakeSchema,
  answers: ApplicationAnswersSchema,
  status: ApplicationStatusSchema,
  reviewedBy: SnowflakeSchema.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewNote: z.string().max(500).nullable(),
  reviewMessageId: SnowflakeSchema.nullable(),
  createdAt: z.string().datetime(),
});

export type Application = z.infer<typeof ApplicationSchema>;

export const CreateApplicationSchema = z.object({
  formId: z.string().uuid(),
  userId: SnowflakeSchema,
  answers: ApplicationAnswersSchema,
});

export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>;

export const ReviewApplicationSchema = z.object({
  status: ApplicationStatusSchema.optional(),
  reviewedBy: SnowflakeSchema.optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewNote: z.string().max(500).nullable().optional(),
  reviewMessageId: SnowflakeSchema.nullable().optional(),
});

export type ReviewApplicationInput = z.infer<typeof ReviewApplicationSchema>;
