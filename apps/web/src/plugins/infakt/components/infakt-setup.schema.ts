/**
 * Infakt Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided inFakt connection
 * wizard. inFakt is a Polish accounting platform authenticated with a single
 * API key (#1280/#1282). The form collects a connection name, the required
 * `apiKey` credential, and an `environment` select (Production/Sandbox,
 * #2174) — mirrors `erli-setup.schema.ts`. The payload persists the neutral
 * `config.environment` choice; the BE adapter factory resolves it to the
 * concrete API base URL, so no sandbox-URL literal is duplicated on the FE.
 * A legacy free-text `baseUrl` override still exists on the BE config type
 * for backward compatibility with connections created before this select
 * existed, but is intentionally not exposed on this form.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const INFAKT_ADAPTER_KEY = 'infakt.accounting.v1';

// Mirrors the BE `InfaktEnvironmentValues` enum (#2174) — kept as a plain
// literal here rather than a cross-package import since FE and BE are
// separate deployables (see erli-setup.schema.ts's `ErliEnvironmentValues`).
export const INFAKT_ENVIRONMENT_VALUES = ['sandbox', 'production'] as const;

// Mirrors the BE `InfaktPaymentMethodValues` enum (#1303) — kept as a plain
// literal here rather than a cross-package import since FE and BE are
// separate deployables (see other structured sections, e.g. dpd-setup-form's
// `environment` select).
export const INFAKT_PAYMENT_METHOD_VALUES = ['cash', 'transfer'] as const;

export const infaktSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  apiKey: z.string().trim().min(1, 'API key is required'),
  environment: z.enum(INFAKT_ENVIRONMENT_VALUES),
  defaultPaymentMethod: z.enum(INFAKT_PAYMENT_METHOD_VALUES),
});

export type InfaktSetupFormValues = z.input<typeof infaktSetupSchema>;
export type InfaktSetupFormSubmission = z.output<typeof infaktSetupSchema>;

export const INFAKT_SETUP_DEFAULT_VALUES: InfaktSetupFormValues = {
  name: '',
  apiKey: '',
  // Production, not sandbox — a deliberate deviation from Erli's sandbox
  // default (#2174). An operator who doesn't notice they're still on sandbox
  // gets invoices that never reach KSeF; defaulting to production is the
  // fiscal-safe choice for an invoicing integration.
  environment: 'production',
  // Cash is fiscal-safe by default — transfer 422s on inFakt unless a bank
  // account is configured (see the help copy below and on the edit section).
  // Matches the adapter's own fallback in infakt-invoicing.adapter.ts.
  defaultPaymentMethod: 'cash',
};

export function toCreateConnectionInput(values: InfaktSetupFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'infakt',
    adapterKey: INFAKT_ADAPTER_KEY,
    credentials: { apiKey: values.apiKey },
    // Persist the neutral choice, not a derived URL: the BE adapter factory
    // maps `environment` → the concrete API base URL, so a future
    // sandbox-URL change can't leave a stale literal in this connection's config.
    config: { defaultPaymentMethod: values.defaultPaymentMethod, environment: values.environment },
    // enabledCapabilities is OMITTED on purpose: on the omitted path
    // `ConnectionService.create` defaults to the adapter manifest's supported
    // set, so the inFakt connection lands with the capabilities the
    // registered `infakt.accounting.v1` adapter actually delivers (Invoicing).
  };
}
