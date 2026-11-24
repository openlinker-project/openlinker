/**
 * Sales-document batch API types (#3584)
 *
 * Mirrors the `/sales-documents/batches/:connectionId` responses (#3583). The
 * browser cannot import `@openlinker/core` (#591), so the shapes are restated.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { ConcreteDocumentKind } from './sales-documents.types';

export const BatchFrequencyValues = ['daily', 'every-n-hours', 'month-end'] as const;
export type BatchFrequency = (typeof BatchFrequencyValues)[number];

export type BatchRunSegment = 'all' | 'b2b' | 'b2c';

export interface BatchScheduleSlot {
  segment: BatchRunSegment;
  slotAt: string;
}

export interface BatchScheduleView {
  documentKind: ConcreteDocumentKind;
  /** This kind's "When it issues" is Batch. */
  batched: boolean;
  frequency: BatchFrequency | null;
  time: string | null;
  everyHours: number | null;
  timeZone: string | null;
  nextSlots: BatchScheduleSlot[];
}

export type BatchRunStatus = 'running' | 'completed' | 'empty' | 'failed-to-start' | 'interrupted';

export type BatchRunFailureReason =
  | 'connection-not-found'
  | 'connection-needs-reauth'
  | 'connection-not-active'
  | 'queue-read-failed';

export interface BatchRun {
  id: string;
  connectionId: string;
  trigger: 'schedule' | 'manual';
  documentKinds: string[];
  segment: BatchRunSegment;
  slotAt: string | null;
  status: BatchRunStatus;
  failureReason: BatchRunFailureReason | string | null;
  eligibleCount: number;
  enqueuedCount: number;
  blockedCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface BatchOverview {
  connectionId: string;
  schedules: BatchScheduleView[];
  /** Queued orders per document kind. */
  queueCounts: Record<string, number>;
  runningRun: BatchRun | null;
}

export interface BatchQueueEntry {
  orderId: string;
  sourceConnectionId: string;
  documentKind: string;
  placedAt: string | null;
  totalAmount: number | null;
  currency: string | null;
  isB2b: boolean;
  orderNumber: string | null;
  buyerName: string | null;
}

export interface BatchQueuePage {
  items: BatchQueueEntry[];
  nextCursor: string | null;
}

export interface BatchRunList {
  runs: BatchRun[];
  total: number;
}

export type BatchRunItemResult =
  | 'enqueued'
  | 'blocked'
  | 'already-documented'
  | 'not-routed-here'
  | 'indeterminate';

export type BatchItemOutcome =
  | 'issued'
  | 'pending'
  | 'in-doubt'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'needs-attention';

export interface BatchRunItem {
  orderId: string;
  documentKind: string | null;
  result: BatchRunItemResult | string;
  outcome: BatchItemOutcome | string;
  blockReason: string | null;
  orderNumber: string | null;
  buyerName: string | null;
  documentNumber: string | null;
}

export interface BatchRunDetail {
  run: BatchRun;
  items: BatchRunItem[];
}

export interface StartBatchRunResponse {
  jobId: string;
}

/** Codes a refused "Run now" answers with (409). */
export const BatchRunRefusalCodeValues = [
  'CONNECTION_NOT_BATCHED',
  'CONNECTION_NEEDS_REAUTH',
  'CONNECTION_NOT_ACTIVE',
  'BATCH_RUN_IN_PROGRESS',
] as const;
export type BatchRunRefusalCode = (typeof BatchRunRefusalCodeValues)[number];
