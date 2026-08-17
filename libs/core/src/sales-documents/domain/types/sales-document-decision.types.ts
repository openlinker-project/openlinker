/**
 * Sales-Document Decision Type (#2155, ADR-041 decision 11)
 *
 * The router's return type — `resolveSalesDocumentRouting`'s output. Three
 * arms, verbatim from the ADR:
 *
 * - `route`     — resolved exactly ONE (documentKind, connectionId) pair to
 *   issue against (decision 3a: invoice XOR receipt, never both, never twice).
 *   `documentKind: null` marks a SELF-ROUTING destination (decision 9): the
 *   destination decides the document kind itself, so OL supplies none.
 * - `aggregate` — the order enters a periodic aggregation window instead of an
 *   immediate document (decision 8). Reserved in the type only — the
 *   aggregation mechanics (window boundaries, batch-document persistence) are
 *   explicitly deferred by the ADR; no caller in this repo produces this arm
 *   yet.
 * - `unresolved`— routing could not name a single pair; `reason` is one of
 *   `SalesDocumentUnresolvedReason`. Silence-and-pick-one is forbidden
 *   (decision 6) — a wrong pick for a fiscal document is a legal event, not a
 *   data-quality issue.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type { SalesDocumentUnresolvedReason } from './sales-document-reason.types';
import type { SalesDocumentKind } from './sales-document-kind.types';

export type SalesDocumentDecision =
  | { kind: 'route'; documentKind: SalesDocumentKind | null; connectionId: string } // null = self-routing destination
  | { kind: 'aggregate'; connectionId: string }
  | { kind: 'unresolved'; reason: SalesDocumentUnresolvedReason };
