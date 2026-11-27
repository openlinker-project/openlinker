/**
 * Order Buyer Data Retention Types (#4178)
 *
 * The rows the retention pass reads and the result it reports. See
 * `IOrderBuyerDataRetentionService` for the rule.
 *
 * @module domain/types
 */

/**
 * The shortest retention period a source may declare, in days. A shorter or
 * missing value is ignored by the retention pass, and order writes rely on it
 * to skip the redaction lookup for an order placed within this period.
 */
export const MIN_BUYER_DATA_RETENTION_DAYS = 1;

/** One order whose buyer data is due for removal. */
export interface OrderBuyerDataRetentionCandidate {
  readonly internalOrderId: string;
  /** The stored channel snapshot (`orderSnapshot`), never the edited view. */
  readonly orderSnapshot: Record<string, unknown>;
}

/** What one write removes and leaves in its place. */
export interface OrderBuyerDataRedaction {
  readonly internalOrderId: string;
  readonly orderSnapshot: Record<string, unknown>;
  readonly searchText: string;
}

export interface OrderBuyerDataRetentionConnectionResult {
  readonly sourceConnectionId: string;
  readonly retentionDays: number;
  readonly redacted: number;
  /** Orders whose redaction failed this run; they stay candidates for the next one. */
  readonly failed: number;
  /** Customer projections cleared for this source. */
  readonly customersRedacted: number;
  /** A full budget was spent; the rest is redacted on the next run. */
  readonly budgetExhausted: boolean;
}

export interface OrderBuyerDataRetentionRunResult {
  readonly connections: readonly OrderBuyerDataRetentionConnectionResult[];
  readonly redacted: number;
}
