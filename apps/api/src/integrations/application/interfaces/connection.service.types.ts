/**
 * Connection Service Types
 *
 * Input/output types for the API-layer ConnectionService. Kept separate from
 * the interface and implementation per engineering-standards.md.
 *
 * @module apps/api/src/integrations/application/interfaces
 */
import type { ConnectionCreate, ConnectionUpdate } from '@openlinker/core/identifier-mapping';
import type { OrderSyncStart } from '@openlinker/core/sync';

/**
 * Connection create input accepted by the API service.
 *
 * Extends the core `ConnectionCreate` with an optional `credentials` payload.
 * When `credentials` is supplied, the service persists it in the integration
 * credentials store and sets `credentialsRef` to the resulting `db:<uuid>`
 * automatically. Exactly one of `credentials` or `credentialsRef` must be set.
 */
export type ConnectionCreateInput = Omit<ConnectionCreate, 'credentialsRef'> & {
  credentialsRef?: string;
  credentials?: Record<string, unknown>;
  /**
   * Where the connection's order feed starts (#4228). Absent means `now`.
   * Validated against the adapter's declared `orderSyncStartModes` and stored
   * as a one-shot intent cursor, never in `config`.
   */
  orderSyncStart?: OrderSyncStart;
};

/**
 * Connection update input accepted by the API service (#4228): the core patch
 * plus the order sync start used when this request turns OrderSource on.
 */
export type ConnectionUpdateInput = ConnectionUpdate & {
  /**
   * Where the order feed starts when this patch enables OrderSource on a
   * connection that has no feed position, marker or intent yet. Absent means
   * `now`. Never overwrites an existing cursor or intent, and is ignored when
   * the patch does not enable OrderSource.
   */
  orderSyncStart?: OrderSyncStart;
};

/** What a restart of the order sync did. */
export interface OrderSyncRestartResult {
  applied: boolean;
  /** Present when nothing was reset: the feed already follows new orders from its last check. */
  reason?: 'already-following-feed';
}

/** A manual order import request (#4228). */
export interface OrderImportRequest {
  from?: string;
  to?: string;
  direction: 'oldest-first' | 'newest-first';
}
