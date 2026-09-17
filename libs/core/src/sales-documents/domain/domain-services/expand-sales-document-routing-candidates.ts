/**
 * Expand a Connection into its Sales-Document Routing Candidate Row(s) (#3195)
 *
 * A connection's configured `documentKind` (decision 4) is a single string
 * read verbatim from `config.salesDocument.documentKind`. Widening it to the
 * dual-role sentinel `'both'` (#3195) lets one connection issue EITHER kind,
 * decided per order - but `resolveSalesDocumentRouting`'s candidate rows must
 * each carry exactly one concrete kind, since decision 3a resolves "invoice
 * XOR receipt, never both" over the candidate SET, not over a single row that
 * is itself ambiguous.
 *
 * This function is the ONE place that turns a connection into candidate
 * row(s): a `'both'`-configured connection expands into TWO rows, same
 * `connectionId`, one `documentKind: 'invoice'` and one
 * `documentKind: 'fiscal-receipt'`, each competing independently in the
 * unchanged tie-break resolver. Any other configured kind - including the
 * open-world kinds `resolveSalesDocumentRouting` already tolerates - expands
 * to exactly one row, byte-identical to the pre-#3195 `.map(...)` shape.
 *
 * Both `AutoIssueTriggerService` (the gate) and the per-order sales-document
 * projection (ADR-065, `SalesDocumentViewService`) build their candidate list
 * this way, through this one function, so the gate and the read surface can
 * never expand a dual-role connection differently.
 *
 * Pure - no NestJS, no I/O.
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import { SALES_DOCUMENT_KIND_BOTH } from '../types/sales-document-kind.types';
import type { SalesDocumentRoutingCandidate } from './resolve-sales-document-routing';

/**
 * The connection fields a candidate expansion depends on. Structural on
 * purpose, mirroring `SalesDocumentRoutingCandidate` itself: callers pass a
 * `Connection`-shaped value without this concern importing `Connection` from
 * `@openlinker/core/identifier-mapping`.
 */
export interface SalesDocumentCandidateConnectionInput {
  readonly connectionId: string;
  readonly documentKind: string | null;
  readonly isPrimary: boolean;
  readonly enabledCapabilities: readonly string[];
  /**
   * Mirrors `AutoIssueTriggerService`'s own candidate build: no adapter in
   * this repo declares `SelfRoutingDocumentKind` (#2158 shipped the
   * mechanism, not a consumer), so every caller passes `false` rather than
   * resolving a per-connection adapter to ask a question that can only
   * answer `false` today.
   */
  readonly selfRoutesDocumentKind: boolean;
}

/**
 * Expand one connection's routing configuration into its candidate row(s).
 *
 * A `'both'`-configured connection yields two independent rows sharing the
 * connection id; every other configured kind (including `null`, meaning "not
 * a routing candidate", and any open-world kind) yields exactly one row.
 */
export function expandSalesDocumentRoutingCandidates(
  connection: SalesDocumentCandidateConnectionInput,
): SalesDocumentRoutingCandidate[] {
  if (connection.documentKind === SALES_DOCUMENT_KIND_BOTH) {
    return (['invoice', 'fiscal-receipt'] as const).map((documentKind) => ({
      connectionId: connection.connectionId,
      documentKind,
      isPrimary: connection.isPrimary,
      enabledCapabilities: connection.enabledCapabilities,
      selfRoutesDocumentKind: connection.selfRoutesDocumentKind,
    }));
  }

  return [
    {
      connectionId: connection.connectionId,
      documentKind: connection.documentKind,
      isPrimary: connection.isPrimary,
      enabledCapabilities: connection.enabledCapabilities,
      selfRoutesDocumentKind: connection.selfRoutesDocumentKind,
    },
  ];
}
