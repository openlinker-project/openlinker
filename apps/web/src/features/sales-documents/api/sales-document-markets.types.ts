/**
 * Sales-Document Markets — view types (#2540, mirrors ADR-066)
 *
 * FE-local mirror of `apps/api/src/sales-documents/http/dto/sales-document-market-response.dto.ts`,
 * matching the `apps/web` never-imports-`@openlinker/core/*` contract strategy
 * already used by `sales-document-rules.types.ts`.
 *
 * `SalesDocumentMarketOutcome.kind === 'acknowledged'` is a state the routing
 * evaluator itself cannot produce — the backend overrides the evaluator's
 * answer whenever the row carries `acknowledgedNoDocumentAt`. See the backend
 * DTO's doc comment for the full reasoning; this file only mirrors the shape.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { SalesDocumentKind } from './sales-documents.types';

export const SALES_DOCUMENT_MARKET_OUTCOME_KIND_VALUES = [
  'route',
  'aggregate',
  'unresolved',
  'acknowledged',
] as const;
export type SalesDocumentMarketOutcomeKind =
  (typeof SALES_DOCUMENT_MARKET_OUTCOME_KIND_VALUES)[number];

export interface SalesDocumentMarketOutcome {
  kind: SalesDocumentMarketOutcomeKind;
  /** Set when `kind === 'route'`. */
  documentKind?: SalesDocumentKind | string | null;
  /** Set when `kind === 'route'` or `kind === 'aggregate'`. */
  connectionId?: string;
  /**
   * Set when `kind === 'unresolved'`. A `SalesDocumentUnresolvedReasonValue`
   * — the same vocabulary `SALES_DOCUMENT_UNRESOLVED_REASON_COPY` already
   * covers, so a market row's "why nothing" text reuses that map rather than
   * inventing a second one.
   */
  reason?: string;
}

export interface SalesDocumentMarketRow {
  /** ISO 3166-1 alpha-2, or `'*'` for Rest of world. */
  country: string;
  /**
   * Orders billed to this country in the discovery window, or `null` when
   * the country was never detected at all (a configured-only market). Never
   * `0` — a detected market always has at least one order.
   */
  orderCount: number | null;
  /** Whether a curated starter template exists for this country. */
  hasTemplate: boolean;
  /** How many rules target this country. */
  ruleCount: number;
  invoiceDefaultConnectionId: string | null;
  receiptDefaultConnectionId: string | null;
  acknowledgedNoDocumentAt: string | null;
  outcome: SalesDocumentMarketOutcome;
}

export interface SalesDocumentMarketsResponse {
  /** The discovery window actually applied, in days. */
  windowDays: number;
  /** ISO-8601 lower bound the detected order counts were taken from. */
  since: string;
  markets: SalesDocumentMarketRow[];
}
