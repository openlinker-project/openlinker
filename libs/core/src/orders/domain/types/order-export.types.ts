/**
 * Order Export Types (#3534, D35, mockup M5)
 *
 * `order_exports` is the audit + result row behind `orders.export`
 * `sync_jobs` — one row per requested export, the `analytics_remediation_runs`
 * shape (#2468): a text id, plain columns, no CHECK constraints (`status`
 * validated by the repository's `toDomain`, not the schema).
 *
 * The generated file is stored INLINE as base64 — the `StoredDocument`
 * pattern `invoice-record.orm-entity.ts` established for exactly this
 * "snapshot a document so it can be re-served without regenerating it"
 * shape — rather than behind a new file-storage port: nothing else in the
 * codebase needs to store an arbitrary blob today, and a port with one
 * caller and one implementation is a port that exists to be renamed later.
 *
 * @module libs/core/src/orders/domain/types
 */

export const OrderExportStatusValues = ['pending', 'ready', 'failed'] as const;
export type OrderExportStatus = (typeof OrderExportStatusValues)[number];

export const OrderExportFormatValues = ['csv', 'xlsx'] as const;
export type OrderExportFormat = (typeof OrderExportFormatValues)[number];

/** Which orders an export covers (mockup M5: "current view" vs. a row selection). */
export const OrderExportScopeValues = ['filtered', 'selected'] as const;
export type OrderExportScope = (typeof OrderExportScopeValues)[number];

/**
 * The generated file, stored inline. Deliberately NOT imported from
 * `@openlinker/core/invoicing`'s `StoredDocument` — this context has no
 * business depending on invoicing for a two-field blob shape, and an
 * identical local type costs nothing while keeping the two contexts free to
 * diverge.
 */
export interface OrderExportFile {
  contentType: string;
  /** Base64-encoded file bytes. */
  contentBase64: string;
  /** Suggested download filename, e.g. `orders-export-2026-09-28.csv`. */
  filename: string;
}

export interface OrderExportRun {
  id: string;
  requestedByUserId: string;
  status: OrderExportStatus;
  format: OrderExportFormat;
  scope: OrderExportScope;
  /** The `OrderFilters` snapshot the export was run against (`?withTotal`/sort/pagination stripped) — jsonb. */
  filters: Record<string, unknown>;
  /** Explicit order ids when `scope === 'selected'`; empty for `'filtered'`. */
  selectedOrderIds: string[];
  /** The column preset's column ids, in order. */
  columns: string[];
  /** `null` while `pending`. */
  rowCount: number | null;
  /**
   * Whether this run's rows carry personal data — resolved from `OL_STORE_PII`
   * at RUN time, never assumed by the frontend, which does not know the
   * install's PII mode (#3534 "backend gaps"). `null` while `pending`.
   */
  containsPii: boolean | null;
  errorMessage: string | null;
  file: OrderExportFile | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderExportRunInput {
  requestedByUserId: string;
  format: OrderExportFormat;
  scope: OrderExportScope;
  filters: Record<string, unknown>;
  selectedOrderIds: string[];
  columns: string[];
}

/** The row count threshold above which the export runs as a background job (D47). */
export const ORDER_EXPORT_BACKGROUND_THRESHOLD = 5000;

/** How long a generated export file stays downloadable before it expires. */
export const ORDER_EXPORT_TTL_DAYS = 7;
