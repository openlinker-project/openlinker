/**
 * Bulk order action wire types (#3619)
 *
 * Hand-mirrored from `apps/api/src/orders/http/dto/bulk-order-actions.dto.ts` and
 * `order-tag-response.dto.ts` (#3545) per the FE-001 contract strategy - the
 * browser cannot import `@openlinker/core` (#591). Keep the value arrays in the
 * same order as the backend's.
 *
 * @module apps/web/src/features/orders/api
 */
import type { OrderCancelReason } from './order-cancel.types';

/** The backend's per-request cap on every bulk order action. */
export const BULK_ORDER_ACTION_MAX = 100;

export interface BulkCancelOrdersRequest {
  orderIds: string[];
  reason: OrderCancelReason;
  note?: string;
  acknowledgeAcceptedWork?: boolean;
}

export const BulkCancelOutcomeValues = [
  'cancelled',
  'pending',
  'correction-proposed',
  'refused',
  'failed',
] as const;
export type BulkCancelOutcome = (typeof BulkCancelOutcomeValues)[number];

export interface BulkCancelOrderResult {
  orderId: string;
  outcome: BulkCancelOutcome;
  code?: string;
  reason?: string;
  correctionProposalChangeId?: string;
}

export interface BulkCancelOrdersResult {
  total: number;
  cancelled: number;
  pending: number;
  correctionProposed: number;
  refused: number;
  failed: number;
  results: BulkCancelOrderResult[];
}

export const BulkBuyerNoteOutcomeValues = [
  'marked',
  'already-read',
  'no-note',
  'not-found',
  'failed',
] as const;
export type BulkBuyerNoteOutcome = (typeof BulkBuyerNoteOutcomeValues)[number];

export interface BulkBuyerNoteReadRowResult {
  orderId: string;
  outcome: BulkBuyerNoteOutcome;
  reason?: string;
}

export interface BulkBuyerNoteReadResult {
  total: number;
  marked: number;
  alreadyRead: number;
  noNote: number;
  notFound: number;
  failed: number;
  results: BulkBuyerNoteReadRowResult[];
}

export const BulkOrderTagOutcomeValues = [
  'added',
  'already-tagged',
  'removed',
  'not-tagged',
  'failed',
] as const;
export type BulkOrderTagOutcome = (typeof BulkOrderTagOutcomeValues)[number];

export interface BulkOrderTagRowResult {
  orderId: string;
  outcome: BulkOrderTagOutcome;
  reason?: string;
}

/** `POST /order-tags/:tagId/bulk-remove` result. */
export interface BulkRemoveOrderTagResult {
  tagId: string;
  removed: number;
  notTagged: number;
  failed: number;
  results: BulkOrderTagRowResult[];
}
