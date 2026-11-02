/**
 * Auto-Dispatch Read Service - contract (#2729)
 *
 * The two reads an operator needs to run automatic shipping labels without
 * guessing: what was recently refused (and who has to act), and what a DRAFT
 * configuration would do to recent orders. Both are strictly read-only: the
 * preview buys no label and writes no row.
 *
 * Both are keyed on the connection that HOLDS the work
 * (`work.assignedConnectionId`), which is not always a carrier connection - it
 * is often the OpenLinker OMS connection or a 3PL. The response carries the
 * holder, so the settings screen can say so instead of implying a carrier.
 *
 * @module apps/api/src/fulfillment/application/interfaces
 */
import type {
  AutoDispatchRefusalBucket,
  AutoDispatchRefusalCode,
} from '@openlinker/core/shipping';

export const AUTO_DISPATCH_READ_SERVICE_TOKEN = Symbol('IAutoDispatchReadService');

/** The connection the settings belong to, and whether it can hold work at all. */
export interface AutoDispatchHolderView {
  readonly connectionId: string;
  readonly name: string;
  readonly platformType: string;
  /** `FulfillmentExecutor` enabled: only such a connection is ever assigned work. */
  readonly holdsWork: boolean;
  /** Whether `autoDispatch.enabled` is currently set on it. */
  readonly autoDispatchEnabled: boolean;
}

export interface AutoDispatchRefusalView {
  readonly jobId: string;
  readonly workId: string | null;
  readonly orderId: string | null;
  readonly code: AutoDispatchRefusalCode;
  readonly bucket: AutoDispatchRefusalBucket;
  /** When the job last changed state. */
  readonly since: Date;
  /** Retry-ladder position, so "retrying" can say how far along it is. */
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface AutoDispatchRefusalsView {
  readonly holder: AutoDispatchHolderView;
  readonly needsInput: readonly AutoDispatchRefusalView[];
  readonly retrying: readonly AutoDispatchRefusalView[];
}

/** The draft settings a preview is computed against. Nothing here is persisted. */
export interface AutoDispatchDraftConfig {
  readonly parcelTemplate?: string;
  readonly defaultWeightGrams?: number;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
}

export const AutoDispatchPreviewRefusalValues = [
  'no-weight',
  'no-address',
  'no-dimensions',
  'order-unreadable',
] as const;
export type AutoDispatchPreviewRefusal = (typeof AutoDispatchPreviewRefusalValues)[number];

export interface AutoDispatchPreviewItem {
  readonly workId: string;
  readonly orderId: string;
  readonly weightGrams: number | null;
  readonly template: string | null;
  readonly dimensions: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
  } | null;
  /** `null` when the order would get a label with these settings. */
  readonly refusal: AutoDispatchPreviewRefusal | null;
}

export interface AutoDispatchPreviewView {
  readonly holder: AutoDispatchHolderView;
  readonly items: readonly AutoDispatchPreviewItem[];
}

export interface IAutoDispatchReadService {
  /**
   * Recent refusals for the connection, split by who has to act. Newest first
   * within each bucket. `already-has-label` is a success and never appears.
   *
   * @throws ConnectionNotFoundException when the connection does not exist.
   */
  listRefusals(connectionId: string, limit: number): Promise<AutoDispatchRefusalsView>;

  /**
   * What `draft` would do to the connection's `limit` most recent works. Buys
   * nothing and writes nothing.
   *
   * @throws ConnectionNotFoundException when the connection does not exist.
   */
  preview(
    connectionId: string,
    draft: AutoDispatchDraftConfig,
    limit: number
  ): Promise<AutoDispatchPreviewView>;
}
