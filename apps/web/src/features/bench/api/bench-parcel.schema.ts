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
  BenchCompleteResult,
  BenchDocuments,
  BenchMetrics,
  BenchReceiptLink,
  BenchPackedTodayList,
  BenchParcel,
  BenchPresence,
  BenchLabelReplaceResult,
  BenchReopenResult,
  BenchUndoCompletionResult,
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
  assignedToUserId: nullableString,
  invoicePrintedAt: nullableString,
  labelPrintedAt: nullableString,
  completedAt: nullableString,
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

export const benchCompleteResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  parcel: benchParcelSchema,
});

const benchFiscalArtefactSchema = z.object({
  medium: z.string(),
  disposition: z.string(),
  label: nullableString,
  contentType: nullableString,
});

// #3646. Kind and status stay open strings: a value this build does not know
// must reach the card logic, which renders a neutral state for it, rather than
// fail the whole parse and blank the label beside it.
const benchSalesDocumentSchema = z.object({
  kind: z.string(),
  recordId: z.string(),
  connectionId: z.string(),
  platformType: nullableString,
  status: z.string(),
  failureMode: nullableString,
  documentNumber: nullableString,
  completedAt: nullableString,
  printable: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  artefacts: z
    .array(benchFiscalArtefactSchema)
    .nullish()
    .transform((value) => value ?? null),
});

export const benchDocumentsSchema = z.object({
  workId: z.string(),
  // Deprecated since #3646; tolerated as absent so a later API may drop it.
  invoice: z
    .object({
      state: z.string(),
      invoiceId: nullableString,
      documentNumber: nullableString,
      issuedAt: nullableString,
      blockReason: nullableString,
      unresolvedReason: nullableString,
    })
    .nullish()
    .transform((value) => value ?? null),
  // NOT normalised to `null`: `undefined` is how an API older than #3646 says it
  // sends no slot, which is a different fact from "this order has no document".
  document: benchSalesDocumentSchema.nullable().optional(),
  documentKind: nullableString,
  blockReason: nullableString,
  unresolvedReason: nullableString,
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
    parcelTemplates: z
      .array(z.string())
      .nullish()
      .transform((value) => value ?? []),
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

export function parseBenchCompleteResult(payload: unknown): BenchCompleteResult {
  return benchCompleteResultSchema.parse(payload);
}

export const benchUndoCompletionResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  parcel: benchParcelSchema,
});

export function parseBenchUndoCompletionResult(payload: unknown): BenchUndoCompletionResult {
  return benchUndoCompletionResultSchema.parse(payload);
}

export function parseBenchDocuments(payload: unknown): BenchDocuments {
  return benchDocumentsSchema.parse(payload);
}

/**
 * The link is a fiscal provider's own string, served verbatim, and it becomes an
 * `href`. `target="_blank"` does not neutralise a `javascript:` href - the
 * browser runs it in this document - so only an absolute http(s) URL parses. A
 * `javascript:`, `data:` or relative value fails here and the card shows the
 * link-failed state it already has, rather than a link that runs provider code
 * on the OpenLinker origin.
 */
export const benchReceiptLinkSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

export function parseBenchReceiptLink(payload: unknown): BenchReceiptLink {
  return benchReceiptLinkSchema.parse(payload);
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
  // Nullish-defaulted, so a response from an API that predates the refusal arm
  // parses as "no reason given" rather than failing the whole read — which on
  // this surface would turn a lost race into an error toast.
  reason: z.string().nullish().transform((value) => value ?? null),
});

export function parseBenchClaimNextResult(payload: unknown): BenchClaimNextResult {
  return benchClaimNextResultSchema.parse(payload);
}

export const benchPresenceSchema = z.object({
  collision: z.boolean(),
  // Defaulted, so an API that predates the roster parses to "nobody else"
  // rather than failing the whole read — which on this surface would mean a
  // packer loses the collision warning AND gets an error where the banner
  // would have been.
  others: z.array(z.object({ displayName: z.string() })).default([]),
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

// ── Change size (#3655) ─────────────────────────────────────────────────────
// A success body is `{ outcome: 'replaced' | 'cancelled-not-replaced', voidState,
// keptTemplate, ... }`. Refusals are 409s and are folded into the same result by
// `bench-work.api.ts`.
export const benchLabelReplaceResultSchema = z.object({
  outcome: z.string(),
  reason: nullableString,
  voidState: nullableString,
  keptTemplate: nullableString,
});

/** Reads a wire body into a result. Anything that is not a success outcome is a refusal. */
export function parseBenchLabelReplaceResult(payload: unknown): BenchLabelReplaceResult {
  const parsed = benchLabelReplaceResultSchema.parse(payload);
  if (parsed.outcome === 'replaced') {
    return {
      outcome: 'replaced',
      reason: parsed.reason,
      voidState: 'confirmed',
      keptTemplate: parsed.keptTemplate,
    };
  }
  if (parsed.outcome === 'cancelled-not-replaced') {
    return {
      outcome: 'cancelled-not-replaced',
      reason: parsed.reason,
      // Only an explicit `confirmed` reads as confirmed. A missing or unknown
      // value is held as in doubt: claiming a void we were not told about is
      // the wrong direction to fail in, and both tell the packer not to use it.
      voidState: parsed.voidState === 'confirmed' ? 'confirmed' : 'in-doubt',
      keptTemplate: parsed.keptTemplate,
    };
  }
  return {
    outcome: 'refused',
    reason: parsed.reason ?? parsed.outcome,
    voidState: null,
    keptTemplate: null,
  };
}

/**
 * The refusal code of a 409. `BenchLabelController` answers every refusal with
 * `ConflictException({ reason, message })`, so `reason` is the member to read.
 * A body without one yields `null`, which the dialog renders as its
 * unrecognised-refusal line rather than nothing.
 */
export function readReplaceRefusalReason(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const { reason } = details as { reason?: unknown };
  return typeof reason === 'string' ? reason : null;
}
