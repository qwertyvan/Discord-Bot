import { z } from 'zod';

/**
 * Discord snowflake: a 64-bit unsigned integer serialised as a string of digits.
 * In practice always 17–20 characters.
 */
export const SnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Must be a Discord snowflake (17–20 digit string).');

export type Snowflake = z.infer<typeof SnowflakeSchema>;
