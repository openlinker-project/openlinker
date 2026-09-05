/**
 * Pack-bench parcel and document boundary schemas (#2418, `W3b-5`)
 *
 * ## `.nullish()`, never `.optional()` (#939)
 *
 * OpenLinker serialises an absent optional as JSON `null`, so `.optional()` on a
 * nullable field makes the WHOLE surrounding object fail to parse the moment the
 * backend answers "not set". `bench-work.schema.ts` records the cost on the list;
 * here it is worse. A parcel whose buyer name was never stored would fail to
 * parse, and the packer holding that box would be told the parcel does not
 * exist. Every nullable field below is `.nullish()` and normalised to `null`.
 *
 * ## The line array is NOT `.nullish()`
 *
 * Deliberately unlike `works` on the list. An absent `lines` there means an
 * empty bench, which is a real and safe state; an absent `lines` here would
 * render a box with nothing to verify and therefore — under the auto-close rule
 * — a box that looks finished. A malformed parcel must fail loudly instead.
 *
 * @module apps/web/src/features/bench/api
 */
import { z } from 'zod';

import type {
  BenchDocuments,
  BenchParcel,
  BenchReopenResult,
  BenchUnlabelledParcelList,
  BenchVerificationResult,
} from './bench-parcel.types';

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const benchParcelLineSchema = z.object({
  workLineId: z.string(),
  productVariantId: z.string(),
  name: nullableString,
  sku: nullableString,
  ean: nullableString,
  gtin: nullableString,
  requiredQuantity: z.number(),
  verifiedQuantity: z.number(),
});

export const benchParcelSchema = z.object({
  workId: z.string(),
  version: z.number(),
  orderReference: z.string(),
  buyerName: nullableString,
  parcelIndex: z.number(),
  parcelTotal: z.number(),
  // See the types module: never `z.enum` on a server-owned vocabulary.
  refusal: nullableString,
  holdReason: nullableString,
  closedAt: nullableString,
  packedByUserId: nullableString,
  lines: z.array(benchParcelLineSchema),
});

export const benchVerificationResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  parcel: benchParcelSchema,
});

export const benchReopenResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  parcel: benchParcelSchema,
});

export const benchDocumentsSchema = z.object({
  workId: z.string(),
  invoice: z.object({
    state: z.string(),
    invoiceId: nullableString,
    documentNumber: nullableString,
    issuedAt: nullableString,
    blockReason: nullableString,
    unresolvedReason: nullableString,
  }),
  label: z.object({
    state: z.string(),
    shipmentId: nullableString,
    carrier: nullableString,
    trackingNumber: nullableString,
    providerCode: nullableString,
    carrierMessage: nullableString,
    // A missing value reads as "nothing is being withheld", which is the safe
    // direction: the surface then says the carrier gave no reason rather than
    // implying one is hidden.
    carrierMessageRedacted: z
      .boolean()
      .nullish()
      .transform((value) => value ?? false),
    failedAt: nullableString,
  }),
});

export const benchUnlabelledParcelListSchema = z.object({
  parcels: z
    .array(
      z.object({
        workId: z.string(),
        orderReference: z.string(),
        parcelIndex: z.number(),
        parcelTotal: z.number(),
        closedAt: nullableString,
        carrier: nullableString,
        providerCode: nullableString,
      })
    )
    .nullish()
    .transform((value) => value ?? []),
  total: z.number(),
  truncated: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
});

export function parseBenchParcel(payload: unknown): BenchParcel {
  return benchParcelSchema.parse(payload);
}

export function parseBenchVerificationResult(payload: unknown): BenchVerificationResult {
  return benchVerificationResultSchema.parse(payload);
}

export function parseBenchReopenResult(payload: unknown): BenchReopenResult {
  return benchReopenResultSchema.parse(payload);
}

export function parseBenchDocuments(payload: unknown): BenchDocuments {
  return benchDocumentsSchema.parse(payload);
}

export function parseBenchUnlabelledParcelList(payload: unknown): BenchUnlabelledParcelList {
  return benchUnlabelledParcelListSchema.parse(payload);
}
