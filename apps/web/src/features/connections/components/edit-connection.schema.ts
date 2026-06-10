import { z } from 'zod';
import type { UpdateConnectionInput } from '../api/connections.types';
import { POLISH_VOIVODESHIP_VALUES } from '../types/polish-voivodeship.types';

/**
 * Connection-level seller-defaults schema (#430 / #445). Each sub-field is
 * optional at the FE level so the operator can save incremental progress
 * (e.g. fill location now, return for safety info later); the BE DTO
 * validator at `apps/api/src/integrations/application/dto/allegro-connection-config.dto.ts`
 * is the strict gate.
 *
 * `safetyInformation` is a discriminated union — when `type` is `TEXT`,
 * `description` becomes required server-side (1–5000 chars per Allegro).
 * `ATTACHMENTS` carries `attachments[].id`; the FE upload UI for that
 * variant is out of scope for #445 — operators can still target it via
 * the JSON view if they have pre-uploaded attachment ids.
 */
const allegroSellerLocationSchema = z.object({
  countryCode: z.literal('PL').optional(),
  province: z.union([z.enum(POLISH_VOIVODESHIP_VALUES), z.literal('')]).optional(),
  city: z.string().trim().max(200).optional(),
  postCode: z
    .union([
      z.string().regex(/^\d{2}-\d{3}$/, 'Postcode must use the PL format NN-NNN'),
      z.literal(''),
    ])
    .optional(),
});

// FE schema is permissive (optional everywhere) so the operator can save
// incremental progress. The BE DTO is the strict gate — see #445. The one
// cross-field check added for #449 surfaces a clear error when the operator
// has actively selected ATTACHMENTS but hasn't uploaded any file yet — the
// BE DTO would reject this anyway, but catching it client-side gives a
// targeted error next to the file-upload field rather than a generic
// 400. We deliberately don't migrate to `z.discriminatedUnion` here because
// it would force `attachments` to be required up-front and break the
// incremental-progress contract.
const allegroSafetyInformationSchema = z
  .object({
    type: z.enum(['NO_SAFETY_INFORMATION', 'TEXT', 'ATTACHMENTS']).optional(),
    description: z.string().trim().max(5000).optional(),
    attachments: z
      .array(z.object({ id: z.string().trim().min(1) }))
      .max(20)
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'ATTACHMENTS' && (!val.attachments || val.attachments.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'Add at least one attachment when "Provide safety information (file)" is selected.',
      });
    }
  });

const allegroSellerDefaultsSchema = z.object({
  location: allegroSellerLocationSchema.optional(),
  responsibleProducerId: z.string().trim().optional(),
  safetyInformation: allegroSafetyInformationSchema.optional(),
});

export type AllegroSellerDefaultsFormValues = z.input<typeof allegroSellerDefaultsSchema>;

export const editConnectionSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  baseUrl: z.string().trim().optional(),
  // WooCommerce-only structured field surfacing `config.siteUrl` — the key
  // the WooCommerce backend config DTO validates (#975).
  siteUrl: z.string().trim().optional(),
  shopId: z.string().trim().optional(),
  // Optional override for the split-host case (webservice host ≠ public storefront).
  // Accepts a validated URL or an empty string (to unset). See #271 / #283.
  storefrontBaseUrl: z
    .union([
      z
        .url('Storefront URL must be a valid URL')
        .refine(
          (value) => value.startsWith('http://') || value.startsWith('https://'),
          'Storefront URL must use http:// or https://',
        ),
      z.literal(''),
    ])
    .optional(),
  // OL's URL from PrestaShop's perspective — used by the webhook auto-install
  // flow (#168). FE pre-fills this from `window.location.origin` on first
  // render when empty so most operators don't have to think about it; dev
  // override is `http://host.docker.internal:3000`.
  openlinkerCallbackBaseUrl: z
    .union([
      z
        .url('Callback URL must be a valid URL')
        .refine(
          (value) => value.startsWith('http://') || value.startsWith('https://'),
          'Callback URL must use http:// or https://',
        ),
      z.literal(''),
    ])
    .optional(),
  masterCatalogConnectionId: z
    .union([z.string().uuid('Product catalog must be a valid connection ID'), z.literal('')])
    .optional(),
  // PrestaShop-only structured field surfacing `config.defaultCarrierId`
  // (#517). Stored as a string on the form so the same `<Select>`
  // primitive can serve both this field and the per-method mapping
  // dropdown (which uses string `id_reference` values). `mergeStructuredIntoConfig`
  // coerces to an integer at submit; non-integer/zero/negative input is
  // refused with a Zod refine.
  defaultCarrierId: z
    .union([
      z.string().refine((v) => v === '' || /^[1-9]\d*$/.test(v.trim()), {
        message: 'Default carrier ID must be a positive integer.',
      }),
      z.literal(''),
    ])
    .optional(),
  configText: z
    .string()
    .trim()
    .min(2, 'Configuration JSON is required')
    .refine((value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }, 'Configuration must be valid JSON'),
  adapterKey: z.string().trim().optional(),
  // #430 — Allegro-only structured fields. Always optional at the form
  // level; the BE DTO validates strict shape on PATCH.
  sellerDefaults: allegroSellerDefaultsSchema.optional(),
});

export type EditConnectionFormValues = z.input<typeof editConnectionSchema>;
export type EditConnectionFormSubmission = z.output<typeof editConnectionSchema>;

export function toUpdateConnectionInput(values: EditConnectionFormSubmission): UpdateConnectionInput {
  return {
    name: values.name,
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
  };
}

export interface StructuredConfigPatch {
  baseUrl?: string;
  /** WooCommerce store root URL — `config.siteUrl` (#975). */
  siteUrl?: string;
  shopId?: string;
  storefrontBaseUrl?: string;
  openlinkerCallbackBaseUrl?: string;
  masterCatalogConnectionId?: string;
  /**
   * PrestaShop fallback carrier id (#517). Empty string clears the key;
   * a non-empty value is coerced to a positive integer. Values that fail
   * coercion are filtered out by the Zod refine on the schema, so by the
   * time `mergeStructuredIntoConfig` sees the value it's already either
   * `""` or a valid digit-only string.
   */
  defaultCarrierId?: string;
  /**
   * #430 — Allegro seller defaults. The merge helper writes a fully
   * resolved object into `config.sellerDefaults` whenever `sellerDefaults`
   * is supplied; pass `null` to clear the key entirely (operator opting
   * out — rare). Partial updates are not supported here intentionally,
   * because the BE DTO requires the full nested shape on save.
   */
  sellerDefaults?: AllegroSellerDefaultsFormValues | null;
}

/**
 * Merge structured inputs into a raw config object. Preserves unknown keys so
 * operators can still drop in custom config fields via the JSON view without
 * losing them when the structured form re-serializes.
 */
export function mergeStructuredIntoConfig(
  base: Record<string, unknown>,
  structured: StructuredConfigPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  if (structured.baseUrl !== undefined) {
    if (structured.baseUrl.length === 0) {
      delete next.baseUrl;
    } else {
      next.baseUrl = structured.baseUrl;
    }
  }
  if (structured.siteUrl !== undefined) {
    if (structured.siteUrl.length === 0) {
      delete next.siteUrl;
    } else {
      next.siteUrl = structured.siteUrl;
    }
  }
  if (structured.shopId !== undefined) {
    if (structured.shopId.length === 0) {
      delete next.shopId;
    } else {
      next.shopId = structured.shopId;
    }
  }
  if (structured.storefrontBaseUrl !== undefined) {
    if (structured.storefrontBaseUrl.length === 0) {
      delete next.storefrontBaseUrl;
    } else {
      next.storefrontBaseUrl = structured.storefrontBaseUrl;
    }
  }
  if (structured.openlinkerCallbackBaseUrl !== undefined) {
    if (structured.openlinkerCallbackBaseUrl.length === 0) {
      delete next.openlinkerCallbackBaseUrl;
    } else {
      next.openlinkerCallbackBaseUrl = structured.openlinkerCallbackBaseUrl;
    }
  }
  // Unlike baseUrl/shopId, masterCatalogConnectionId uses `""` as an explicit
  // opt-out signal (see offer-mapping-sync.service.ts:278 — `""` disables
  // barcode linking, absent key falls back to auto-resolve). So we persist the
  // value verbatim instead of deleting on empty.
  if (structured.masterCatalogConnectionId !== undefined) {
    next.masterCatalogConnectionId = structured.masterCatalogConnectionId;
  }
  if (structured.defaultCarrierId !== undefined) {
    if (structured.defaultCarrierId.length === 0) {
      delete next.defaultCarrierId;
    } else {
      // Schema's Zod refine guarantees this is a positive-integer string.
      next.defaultCarrierId = Number.parseInt(structured.defaultCarrierId, 10);
    }
  }
  if (structured.sellerDefaults !== undefined) {
    if (structured.sellerDefaults === null) {
      delete next.sellerDefaults;
    } else {
      // Drop empty-string sub-fields so the BE DTO sees a clean shape (the
      // FE schema accepts `''` for incremental editing; the BE rejects it).
      next.sellerDefaults = pruneEmptySellerDefaults(structured.sellerDefaults);
    }
  }
  return next;
}

function pruneEmptySellerDefaults(
  values: AllegroSellerDefaultsFormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.location) {
    const loc: Record<string, unknown> = {};
    if (values.location.countryCode) loc.countryCode = values.location.countryCode;
    if (values.location.province) loc.province = values.location.province;
    if (values.location.city && values.location.city.length > 0) {
      loc.city = values.location.city;
    }
    if (values.location.postCode && values.location.postCode.length > 0) {
      loc.postCode = values.location.postCode;
    }
    if (Object.keys(loc).length > 0) out.location = loc;
  }
  if (values.responsibleProducerId && values.responsibleProducerId.length > 0) {
    out.responsibleProducerId = values.responsibleProducerId;
  }
  if (values.safetyInformation?.type) {
    const safety: Record<string, unknown> = { type: values.safetyInformation.type };
    if (
      values.safetyInformation.type === 'TEXT' &&
      values.safetyInformation.description &&
      values.safetyInformation.description.length > 0
    ) {
      safety.description = values.safetyInformation.description;
    } else if (
      values.safetyInformation.type === 'ATTACHMENTS' &&
      Array.isArray(values.safetyInformation.attachments) &&
      values.safetyInformation.attachments.length > 0
    ) {
      safety.attachments = values.safetyInformation.attachments;
    }
    out.safetyInformation = safety;
  }
  return out;
}
