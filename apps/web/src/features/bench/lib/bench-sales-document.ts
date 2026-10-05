/**
 * Which sales-document card the bench shows, and how often it asks again (#3647)
 *
 * One pure decision, read by the documents panel, the completion confirm and the
 * documents query's refresh cadence, so the three cannot disagree about the same
 * box.
 *
 * ## Say only what OpenLinker knows
 *
 * A receipt card never says anything about paper or the box: a provider may
 * print a paper receipt on the seller's own fiscal printer, which OpenLinker
 * cannot see. It never says the buyer received anything either - an artefact's
 * `disposition` is a hint, not evidence.
 *
 * ## An unrecognised value is never "missing"
 *
 * A kind or status this build does not know resolves to `unknown`, a neutral
 * card. Falling back to `missing` would claim no document exists, which is the
 * false statement #3647 exists to remove.
 *
 * @module apps/web/src/features/bench/lib
 */
import type { BenchDocuments, BenchFiscalArtefact } from '../api/bench-parcel.types';

/**
 * What a receipt can be handed over as, in the order one is preferred. Mirrors
 * `FiscalHandoverMediumValues` in `libs/core` (the browser cannot import core,
 * #591), so the card offers exactly the artefact the receipt route serves.
 * `scripts/check-receipt-handover-medium-mirror.mjs` holds the two identical,
 * values and order, under `check:invariants`.
 */
const RECEIPT_HANDOVER_MEDIUMS = ['document', 'link'] as const;
export type BenchReceiptHandover = (typeof RECEIPT_HANDOVER_MEDIUMS)[number];

export function selectReceiptHandover(
  artefacts: readonly BenchFiscalArtefact[] | null
): BenchReceiptHandover | null {
  if (artefacts === null) return null;
  for (const medium of RECEIPT_HANDOVER_MEDIUMS) {
    if (artefacts.some((artefact) => artefact.medium === medium)) return medium;
  }
  return null;
}

export type BenchDocumentCard =
  | { readonly kind: 'invoice-ready'; readonly documentNumber: string | null }
  | { readonly kind: 'invoice-not-printable'; readonly documentNumber: string | null }
  | { readonly kind: 'invoice-in-progress' }
  | { readonly kind: 'invoice-rejected' }
  | { readonly kind: 'invoice-not-confirmed' }
  | { readonly kind: 'receipt-in-progress' }
  | {
      readonly kind: 'receipt-made';
      readonly documentReference: string | null;
      readonly handover: BenchReceiptHandover | null;
      readonly platformType: string | null;
      readonly artefacts: readonly BenchFiscalArtefact[];
    }
  | { readonly kind: 'receipt-rejected' }
  | { readonly kind: 'receipt-not-confirmed' }
  | {
      readonly kind: 'missing';
      readonly blockReason: string | null;
      readonly unresolvedReason: string | null;
    }
  | { readonly kind: 'unknown' };

export type BenchDocumentCardKind = BenchDocumentCard['kind'];

/** A failed record with no mode is as unsafe as `in-doubt` - never "did not go through". */
function isRejected(failureMode: string | null): boolean {
  return failureMode === 'rejected';
}

export function describeBenchDocumentCard(documents: BenchDocuments): BenchDocumentCard {
  const document = documents.document;

  // An API older than #3646 sends no slot at all; read its invoice-only answer.
  if (document === undefined) {
    const invoice = documents.invoice;
    if (invoice === null) return { kind: 'unknown' };
    if (invoice.state === 'ready') {
      return { kind: 'invoice-ready', documentNumber: invoice.documentNumber };
    }
    if (invoice.state === 'issued-not-printable') {
      return { kind: 'invoice-not-printable', documentNumber: invoice.documentNumber };
    }
    if (invoice.state === 'missing') {
      return {
        kind: 'missing',
        blockReason: invoice.blockReason,
        unresolvedReason: invoice.unresolvedReason,
      };
    }
    return { kind: 'unknown' };
  }

  if (document === null) {
    return {
      kind: 'missing',
      blockReason: documents.blockReason,
      unresolvedReason: documents.unresolvedReason,
    };
  }

  if (document.kind === 'invoice') {
    switch (document.status) {
      case 'pending':
      case 'issuing':
        return { kind: 'invoice-in-progress' };
      case 'issued':
        return document.printable
          ? { kind: 'invoice-ready', documentNumber: document.documentNumber }
          : { kind: 'invoice-not-printable', documentNumber: document.documentNumber };
      case 'failed':
        return isRejected(document.failureMode)
          ? { kind: 'invoice-rejected' }
          : { kind: 'invoice-not-confirmed' };
      default:
        return { kind: 'unknown' };
    }
  }

  if (document.kind === 'fiscal-receipt') {
    switch (document.status) {
      case 'pending':
      case 'registering':
        return { kind: 'receipt-in-progress' };
      case 'registered': {
        const artefacts = document.artefacts ?? [];
        return {
          kind: 'receipt-made',
          documentReference: document.documentNumber,
          handover: selectReceiptHandover(artefacts),
          platformType: document.platformType,
          artefacts,
        };
      }
      case 'failed':
        return isRejected(document.failureMode)
          ? { kind: 'receipt-rejected' }
          : { kind: 'receipt-not-confirmed' };
      default:
        return { kind: 'unknown' };
    }
  }

  return { kind: 'unknown' };
}

/** Every 5 s while a document is being made. */
export const BENCH_DOCUMENTS_IN_PROGRESS_REFETCH_MS = 5_000;
/** Every 30 s while there is none or it failed - the office may sort it out meanwhile. */
export const BENCH_DOCUMENTS_UNSETTLED_REFETCH_MS = 30_000;

/**
 * How often the documents read asks again, from what it last answered. A
 * finished document stops asking: nothing about it will change.
 */
export function benchDocumentsRefetchInterval(
  documents: BenchDocuments | undefined
): number | false {
  if (documents === undefined) return false;
  switch (describeBenchDocumentCard(documents).kind) {
    case 'invoice-in-progress':
    case 'receipt-in-progress':
      return BENCH_DOCUMENTS_IN_PROGRESS_REFETCH_MS;
    case 'missing':
    case 'invoice-rejected':
    case 'invoice-not-confirmed':
    case 'receipt-rejected':
    case 'receipt-not-confirmed':
    case 'unknown':
      return BENCH_DOCUMENTS_UNSETTLED_REFETCH_MS;
    case 'invoice-ready':
    case 'invoice-not-printable':
    case 'receipt-made':
      return false;
  }
}
