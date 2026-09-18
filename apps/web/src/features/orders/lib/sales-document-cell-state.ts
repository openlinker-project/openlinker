/**
 * Sales-Document Cell State (#2552, ADR-065)
 *
 * Pure derivation of the money-cluster document line's word + tone from the
 * batched `SalesDocumentView` (#2516/#2552). Kept out of the component so the
 * rule is unit-testable without rendering, and shared between the desktop
 * cell and the mobile card the same way `order-row.ts`'s badge resolvers are.
 *
 * The word names the MOST ACTIONABLE fact, never merely the raw status — an
 * invoice the authority rejected reads "Authority rejected", not "Issued"
 * beside a red dot, because colour is never the only carrier of a thing
 * needing work (mini-epic #2551 acceptance criteria).
 *
 * No platform name leaks into the word ("Authority rejected", not "KSeF
 * rejected") — the vocabulary here is the SAME neutral one `libs/core`
 * enforces for the wire shape; a specific authority's name belongs on the
 * popover's identity facts (`providerType`), never on the row.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  resolveSalesDocumentReasonCopy,
  resolveSalesDocumentRecordWord,
} from '../../sales-documents';
import type { SalesDocumentReasonTone } from '../../sales-documents';
import type { SalesDocumentView } from '../api/orders.types';

export type SalesDocumentCellTone = 'idle' | 'progress' | 'done' | 'warning' | 'error';

export interface SalesDocumentCellState {
  /** The routed kind, or `null` when routing has not decided (mirrors `view.documentKind`). */
  readonly kind: string | null;
  /** The single word rendered on the row. */
  readonly word: string;
  readonly tone: SalesDocumentCellTone;
  /** Long-form explanation for the popover, or `null` when there is nothing to add. */
  readonly reasonDetail: string | null;
  /**
   * Whether an "Issue…" action should still be offered alongside this state.
   * True for `trigger-model-manual` (issuing by hand IS the workflow) and for
   * the ordinary "routing decided, nothing issued yet" state; false once a
   * document exists or a non-actionable block holds it.
   */
  readonly keepsAction: boolean;
}

function toneFromReasonTone(tone: SalesDocumentReasonTone): SalesDocumentCellTone {
  switch (tone) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'idle';
    case 'neutral':
    default:
      return 'idle';
  }
}

/**
 * Resolve the row's word/tone from one order's sales-document view.
 *
 * `undefined` covers a row the batched read found nothing for (an older
 * payload, or genuinely no projection) — rendered identically to a `null`
 * `documentKind`, since a surface cannot tell the two apart and must not
 * assert one over the other.
 *
 * **Absence is never an error** (#2761 review). A missing view and an
 * undecided `documentKind` with no persisted reason both mean "OpenLinker has
 * not been told what this order should get" - a configuration state, on every
 * row of a fresh install and on every row of an FE running against an API
 * predating the field. Painting those red is the same defect #2554 exists to
 * prevent (a large red number on a healthy install), one surface down, so they
 * resolve `idle` / no attention and lean on the popover's `Set routing`
 * affordance instead. A reason the BACKEND actually persisted is a different
 * thing and keeps that reason's own tone - `unresolved-routing` really is an
 * error, and it is an error because the gate said so, not because a field was
 * absent.
 */
export function resolveSalesDocumentCellState(
  view: SalesDocumentView | undefined,
): SalesDocumentCellState {
  if (!view || view.documentKind === null) {
    const copy = view
      ? resolveSalesDocumentReasonCopy(view.blockReason, view.unresolvedReason)
      : null;
    if (!copy) {
      return {
        kind: null,
        word: 'No document',
        tone: 'idle',
        reasonDetail: null,
        keepsAction: false,
      };
    }
    return {
      kind: null,
      word: copy.short,
      tone: toneFromReasonTone(copy.tone),
      reasonDetail: copy.detail,
      keepsAction: false,
    };
  }

  const { document, blockReason, unresolvedReason } = view;

  if (!document) {
    const copy = resolveSalesDocumentReasonCopy(blockReason, unresolvedReason);
    if (!copy) {
      return {
        kind: view.documentKind,
        word: 'Not issued',
        tone: 'idle',
        reasonDetail: null,
        keepsAction: true,
      };
    }
    return {
      kind: view.documentKind,
      word: copy.short,
      tone: toneFromReasonTone(copy.tone),
      reasonDetail: copy.detail,
      keepsAction: copy.keepsAction,
    };
  }

  // The "given a record, what word/tone" rule has exactly one definition,
  // shared with the merged /sales-documents list (#3307) — see
  // `resolveSalesDocumentRecordWord`'s own docblock for why.
  const { word, tone } = resolveSalesDocumentRecordWord(document);
  return { kind: view.documentKind, word, tone, reasonDetail: null, keepsAction: false };
}
