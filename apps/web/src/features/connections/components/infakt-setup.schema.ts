/**
 * Infakt Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided inFakt connection
 * wizard. inFakt is a Polish accounting platform authenticated with a single
 * API key (#1280/#1282). The form collects a connection name, the required
 * `apiKey` credential, and an optional advanced `baseUrl` config override
 * (sandbox vs. production). Mirrors `erli-setup.schema.ts`.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const INFAKT_ADAPTER_KEY = 'infakt.accounting.v1';

// Mirrors the BE config DTO posture (optional https-only base URL override).
const isHttps = (value: string): boolean => value.startsWith('https://');

// Mirrors the BE `InfaktPaymentMethodValues` enum (#1303) — kept as a plain
// literal here rather than a cross-package import since FE and BE are
// separate deployables (see other structured sections, e.g. dpd-setup-form's
// `environment` select).
export const INFAKT_PAYMENT_METHOD_VALUES = ['cash', 'transfer'] as const;

export const infaktSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  apiKey: z.string().trim().min(1, 'API key is required'),
  baseUrl: z
    .union([
      z
        .string()
        .trim()
        .url('Base URL must be a valid URL (e.g. https://api.infakt.pl)')
        .refine(isHttps, 'Base URL must use HTTPS'),
      z.literal(''),
    ])
    .optional(),
  defaultPaymentMethod: z.enum(INFAKT_PAYMENT_METHOD_VALUES),
});

export type InfaktSetupFormValues = z.input<typeof infaktSetupSchema>;
export type InfaktSetupFormSubmission = z.output<typeof infaktSetupSchema>;

export const INFAKT_SETUP_DEFAULT_VALUES: InfaktSetupFormValues = {
  name: '',
  apiKey: '',
  baseUrl: '',
  // Cash is fiscal-safe by default — transfer 422s on inFakt unless a bank
  // account is configured (see the help copy below and on the edit section).
  // Matches the adapter's own fallback in infakt-invoicing.adapter.ts.
  defaultPaymentMethod: 'cash',
};

export function toCreateConnectionInput(values: InfaktSetupFormSubmission): CreateConnectionInput {
  const config: Record<string, unknown> = { defaultPaymentMethod: values.defaultPaymentMethod };
  if (values.baseUrl && values.baseUrl.length > 0) {
    config.baseUrl = values.baseUrl;
  }

  return {
    name: values.name,
    platformType: 'infakt',
    adapterKey: INFAKT_ADAPTER_KEY,
    credentials: { apiKey: values.apiKey },
    config,
    // enabledCapabilities is OMITTED on purpose: on the omitted path
    // `ConnectionService.create` defaults to the adapter manifest's supported
    // set, so the inFakt connection lands with the capabilities the
    // registered `infakt.accounting.v1` adapter actually delivers (Invoicing).
  };
}
