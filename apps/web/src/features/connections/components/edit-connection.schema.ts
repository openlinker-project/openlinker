import { z } from 'zod';
import type { UpdateConnectionInput } from '../api/connections.types';

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

/**
 * Merge structured inputs into a raw config object. Preserves unknown keys so
 * operators can still drop in custom config fields via the JSON view without
 * losing them when the structured form re-serializes.
 */
export function mergeStructuredIntoConfig(
  base: Record<string, unknown>,
  structured: {
    baseUrl?: string;
    shopId?: string;
    storefrontBaseUrl?: string;
    masterCatalogConnectionId?: string;
  },
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
  return next;
}
