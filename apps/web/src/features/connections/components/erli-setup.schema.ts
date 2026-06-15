/**
 * Erli Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Erli connection
 * wizard. Erli is a marketplace authenticated with a single Shop API key
 * (sent as a Bearer token by the BE adapter, #981). The form collects a
 * connection name, the required `apiKey` credential, and an optional advanced
 * `baseUrl` config override. `enabledCapabilities` is intentionally omitted
 * from the payload so the API defaults it to the adapter manifest's supported
 * set (#984/#993 ship `OfferManager` / `OrderSource`).
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';

// Mirrors the BE config DTO posture (optional https-only base URL override).
const isHttps = (value: string): boolean => value.startsWith('https://');

export const erliSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  apiKey: z.string().trim().min(1, 'API key is required'),
  baseUrl: z
    .union([
      z
        .string()
        .trim()
        .url('Base URL must be a valid URL (e.g. https://api.erli.pl)')
        .refine(isHttps, 'Base URL must use HTTPS'),
      z.literal(''),
    ])
    .optional(),
});

export type ErliSetupFormValues = z.input<typeof erliSetupSchema>;
export type ErliSetupFormSubmission = z.output<typeof erliSetupSchema>;

export const ERLI_SETUP_DEFAULT_VALUES: ErliSetupFormValues = {
  name: '',
  apiKey: '',
  baseUrl: '',
};

export function toCreateConnectionInput(values: ErliSetupFormSubmission): CreateConnectionInput {
  const config: Record<string, unknown> = {};
  if (values.baseUrl && values.baseUrl.length > 0) {
    config.baseUrl = values.baseUrl;
  }

  return {
    name: values.name,
    platformType: 'erli',
    adapterKey: ERLI_ADAPTER_KEY,
    credentials: { apiKey: values.apiKey },
    config,
    // enabledCapabilities is OMITTED on purpose: on the omitted path
    // `ConnectionService.create` defaults to the adapter manifest's supported
    // set (`rest.enabledCapabilities ?? [...metadata.supportedCapabilities]`),
    // so the Erli connection lands with the capabilities the registered
    // `erli.shopapi.v1` adapter actually delivers.
  };
}
