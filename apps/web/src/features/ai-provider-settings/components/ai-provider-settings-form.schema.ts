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
import { interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';

export const MIN_API_KEY_LENGTH = 8;
export const MAX_API_KEY_LENGTH = 512;

type SchemaCopy = ResolvedCopy<Messages['ai-provider-settings']>['aiProviderSettingsFormSchema'];

type AiProviderSettingsFormSchema = z.ZodObject<{ apiKey: z.ZodString }>;

export function createAiProviderSettingsFormSchema(copy: SchemaCopy): AiProviderSettingsFormSchema {
  return z.object({
    apiKey: z
      .string()
      .trim()
      .min(MIN_API_KEY_LENGTH, interpolate(copy.apiKeyTooShort, { min: MIN_API_KEY_LENGTH }))
      .max(MAX_API_KEY_LENGTH, interpolate(copy.apiKeyTooLong, { max: MAX_API_KEY_LENGTH })),
  });
}

export type AiProviderSettingsFormValues = z.input<AiProviderSettingsFormSchema>;
export type AiProviderSettingsFormSubmission = z.output<AiProviderSettingsFormSchema>;
