/**
 * AI Provider Settings Form — Zod Schema
 *
 * Trims the pasted API key before validating (matches the BE DTO at
 * `apps/api/src/ai/http/dto/update-ai-provider-settings.dto.ts`, which
 * also trims). Length bounds align with the BE validators (8..512).
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { z } from 'zod';

export const MIN_API_KEY_LENGTH = 8;
export const MAX_API_KEY_LENGTH = 512;

export const aiProviderSettingsFormSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(MIN_API_KEY_LENGTH, `API key must be at least ${MIN_API_KEY_LENGTH} characters`)
    .max(MAX_API_KEY_LENGTH, `API key is too long (max ${MAX_API_KEY_LENGTH} characters)`),
});

export type AiProviderSettingsFormValues = z.input<typeof aiProviderSettingsFormSchema>;
export type AiProviderSettingsFormSubmission = z.output<typeof aiProviderSettingsFormSchema>;
