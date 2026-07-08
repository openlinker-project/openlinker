/**
 * Erli Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Erli connection
 * wizard. Erli is a marketplace authenticated with a single Shop API key
 * (sent as a Bearer token by the BE adapter, #981). The form collects a
 * connection name, the required `apiKey` credential, and an `environment`
 * select (Production/Sandbox, #1377) that maps to an optional `baseUrl`
 * config override. `enabledCapabilities` is intentionally omitted from the
 * payload so the API defaults it to the adapter manifest's supported set
 * (#984/#993 ship `OfferManager` / `OrderSource`).
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';

// Mirrors the BE source of truth (libs/integrations/erli/src/domain/types
// /erli-connection.types.ts) — duplicated as a literal since apps/web has no
// path alias into libs/integrations/* packages.
export const ERLI_SANDBOX_BASE_URL = 'https://sandbox.erli.dev/svc/shop-api';

export const ErliEnvironmentValues = ['sandbox', 'production'] as const;
export type ErliEnvironment = (typeof ErliEnvironmentValues)[number];

export const erliSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  apiKey: z.string().trim().min(1, 'API key is required'),
  environment: z.enum(ErliEnvironmentValues),
});

export type ErliSetupFormValues = z.input<typeof erliSetupSchema>;
export type ErliSetupFormSubmission = z.output<typeof erliSetupSchema>;

export const ERLI_SETUP_DEFAULT_VALUES: ErliSetupFormValues = {
  name: '',
  apiKey: '',
  environment: 'sandbox',
};

export function toCreateConnectionInput(values: ErliSetupFormSubmission): CreateConnectionInput {
  const config: Record<string, unknown> = {};
  if (values.environment === 'sandbox') {
    config.baseUrl = ERLI_SANDBOX_BASE_URL;
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
