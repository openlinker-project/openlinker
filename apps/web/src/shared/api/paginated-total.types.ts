/**
 * Two-stage paginated read - wire types (#2947)
 *
 * A list whose count cannot stop early fetches its rows and its total
 * separately: `GET /<resource>?withTotal=false` for the page, and
 * `GET /<resource>/count` for the number.
 *
 * @module shared/api
 * @see shared/hooks/use-paginated-total for the hook that drives the second stage
 */

/** What every `/count` sibling of an expensive list route answers with. */
export interface PaginatedTotal {
  total: number;
}

/**
 * A page fetched WITHOUT its total.
 *
 * `total` is absent from this type on purpose, not merely optional: a caller
 * cannot read a number the response does not carry, so `data.total ?? 0` is a
 * compile error rather than a rendered zero. That is the same never-render-zero
 * rule the API enforces by omitting the field, expressed where the frontend can
 * be held to it.
 */
export interface RowsPage<TItem> {
  items: TItem[];
  limit: number;
  offset: number;
}
