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
import type { getInfaktMessages } from '../messages';

type InfaktWebhookSecretSchemaCopy = ReturnType<
  typeof getInfaktMessages
>['infaktWebhookSecretSchema'];

export function createInfaktWebhookSecretSchema(copy: InfaktWebhookSecretSchemaCopy) {
  return z.object({
    secret: z.string().trim().min(8, copy.tooShort).max(512, copy.tooLong),
  });
}

type InfaktWebhookSecretSchema = ReturnType<typeof createInfaktWebhookSecretSchema>;
export type InfaktWebhookSecretFormValues = z.input<InfaktWebhookSecretSchema>;
export type InfaktWebhookSecretFormSubmission = z.output<InfaktWebhookSecretSchema>;

export const INFAKT_WEBHOOK_SECRET_DEFAULT_VALUES: InfaktWebhookSecretFormValues = {
  secret: '',
};
