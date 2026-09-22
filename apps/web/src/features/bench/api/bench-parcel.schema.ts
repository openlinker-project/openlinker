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
  BenchActivityEntry,
  BenchClaimNextResult,
  BenchClaimResult,
  BenchDocuments,
  BenchMetrics,
  BenchPackedTodayList,
  BenchParcel,
  BenchPresence,
  BenchReopenResult,
  BenchUndoResult,
  BenchUnlabelledParcelList,
  BenchVerificationResult,
} from './bench-parcel.types';

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? null);

const nullableAttributes = z
  .record(z.string(), z.string())
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
  imageUrl: nullableString,
  attributes: nullableAttributes,
  binCode: nullableString,
  weightGrams: nullableNumber,
  lengthMm: nullableNumber,
  widthMm: nullableNumber,
  heightMm: nullableNumber,
});

export const benchParcelSchema = z.object({
  workId: z.string(),
  version: z.number(),
  orderReference: z.string(),
  buyerName: nullableString,
  totalAmount: nullableNumber,
  currency: nullableString,
  carrierName: nullableString,
  dispatchByAt: nullableString,
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

export const benchUndoResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  workLineId: nullableString,
  parcel: benchParcelSchema,
});

export function parseBenchUndoResult(payload: unknown): BenchUndoResult {
  return benchUndoResultSchema.parse(payload);
}

export const benchClaimResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  parcel: benchParcelSchema,
});

export function parseBenchClaimResult(payload: unknown): BenchClaimResult {
  return benchClaimResultSchema.parse(payload);
}

export const benchClaimNextResultSchema = z.object({
  outcome: z.string(),
  parcel: benchParcelSchema.nullish().transform((value) => value ?? null),
});

export function parseBenchClaimNextResult(payload: unknown): BenchClaimNextResult {
  return benchClaimNextResultSchema.parse(payload);
}

export const benchPresenceSchema = z.object({
  collision: z.boolean(),
  otherUserId: nullableString,
});

export function parseBenchPresence(payload: unknown): BenchPresence {
  return benchPresenceSchema.parse(payload);
}

export const benchActivityEntrySchema = z.object({
  workLineId: z.string(),
  name: nullableString,
  kind: z.string(),
  at: z.string(),
  byUserId: nullableString,
});

export function parseBenchActivityEntries(payload: unknown): readonly BenchActivityEntry[] {
  return z.array(benchActivityEntrySchema).parse(payload);
}

export const benchPackedTodayListSchema = z.object({
  works: z
    .array(
      z.object({
        workId: z.string(),
        orderReference: z.string(),
        buyerName: nullableString,
        parcelIndex: z.number(),
        parcelTotal: z.number(),
        closedAt: z.string(),
        packedByUserId: nullableString,
      })
    )
    .nullish()
    .transform((value) => value ?? []),
  total: z.number(),
});

export function parseBenchPackedTodayList(payload: unknown): BenchPackedTodayList {
  return benchPackedTodayListSchema.parse(payload);
}

export const benchMetricsSchema = z.object({
  packedToday: z.number(),
  packedYesterday: z.number(),
  toPackAllBenches: z.number(),
});

export function parseBenchMetrics(payload: unknown): BenchMetrics {
  return benchMetricsSchema.parse(payload);
}
