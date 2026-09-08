import type { OrderFilters, OrderPagination, OrderHealthSummaryFilters } from './orders.types';

export const ordersQueryKeys = {
  all: ['orders'] as const,
  list: (filters?: OrderFilters, pagination?: OrderPagination) =>
    ['orders', 'list', filters ?? {}, pagination ?? {}] as const,
  /** The rows-only page (#2947) - a different response shape, so a different key. */
  rows: (filters?: OrderFilters, pagination?: OrderPagination) =>
    ['orders', 'rows', filters ?? {}, pagination ?? {}] as const,
  /**
   * The two-stage total (#2947). Carries neither pagination NOR sort, so paging
   * or re-sorting reuses one cached count instead of re-running the 142 ms
   * aggregate #2843 measured.
   *
   * Dropping `sort`/`dir` is not cosmetic (#2957 review, I3). They live inside
   * `OrderFilters` and this page always populates them, so leaving them in the
   * key minted a fresh cache entry - and a fresh request - on every
   * column-header click, blanking a known total to `20+` for at least the
   * debounce while re-answering a question a re-sort cannot change. Membership
   * is what a count is about; presentation is not.
   */
  count: (filters?: OrderFilters) => ['orders', 'count', orderMembershipFilters(filters)] as const,
  statusSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'status-summary', filters ?? {}] as const,
  slaSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'sla-summary', filters ?? {}] as const,
  lifecycleSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'lifecycle-summary', filters ?? {}] as const,
  detail: (internalOrderId: string) => ['orders', 'detail', internalOrderId] as const,
};

/**
 * The filters that decide MEMBERSHIP, i.e. everything except presentation.
 *
 * `sort` and `dir` are fields of `OrderFilters` and this page always populates
 * them, so leaving them in a count's key or URL mints a fresh cache entry and a
 * fresh request on every column-header click - re-answering a question a
 * re-sort cannot change (#2957 review, I3).
 *
 * Exported so the query key and the request URL narrow through ONE function: a
 * key that claims to ignore the sort while the URL still carries it makes two
 * identical answers look like two different requests.
 *
 * Note this narrows an EXISTING pair of fields rather than guarding against a
 * future one. `buildQuery` in `orders.api.ts` enumerates, so a new filter must
 * still be added there by hand; the listings sibling carries a compile-time
 * exhaustiveness map for that reason (#2957 review round 4, I1).
 */
export function orderMembershipFilters(filters?: OrderFilters): Omit<OrderFilters, 'sort' | 'dir'> {
  if (!filters) return {};
  const membership: Omit<OrderFilters, 'sort' | 'dir'> = { ...filters };
  delete (membership as Partial<OrderFilters>).sort;
  delete (membership as Partial<OrderFilters>).dir;
  return membership;
}
