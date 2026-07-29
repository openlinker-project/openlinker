/**
 * inFakt Webhook Secret Form Schema
 *
 * Zod schema for the "paste back the signing secret" field in
 * `InfaktWebhookConfig` (#1770). Bounds mirror the backend's
 * `SetWebhookSecretDto` (`@MinLength(8) @MaxLength(512)`) so an obviously
 * too-short paste is caught inline instead of round-tripping to a 400.
 *
 * @module features/connections/components
 */
import { z } from 'zod';

export const infaktWebhookSecretSchema = z.object({
  secret: z
    .string()
    .trim()
    .min(8, 'Secret must be at least 8 characters')
    .max(512, 'Secret must be at most 512 characters'),
});

export type InfaktWebhookSecretFormValues = z.input<typeof infaktWebhookSecretSchema>;
export type InfaktWebhookSecretFormSubmission = z.output<typeof infaktWebhookSecretSchema>;

export const INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES: InfaktWebhookSecretFormValues = {
  secret: '',
};
