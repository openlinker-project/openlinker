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
import { resolveSalesDocumentReasonCopy } from '../../sales-documents';
import type { SalesDocumentReasonTone } from '../../sales-documents';
import type { SalesDocumentView } from '../api/orders.types';

export type SalesDocumentCellTone = 'idle' | 'progress' | 'done' | 'warning' | 'error';

export interface SalesDocumentCellState {
  /** The routed kind, or `null` when routing has not decided (mirrors `view.documentKind`). */
  readonly kind: string | null;
  /** The single word rendered on the row. */
  readonly word: string;
  readonly tone: SalesDocumentCellTone;
  /** Whether this state needs the operator's attention (drives the tint). */
  readonly attention: boolean;
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
        attention: false,
        reasonDetail: null,
        keepsAction: false,
      };
    }
    return {
      kind: null,
      word: copy.short,
      tone: toneFromReasonTone(copy.tone),
      attention: copy.tone !== 'neutral',
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
        attention: true,
        reasonDetail: null,
        keepsAction: true,
      };
    }
    return {
      kind: view.documentKind,
      word: copy.short,
      tone: toneFromReasonTone(copy.tone),
      // `neutral` is the one tone that does not need attention — it is
      // `trigger-model-manual`'s tone, and issue-on-request is reported
      // separately from anything needing attention (#2554).
      attention: copy.tone !== 'neutral',
      reasonDetail: copy.detail,
      keepsAction: copy.keepsAction,
    };
  }

  if (document.kind === 'fiscal-receipt') {
    if (document.status === 'pending') return withDoc(view.documentKind, 'Queued', 'progress', false);
    if (document.status === 'registering')
      return withDoc(view.documentKind, 'Registering', 'progress', false);
    if (document.status === 'registered')
      return withDoc(view.documentKind, 'Registered', 'done', false);
    if (document.status === 'failed') {
      return document.failureMode === 'rejected'
        ? withDoc(view.documentKind, 'Rejected', 'error', true)
        : withDoc(view.documentKind, 'Unconfirmed', 'warning', true);
    }
    // A status this build does not recognise — a newer backend answering an
    // FE compiled against an older union. Reported as needing a look rather
    // than silently rendering nothing.
    return withDoc(view.documentKind, 'Unrecognised status', 'warning', true);
  }

  // document.kind === 'invoice'. Clearance takes precedence over issuance —
  // "issued, then rejected by the authority" is the state a flattened status
  // could not express (ADR-065), and it is more actionable than "Issued".
  if (document.regulatoryStatus === 'rejected') {
    return withDoc(view.documentKind, 'Authority rejected', 'error', true);
  }
  if (document.regulatoryStatus === 'submitted' || document.regulatoryStatus === 'pending-submission') {
    return withDoc(view.documentKind, 'At authority', 'progress', false);
  }
  if (document.status === 'issued') return withDoc(view.documentKind, 'Issued', 'done', false);
  if (document.status === 'issuing' || document.status === 'pending')
    return withDoc(view.documentKind, 'Issuing', 'progress', false);
  if (document.status === 'failed') {
    return document.failureMode === 'rejected'
      ? withDoc(view.documentKind, 'Failed', 'error', true)
      : withDoc(view.documentKind, 'Needs review', 'warning', true);
  }
  // A status this build does not recognise.
  return withDoc(view.documentKind, 'Unrecognised status', 'warning', true);
}

function withDoc(
  kind: string,
  word: string,
  tone: SalesDocumentCellTone,
  attention: boolean,
): SalesDocumentCellState {
  return { kind, word, tone, attention, reasonDetail: null, keepsAction: false };
}
