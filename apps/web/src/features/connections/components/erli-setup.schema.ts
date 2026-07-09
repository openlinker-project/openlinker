/**
 * Erli Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Erli connection
 * wizard. Erli is a marketplace authenticated with a single Shop API key
 * (sent as a Bearer token by the BE adapter, #981). The form collects a
 * connection name, the required `apiKey` credential, and an `environment`
 * select (Production/Sandbox, #1377). The payload persists the neutral
 * `config.environment` choice — the BE adapter factory resolves it to the
 * concrete Shop API base URL — so no sandbox-URL literal is duplicated on the
 * FE and a future URL change never leaves a stale literal in stored
 * connections. `enabledCapabilities` is intentionally omitted from the payload
 * so the API defaults it to the adapter manifest's supported set (#984/#993
 * ship `OfferManager` / `OrderSource`).
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const ERLI_ADAPTER_KEY = 'erli.shopapi.v1';

export const ErliEnvironmentValues = ['sandbox', 'production'] as const;

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
  return {
    name: values.name,
    platformType: 'erli',
    adapterKey: ERLI_ADAPTER_KEY,
    credentials: { apiKey: values.apiKey },
    // Persist the neutral choice, not a derived URL: the BE adapter factory
    // maps `environment` → the concrete Shop API base URL, so a future
    // sandbox-URL change can't leave a stale literal in this connection's config.
    config: { environment: values.environment },
    // enabledCapabilities is OMITTED on purpose: on the omitted path
    // `ConnectionService.create` defaults to the adapter manifest's supported
    // set (`rest.enabledCapabilities ?? [...metadata.supportedCapabilities]`),
    // so the Erli connection lands with the capabilities the registered
    // `erli.shopapi.v1` adapter actually delivers.
  };
}
