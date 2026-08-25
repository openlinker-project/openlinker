/**
 * Returns Feature Types
 *
 * Frontend transport types for the returns read API (#2334), consumed by the
 * returns list (#2335). Hand-written per the FE contract strategy; field names
 * mirror `ReturnListItemResponseDto` verbatim. All date fields are ISO 8601
 * strings, and every one of them is genuinely nullable — a null date means the
 * source reported no such instant, never "now" and never an empty string.
 *
 * @module apps/web/src/features/returns/api
 */

/**
 * The attribution partition. FE mirror of the backend `ReturnBucketValues`
 * (`libs/core/src/returns/domain/types/return-bucket.types.ts`).
 *
 * `orphan` is not a soft "unmatched": it means OpenLinker could not name the
 * order the return belongs to, so every downstream trigger is blocked for it.
 * The copy module says so in the operator's words; this file only carries the
 * vocabulary.
 */
export const RETURN_BUCKET_VALUES = ['orphan', 'attributed'] as const;
export type ReturnBucket = (typeof RETURN_BUCKET_VALUES)[number];

/**
 * Coercion for an UNTRUSTED string — a hand-edited search param, not a value
 * that has already been through the backend's validator. An unrecognised value
 * must be ignored rather than forwarded: the API validates `bucket` with
 * `@IsIn`, so passing a junk value through would 400 the whole page over a
 * typo in the URL bar.
 */
export function isReturnBucket(value: string | null | undefined): value is ReturnBucket {
  return value !== null && value !== undefined
    && (RETURN_BUCKET_VALUES as readonly string[]).includes(value);
}

/**
 * FE mirror of the backend `ReturnOriginValues`. Not on the feature barrel:
 * nothing outside the schema's own `z.enum` reads the runtime array, and
 * publishing a vocabulary no consumer uses invites one to be added without the
 * mirror discipline that would keep it in step with core.
 */
export const RETURN_ORIGIN_VALUES = ['source_ingested', 'operator_authored'] as const;
export type ReturnOrigin = (typeof RETURN_ORIGIN_VALUES)[number];

/**
 * Page size for `/returns`. The backend caps `limit` at 100 (`@Max(100)` on
 * `ListReturnsQueryDto`); a higher value is an HTTP 400, so the cap is mirrored
 * here rather than discovered at runtime.
 */
export const RETURNS_PAGE_SIZE = 20;
export const RETURNS_MAX_LIMIT = 100;

/**
 * One list row.
 *
 * Carries no `lines` — the backend list read hydrates none, deliberately, so a
 * `lines: []` here would be a promise the query never fills and a consumer
 * would render it as "this return has no lines".
 */
export interface ReturnListItem {
  id: string;
  sourceConnectionId: string;
  externalReturnId: string | null;
  /** The order this return belongs to. Null exactly when `bucket` is `orphan`. */
  internalOrderId: string | null;
  /** The source's own order reference, verbatim. */
  externalOrderId: string | null;
  origin: ReturnOrigin;
  bucket: ReturnBucket;
  /** The SOURCE's own status word, verbatim. Null means the source said nothing. */
  rawStatus: string | null;
  openedAt: string | null;
  authorizedAt: string | null;
  declinedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The attribution partition over the caller's filters with `bucket` REMOVED.
 * This — never {@link PaginatedReturns.total} — is what the filter chips read,
 * so the chip for the bucket you are not looking at stays truthful.
 */
export interface ReturnBucketCounts {
  total: number;
  orphan: number;
  attributed: number;
}

export interface PaginatedReturns {
  items: ReturnListItem[];
  /**
   * Rows matching this request's filters, `bucket` INCLUDED — the number the
   * page paginates against. Deliberately distinct from `counts.total`; see
   * {@link ReturnBucketCounts}.
   */
  total: number;
  limit: number;
  offset: number;
  counts: ReturnBucketCounts;
}

/**
 * Whether ANY connection's adapter declares returns ingestion. Resolved from
 * adapter manifests server-side — it is a fact about the deployment's
 * configuration, not about the operator's data.
 */
export interface ReturnIngestionAvailability {
  configured: boolean;
  connectionIds: string[];
}

/** Every field optional; an absent field does not filter. */
export interface ReturnFilters {
  sourceConnectionId?: string;
  bucket?: ReturnBucket;
  createdFrom?: string;
  createdTo?: string;
}

export interface ReturnPagination {
  limit?: number;
  offset?: number;
}
