/**
 * KSeF Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided KSeF (Krajowy System
 * e-Faktur — Polish national e-invoicing) connection wizard. KSeF carries the
 * neutral `Invoicing` capability (ADR-026); the FE never reasons about the
 * Polish specifics beyond collecting the connection's environment, seller
 * context and authentication secret.
 *
 * Field mapping to the C2 backend shape validators
 * (`libs/integrations/ksef/.../ksef-connection-config-shape-validator.adapter.ts`
 * and `…-credentials-shape-validator.adapter.ts`, #1144):
 *
 *   - `config.env` → `KsefConnectionConfig.env` (`test` | `demo` | `prod`),
 *     the one field the BE config validator currently gates.
 *   - `config.sellerNip` / `config.contextIdentifier` are FE-additive context
 *     fields the operator supplies for display + future scoping; they are not
 *     gated by the C2 config validator yet (it only requires `env`), so they
 *     stay optional client-side and the server remains the authoritative gate.
 *   - `credentials.authType` → `KsefCredentials.authType`
 *     (`ksef-token` | `qualified-seal`).
 *   - `credentials.secret` carries the write-only secret the operator pastes.
 *     The API persists it in the integration credentials store and assigns a
 *     `db:<uuid>` reference (the BE's opaque `secretRef`); the secret value is
 *     never echoed back to the browser.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';
import { normalizeNip } from './ksef-nip';

export const KSEF_ADAPTER_KEY = 'ksef.publicapi.v2';

/** Mirrors `KsefEnvironmentValues` (C2). */
export const KSEF_ENVIRONMENT_VALUES = ['test', 'demo', 'prod'] as const;
export type KsefEnvironment = (typeof KSEF_ENVIRONMENT_VALUES)[number];

/** Mirrors `KsefAuthTypeValues` (C2). */
export const KSEF_AUTH_TYPE_VALUES = ['ksef-token', 'qualified-seal'] as const;
export type KsefAuthType = (typeof KSEF_AUTH_TYPE_VALUES)[number];

// Polish NIP — 10 digits, optionally separated by dashes/spaces the operator
// may paste. Stored normalised (digits only). Optional at the FE level because
// the C2 config validator only requires `env`; the server is the strict gate.
const NIP_DIGITS = /^\d{10}$/;

export const ksefSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  environment: z.enum(KSEF_ENVIRONMENT_VALUES),
  sellerNip: z
    .union([
      z
        .string()
        .trim()
        .transform(normalizeNip)
        .pipe(z.string().regex(NIP_DIGITS, 'Seller NIP must be 10 digits')),
      z.literal(''),
    ])
    .optional(),
  contextIdentifier: z.string().trim().max(64).optional(),
  authType: z.enum(KSEF_AUTH_TYPE_VALUES),
  // Write-only secret (KSeF authorization token / qualified-seal reference).
  secret: z.string().trim().min(1, 'Authentication secret is required'),
});

export type KsefSetupFormValues = z.input<typeof ksefSetupSchema>;
export type KsefSetupFormSubmission = z.output<typeof ksefSetupSchema>;

export const KSEF_SETUP_DEFAULT_VALUES: KsefSetupFormValues = {
  name: '',
  environment: 'test',
  sellerNip: '',
  contextIdentifier: '',
  authType: 'ksef-token',
  secret: '',
};

export function toCreateConnectionInput(values: KsefSetupFormSubmission): CreateConnectionInput {
  const config: Record<string, unknown> = { env: values.environment };
  if (values.sellerNip && values.sellerNip.length > 0) config.sellerNip = values.sellerNip;
  if (values.contextIdentifier && values.contextIdentifier.length > 0) {
    config.contextIdentifier = values.contextIdentifier;
  }

  return {
    name: values.name,
    platformType: 'ksef',
    adapterKey: KSEF_ADAPTER_KEY,
    // Capabilities default to the adapter manifest's set (`['Invoicing']`)
    // server-side when omitted — `Invoicing` is not in the FE's well-known
    // `CORE_CAPABILITY_VALUES`, so we deliberately do not send it.
    config,
    // Write-only: `secret` never round-trips back to the browser.
    credentials: { authType: values.authType, secret: values.secret },
  };
}
