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
import { PosthogRegionValues } from '../api/posthog-settings.types';

export const MAX_HOST_LENGTH = 255;
export const MAX_API_KEY_LENGTH = 128;
const URL_PATTERN = /^https?:\/\/.+/i;

export const posthogSettingsFormSchema = z
  .object({
    enabled: z.boolean(),
    region: z.enum(PosthogRegionValues),
    customHost: z.string().trim().max(MAX_HOST_LENGTH, `Host is too long (max ${MAX_HOST_LENGTH} characters)`),
    autocapture: z.boolean(),
    sessionRecording: z.boolean(),
    apiKey: z
      .string()
      .trim()
      .max(MAX_API_KEY_LENGTH, `API key is too long (max ${MAX_API_KEY_LENGTH} characters)`),
  })
  .superRefine((values, ctx) => {
    if (values.region !== 'custom') {
      return;
    }

    if (values.customHost.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customHost'],
        message: 'Host URL is required for a custom region',
      });
    } else if (!URL_PATTERN.test(values.customHost)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customHost'],
        message: 'Enter a valid http(s) URL',
      });
    }
  });

export type PosthogSettingsFormValues = z.input<typeof posthogSettingsFormSchema>;
export type PosthogSettingsFormSubmission = z.output<typeof posthogSettingsFormSchema>;
