/**
 * PostHog Settings Form — Zod Schema
 *
 * `customHost` is only required (and validated as a URL) when
 * `region === 'custom'` — mirrors the backend DTO comment ("the controller
 * does not cross-validate this... trusting the admin form"), so this is
 * exactly where that validation belongs (same pattern as
 * `mailer-settings-form.schema.ts`'s smtp-conditional fields). The API key
 * field is always optional: leaving it blank keeps whatever is already
 * stored server-side (write-only, never pre-filled).
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { z } from 'zod';
import { interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { PosthogRegionValues } from '../api/posthog-settings.types';

export const MAX_HOST_LENGTH = 255;
export const MAX_API_KEY_LENGTH = 128;
const URL_PATTERN = /^https?:\/\/.+/i;

export type PosthogSettingsFormSchemaCopy = ResolvedCopy<
  Messages['posthog-settings']
>['posthogSettingsFormSchema'];

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the zod type is inferred from this builder
export function createPosthogSettingsFormSchema(copy: PosthogSettingsFormSchemaCopy) {
  return z
    .object({
      enabled: z.boolean(),
      region: z.enum(PosthogRegionValues),
      customHost: z
        .string()
        .trim()
        .max(MAX_HOST_LENGTH, interpolate(copy.hostTooLong, { max: MAX_HOST_LENGTH })),
      autocapture: z.boolean(),
      sessionRecording: z.boolean(),
      productEventsEnabled: z.boolean(),
      enabledEventGroups: z.array(z.string()),
      apiKey: z
        .string()
        .trim()
        .max(MAX_API_KEY_LENGTH, interpolate(copy.apiKeyTooLong, { max: MAX_API_KEY_LENGTH })),
    })
    .superRefine((values, ctx) => {
      if (values.region !== 'custom') {
        return;
      }

      if (values.customHost.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customHost'],
          message: copy.hostRequired,
        });
      } else if (!URL_PATTERN.test(values.customHost)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customHost'],
          message: copy.hostInvalid,
        });
      }
    });
}

type PosthogSettingsFormSchema = ReturnType<typeof createPosthogSettingsFormSchema>;
export type PosthogSettingsFormValues = z.input<PosthogSettingsFormSchema>;
export type PosthogSettingsFormSubmission = z.output<PosthogSettingsFormSchema>;
