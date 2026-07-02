/**
 * KSeF Connection-Config Contribution (#1330)
 *
 * The non-render half of KSeF's structured connection-config editing, plugged
 * into `EditConnectionForm` via `PlatformContribution.connectionConfig`:
 *
 *   - `schemaShape` — the Zod field fragment (environment, seller profile
 *     #1223, context identifier #1152, payment defaults #1311) merged into the
 *     edit-connection schema when a KSeF connection is edited.
 *   - `superRefine` — the PL postal-code format gate and the skonto
 *     both-or-neither pair (submit-time checks; per-keystroke sync still
 *     persists partial pairs so the first-typed field is never dropped).
 *   - `readConfigToForm` — hydration from `config.{env,seller,payment,
 *     contextIdentifier}` (with the legacy flat `config.sellerNip` fallback).
 *   - `applyToConfig` — per-keystroke partial-patch assembly delegating to the
 *     shared create/edit primitives (`applyKsefSellerToConfig`,
 *     `applyKsefPaymentToConfig`) plus the flat `env` / `contextIdentifier`
 *     delete-on-empty clauses.
 *
 * The `declare module` block below merges the KSeF field names into
 * `PluginEditConnectionFields` so `form.register('sellerNip')` etc. stay
 * statically typed in `ksef-structured-section.tsx`. It enters the TS import
 * graph through `plugins/ksef/index.ts` → `plugins/index.ts` (same guarantee
 * `apiNamespaces` declaration merging relies on).
 *
 * @module plugins/ksef
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readConfigString, readOptionalConfigString } from '../../shared/plugins';
import { normalizeNip } from './lib/ksef-nip';
import { normalizeNrRb } from './lib/ksef-nrb';
import { applyKsefSellerToConfig, type KsefSellerProfileInput } from './lib/ksef-seller-config';
import { applyKsefPaymentToConfig, type KsefPaymentInput } from './lib/ksef-payment-config';
import {
  KSEF_ENVIRONMENT_VALUES,
  KSEF_FORMA_PLATNOSCI_VALUES,
  POLISH_POSTAL_CODE,
} from './components/ksef-setup.schema';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** KSeF environment — `config.env` (#1152). Empty string clears the key. */
    ksefEnvironment?: string;
    /**
     * KSeF seller-profile sub-fields (#1223) — leaves of the nested
     * `config.seller.{nip,name,address}` shape the adapter's `resolveSeller`
     * reads. NIP is normalised to digits only, matching the create path.
     */
    sellerNip?: string;
    sellerName?: string;
    sellerAddressLine1?: string;
    sellerAddressLine2?: string;
    sellerCity?: string;
    sellerPostalCode?: string;
    sellerCountryIso2?: string;
    /** KSeF context identifier — `config.contextIdentifier` (#1152). */
    contextIdentifier?: string;
    /**
     * KSeF connection-level payment defaults (#1311) — nested
     * `config.payment.*`, manually entered (KSeF has no live bank-accounts
     * API, unlike inFakt's #1303/#1308).
     */
    paymentFormaPlatnosci?: string;
    paymentBankAccountNrRb?: string;
    paymentBankAccountBankName?: string;
    paymentBankAccountSwift?: string;
    paymentTermDays?: string;
    paymentSkontoConditions?: string;
    paymentSkontoAmount?: string;
  }
}

/**
 * KSeF structured fields for the edit-connection form. All optional
 * client-side so the operator can save incremental progress; the BE shape
 * validator is the strict gate. `ksefEnvironment` maps to the BE C2
 * `KsefConnectionConfig.env` enum (the one config-validator-gated field); the
 * form field is named `ksefEnvironment` to avoid colliding with DPD's flat
 * `environment` key.
 */
// The explicit annotation keeps TS's excess-property check live on this
// separate const (an un-annotated const referenced at `schemaShape:` below
// would silently accept a typo'd or never-merged key — TS2561 only fires on
// fresh/annotated literals).
const ksefSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  ksefEnvironment: z.union([z.enum(KSEF_ENVIRONMENT_VALUES), z.literal('')]).optional(),
  // NIP normalization mirrors the setup wizard (`ksef-setup.schema.ts`): strip
  // dashes/spaces the operator may paste, then enforce 10 digits. Without this
  // parity a value saved with separators on create fails the edit-schema check.
  sellerNip: z
    .union([
      z
        .string()
        .transform(normalizeNip)
        .refine((v) => v === '' || /^\d{10}$/.test(v), {
          message: 'Seller NIP must be 10 digits.',
        }),
      z.literal(''),
    ])
    .optional(),
  sellerName: z.union([z.string().trim().max(512), z.literal('')]).optional(),
  sellerAddressLine1: z.union([z.string().trim().max(512), z.literal('')]).optional(),
  sellerAddressLine2: z.union([z.string().trim().max(512), z.literal('')]).optional(),
  sellerCity: z.union([z.string().trim().max(256), z.literal('')]).optional(),
  sellerPostalCode: z.union([z.string().trim().max(32), z.literal('')]).optional(),
  sellerCountryIso2: z
    .union([
      z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), {
          message: 'Country must be a 2-letter ISO code (e.g. PL).',
        }),
      z.literal(''),
    ])
    .optional(),
  contextIdentifier: z.union([z.string().trim().max(64), z.literal('')]).optional(),
  paymentFormaPlatnosci: z
    .union([z.enum(KSEF_FORMA_PLATNOSCI_VALUES), z.literal('')])
    .optional(),
  // Whitespace-stripped via `normalizeNrRb` (mirrors the `normalizeNip`
  // precedent) so the length bound counts the same characters the persisted
  // wire value carries — a conventionally-spaced NRB paste stays valid.
  paymentBankAccountNrRb: z
    .union([
      z
        .string()
        .transform(normalizeNrRb)
        .refine((v) => v === '' || (v.length >= 10 && v.length <= 34), {
          message: 'Bank account number must be 10-34 characters (per the FA(3) NrRB format).',
        }),
      z.literal(''),
    ])
    .optional(),
  paymentBankAccountBankName: z.union([z.string().trim().max(256), z.literal('')]).optional(),
  paymentBankAccountSwift: z.union([z.string().trim().max(16), z.literal('')]).optional(),
  // Capped at 999 days — the XSD `Ilosc` type is unbounded so an absurd
  // value (a fat-fingered `1400`) would sail through to the wire; the cap
  // catches the obvious typo while leaving every realistic term available.
  // Mirrored by the BE shape validator's 0-999 bound.
  paymentTermDays: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d+$/, 'Payment term must be a non-negative whole number of days.')
        .refine((v) => Number.parseInt(v, 10) <= 999, {
          message: 'Payment term must be at most 999 days.',
        }),
      z.literal(''),
    ])
    .optional(),
  paymentSkontoConditions: z.union([z.string().trim().max(512), z.literal('')]).optional(),
  paymentSkontoAmount: z.union([z.string().trim().max(64), z.literal('')]).optional(),
};

function ksefSuperRefine(values: Record<string, unknown>, ctx: z.RefinementCtx): void {
  // KSeF postal code is PL-format-gated (#1223), matching the create wizard.
  // Empty stays allowed for incremental save. KSeF is PL-domestic, so an
  // unset/blank country on this partial-edit form is treated as PL; an explicit
  // non-PL country opts out of the check.
  const postalCode = readConfigString(values, 'sellerPostalCode').trim();
  if (postalCode.length > 0) {
    const countryIso2 = readConfigString(values, 'sellerCountryIso2').trim().toUpperCase();
    const isDomesticPl = countryIso2 === '' || countryIso2 === 'PL';
    if (isDomesticPl && !POLISH_POSTAL_CODE.test(postalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sellerPostalCode'],
        message: 'Postal code must use the PL format NN-NNN.',
      });
    }
  }
  // KSeF skonto (early-payment discount) is a both-or-neither pair (#1311).
  // The FE deliberately persists a partial pair into configText per keystroke
  // (per-keystroke sync must never drop the first-typed field), so this check
  // fires only at submit time and anchors the error on the missing field —
  // otherwise the operator gets the BE shape validator's form-level 400.
  // The BE validator stays the strict gate for direct API writes.
  const skontoConditions = readConfigString(values, 'paymentSkontoConditions').trim();
  const skontoAmount = readConfigString(values, 'paymentSkontoAmount').trim();
  if (skontoConditions.length > 0 && skontoAmount.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['paymentSkontoAmount'],
      message: 'Discount amount is required when discount conditions are set.',
    });
  } else if (skontoAmount.length > 0 && skontoConditions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['paymentSkontoConditions'],
      message: 'Discount conditions are required when a discount amount is set.',
    });
  }
}

/** Read the KSeF environment out of `config.env` (#1152). */
function readKsefEnvironment(config: Record<string, unknown>): string {
  const value = config.env;
  return value === 'test' || value === 'demo' || value === 'prod' ? value : '';
}

/**
 * Read the KSeF seller config sub-object out of `config.seller` (#1223).
 * Returns a flat object of form-field values so the edit form can hydrate the
 * seller profile fields. Falls back to the old flat `config.sellerNip` for
 * connections saved before the nested shape was introduced.
 */
function readKsefSeller(config: Record<string, unknown>): {
  sellerNip: string;
  sellerName: string;
  sellerAddressLine1: string;
  sellerAddressLine2: string;
  sellerCity: string;
  sellerPostalCode: string;
  sellerCountryIso2: string;
} {
  const seller =
    typeof config.seller === 'object' && config.seller !== null
      ? (config.seller as Record<string, unknown>)
      : {};
  const address =
    typeof seller.address === 'object' && seller.address !== null
      ? (seller.address as Record<string, unknown>)
      : {};
  // Fallback: if config.seller.nip is absent, read legacy flat config.sellerNip.
  const nip =
    typeof seller.nip === 'string'
      ? seller.nip
      : typeof config.sellerNip === 'string'
        ? config.sellerNip
        : '';
  return {
    sellerNip: nip,
    sellerName: typeof seller.name === 'string' ? seller.name : '',
    sellerAddressLine1: typeof address.line1 === 'string' ? address.line1 : '',
    sellerAddressLine2: typeof address.line2 === 'string' ? address.line2 : '',
    sellerCity: typeof address.city === 'string' ? address.city : '',
    sellerPostalCode: typeof address.postalCode === 'string' ? address.postalCode : '',
    sellerCountryIso2: typeof address.countryIso2 === 'string' ? address.countryIso2 : '',
  };
}

/**
 * Read the KSeF payment config sub-object out of `config.payment` (#1311).
 * Returns a flat object of form-field values so the edit form can hydrate the
 * payment fields. `paymentTermDays` is read back as a string (the form field's
 * shape); an absent numeric leaf reads as an empty string, matching the other
 * flat structured fields.
 */
function readKsefPayment(config: Record<string, unknown>): {
  paymentFormaPlatnosci: string;
  paymentBankAccountNrRb: string;
  paymentBankAccountBankName: string;
  paymentBankAccountSwift: string;
  paymentTermDays: string;
  paymentSkontoConditions: string;
  paymentSkontoAmount: string;
} {
  const payment =
    typeof config.payment === 'object' && config.payment !== null
      ? (config.payment as Record<string, unknown>)
      : {};
  const bankAccount =
    typeof payment.bankAccount === 'object' && payment.bankAccount !== null
      ? (payment.bankAccount as Record<string, unknown>)
      : {};
  const skonto =
    typeof payment.skonto === 'object' && payment.skonto !== null
      ? (payment.skonto as Record<string, unknown>)
      : {};
  const formaPlatnosci = payment.formaPlatnosci;
  return {
    paymentFormaPlatnosci: (KSEF_FORMA_PLATNOSCI_VALUES as readonly unknown[]).includes(
      formaPlatnosci,
    )
      ? (formaPlatnosci as string)
      : '',
    paymentBankAccountNrRb: typeof bankAccount.nrRb === 'string' ? bankAccount.nrRb : '',
    paymentBankAccountBankName: typeof bankAccount.bankName === 'string' ? bankAccount.bankName : '',
    paymentBankAccountSwift: typeof bankAccount.swift === 'string' ? bankAccount.swift : '',
    paymentTermDays:
      typeof payment.paymentTermDays === 'number' ? String(payment.paymentTermDays) : '',
    paymentSkontoConditions: typeof skonto.conditions === 'string' ? skonto.conditions : '',
    paymentSkontoAmount: typeof skonto.amount === 'string' ? skonto.amount : '',
  };
}

/** Rebuild the typed seller patch slice from an untyped structured patch. */
function toSellerPatch(patch: Record<string, unknown>): KsefSellerProfileInput {
  return {
    sellerNip: readOptionalConfigString(patch, 'sellerNip'),
    sellerName: readOptionalConfigString(patch, 'sellerName'),
    sellerAddressLine1: readOptionalConfigString(patch, 'sellerAddressLine1'),
    sellerAddressLine2: readOptionalConfigString(patch, 'sellerAddressLine2'),
    sellerCity: readOptionalConfigString(patch, 'sellerCity'),
    sellerPostalCode: readOptionalConfigString(patch, 'sellerPostalCode'),
    sellerCountryIso2: readOptionalConfigString(patch, 'sellerCountryIso2'),
  };
}

/** Rebuild the typed payment patch slice from an untyped structured patch. */
function toPaymentPatch(patch: Record<string, unknown>): KsefPaymentInput {
  return {
    paymentFormaPlatnosci: readOptionalConfigString(patch, 'paymentFormaPlatnosci'),
    paymentBankAccountNrRb: readOptionalConfigString(patch, 'paymentBankAccountNrRb'),
    paymentBankAccountBankName: readOptionalConfigString(patch, 'paymentBankAccountBankName'),
    paymentBankAccountSwift: readOptionalConfigString(patch, 'paymentBankAccountSwift'),
    paymentTermDays: readOptionalConfigString(patch, 'paymentTermDays'),
    paymentSkontoConditions: readOptionalConfigString(patch, 'paymentSkontoConditions'),
    paymentSkontoAmount: readOptionalConfigString(patch, 'paymentSkontoAmount'),
  };
}

/**
 * Merge a PARTIAL KSeF structured patch into the config — the write-side
 * assembly. `env` is the wire key (matching the BE `KsefConnectionConfig.env`);
 * `contextIdentifier` is flat delete-on-empty; seller and payment assembly +
 * leaf normalization are shared with the create path via the lib primitives,
 * which touch only the leaves present on the patch (untouched siblings are
 * preserved — the #1311 per-keystroke guarantee).
 */
function applyKsefConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...config };
  const env = readOptionalConfigString(patch, 'ksefEnvironment');
  if (env !== undefined) {
    if (env.length === 0) {
      delete next.env;
    } else {
      next.env = env;
    }
  }
  const contextIdentifier = readOptionalConfigString(patch, 'contextIdentifier');
  if (contextIdentifier !== undefined) {
    if (contextIdentifier.length === 0) {
      delete next.contextIdentifier;
    } else {
      next.contextIdentifier = contextIdentifier;
    }
  }
  next = applyKsefSellerToConfig(next, toSellerPatch(patch));
  next = applyKsefPaymentToConfig(next, toPaymentPatch(patch));
  return next;
}

export const ksefConnectionConfig: ConnectionConfigContribution = {
  schemaShape: ksefSchemaShape,
  superRefine: ksefSuperRefine,
  readConfigToForm: (config) => ({
    ksefEnvironment: readKsefEnvironment(config),
    ...readKsefSeller(config),
    ...readKsefPayment(config),
    contextIdentifier: readConfigString(config, 'contextIdentifier'),
  }),
  applyToConfig: applyKsefConfig,
};
