import { z } from 'zod';
import type { UpdateConnectionInput } from '../api/connections.types';
import { POLISH_VOIVODESHIP_VALUES } from '../types/polish-voivodeship.types';

/**
 * Connection-level seller-defaults schema (#430). Each sub-field is
 * optional at the FE level so the operator can save incremental progress
 * (e.g. fill location now, return for safety info later); the BE DTO
 * validator at `apps/api/src/integrations/http/dto/allegro-connection-config.dto.ts`
 * is the strict gate.
 *
 * `safetyInformation` is a discriminated union — when `type` is
 * `SAFETY_INFORMATION`, `content` becomes required server-side.
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

const allegroSafetyInformationSchema = z.object({
  type: z.enum(['NO_SAFETY_INFORMATION', 'SAFETY_INFORMATION']).optional(),
  content: z.string().trim().max(2000).optional(),
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
  masterCatalogConnectionId: z
    .union([z.string().uuid('Product catalog must be a valid connection ID'), z.literal('')])
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
  shopId?: string;
  storefrontBaseUrl?: string;
  masterCatalogConnectionId?: string;
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
  // Unlike baseUrl/shopId, masterCatalogConnectionId uses `""` as an explicit
  // opt-out signal (see offer-mapping-sync.service.ts:278 — `""` disables
  // barcode linking, absent key falls back to auto-resolve). So we persist the
  // value verbatim instead of deleting on empty.
  if (structured.masterCatalogConnectionId !== undefined) {
    next.masterCatalogConnectionId = structured.masterCatalogConnectionId;
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
      values.safetyInformation.type === 'SAFETY_INFORMATION' &&
      values.safetyInformation.content &&
      values.safetyInformation.content.length > 0
    ) {
      safety.content = values.safetyInformation.content;
    }
    out.safetyInformation = safety;
  }
  return out;
}
