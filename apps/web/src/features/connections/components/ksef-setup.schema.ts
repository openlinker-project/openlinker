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
 *   - `config.seller.{nip,name,address}` → `KsefSellerConfig` (#1223). The
 *     adapter's `resolveSeller` (`ksef-adapter.factory.ts`) requires a
 *     well-formed seller profile and throws `KsefConfigException` at issuance
 *     when it's missing — so the wizard collects the full profile (NIP, legal
 *     name, postal address) and persists the nested `config.seller` shape the
 *     adapter reads. This is the canonical NIP location; there is no flat
 *     `config.sellerNip`. The fields stay optional client-side (so the
 *     operator can save incremental progress); the server is the strict gate.
 *   - `config.contextIdentifier` is an FE-additive context field the operator
 *     supplies for display + future scoping; not gated by the C2 config
 *     validator yet (it only requires `env`). It does NOT affect
 *     authentication — the token-auth session always uses `config.seller.nip`
 *     as the KSeF context identifier.
 *   - `credentials.authType` → `KsefCredentials.authType`
 *     (`ksef-token` | `qualified-seal`).
 *   - `credentials.secret` carries the write-only secret the operator pastes.
 *     The API persists it in the integration credentials store and assigns a
 *     `db:<uuid>` reference (stored as the connection's `credentialsRef`); the
 *     secret value is never echoed back to the browser.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';
import { normalizeNip } from './ksef-nip';
import { buildKsefSellerConfig } from './ksef-seller-config';
export type { KsefSellerProfileInput } from './ksef-seller-config';

export const KSEF_ADAPTER_KEY = 'ksef.publicapi.v2';

/** Mirrors `KsefEnvironmentValues` (C2). */
export const KSEF_ENVIRONMENT_VALUES = ['test', 'demo', 'prod'] as const;
export type KsefEnvironment = (typeof KSEF_ENVIRONMENT_VALUES)[number];

/** Mirrors `KsefAuthTypeValues` (C2). */
export const KSEF_AUTH_TYPE_VALUES = ['ksef-token', 'qualified-seal'] as const;
export type KsefAuthType = (typeof KSEF_AUTH_TYPE_VALUES)[number];

/**
 * Mirrors `KsefFormaPlatnosciValues` (FA(3) `TFormaPlatnosci`, #1311) — the
 * connection-level default payment method emitted into `Platnosc/FormaPlatnosci`.
 * Declared three times by design (FE here, plugin connection-config layer
 * `ksef-connection.types.ts`, FA3 schema layer `fa3-schema.types.ts`) — a
 * future 8th code must be added in all three places. Drift against this list
 * is caught by the repo-level `scripts/check-ksef-forma-platnosci-drift.mjs`
 * invariant (`pnpm check:invariants`).
 */
export const KSEF_FORMA_PLATNOSCI_VALUES = ['1', '2', '3', '4', '5', '6', '7'] as const;
export type KsefFormaPlatnosci = (typeof KSEF_FORMA_PLATNOSCI_VALUES)[number];

// Polish NIP — 10 digits, optionally separated by dashes/spaces the operator
// may paste. Stored normalised (digits only). Optional at the FE level because
// the C2 config validator only requires `env`; the server is the strict gate.
const NIP_DIGITS = /^\d{10}$/;

// ISO 3166-1 alpha-2 — two uppercase letters. Mirrors the adapter's
// `address.countryIso2` field. Defaults to `PL` since KSeF is Polish-domestic.
const COUNTRY_ISO2 = /^[A-Z]{2}$/;

// Polish postal code — NN-NNN. Enforced only for PL addresses (KSeF is
// PL-domestic); `''` stays allowed so the operator can save incremental
// progress. Shared verbatim with the edit schema (`edit-connection.schema.ts`).
export const POLISH_POSTAL_CODE = /^\d{2}-\d{3}$/;

export const ksefSetupSchema = z
  .object({
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
    sellerName: z.string().trim().max(512).optional(),
    sellerAddressLine1: z.string().trim().max(512).optional(),
    sellerAddressLine2: z.string().trim().max(512).optional(),
    sellerCity: z.string().trim().max(256).optional(),
    sellerPostalCode: z.string().trim().max(32).optional(),
    sellerCountryIso2: z
      .union([
        z
          .string()
          .trim()
          .transform((value) => value.toUpperCase())
          .pipe(z.string().regex(COUNTRY_ISO2, 'Country must be a 2-letter ISO code (e.g. PL)')),
        z.literal(''),
      ])
      .optional(),
    contextIdentifier: z.string().trim().max(64).optional(),
    authType: z.enum(KSEF_AUTH_TYPE_VALUES),
    // Write-only secret (KSeF authorization token / qualified-seal reference).
    secret: z.string().trim().min(1, 'Authentication secret is required'),
  })
  // Postal code is PL-format-gated (KSeF is PL-domestic). Empty stays allowed
  // for incremental save; the rule applies only when the seller country is PL
  // (the wizard default). The `sellerCountryIso2` transform has already
  // upper-cased the value by the time the refine runs.
  .superRefine((values, ctx) => {
    const postalCode = (values.sellerPostalCode ?? '').trim();
    const countryIso2 = (values.sellerCountryIso2 ?? '').trim().toUpperCase();
    if (countryIso2 === 'PL' && postalCode.length > 0 && !POLISH_POSTAL_CODE.test(postalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sellerPostalCode'],
        message: 'Postal code must use the PL format NN-NNN.',
      });
    }
  });

export type KsefSetupFormValues = z.input<typeof ksefSetupSchema>;
export type KsefSetupFormSubmission = z.output<typeof ksefSetupSchema>;

export const KSEF_SETUP_DEFAULT_VALUES: KsefSetupFormValues = {
  name: '',
  environment: 'test',
  sellerNip: '',
  sellerName: '',
  sellerAddressLine1: '',
  sellerAddressLine2: '',
  sellerCity: '',
  sellerPostalCode: '',
  sellerCountryIso2: 'PL',
  contextIdentifier: '',
  authType: 'ksef-token',
  secret: '',
};

// `buildKsefSellerConfig` (assembly) lives in the shared `ksef-seller-config`
// module so the create path here and the edit path
// (`edit-connection.schema.ts`) normalize + assemble the nested `config.seller`
// shape through one source. Re-exported for back-compat with existing imports.
export { buildKsefSellerConfig } from './ksef-seller-config';

export function toCreateConnectionInput(values: KsefSetupFormSubmission): CreateConnectionInput {
  const config: Record<string, unknown> = { env: values.environment };
  const seller = buildKsefSellerConfig(values);
  if (seller) config.seller = seller;
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
