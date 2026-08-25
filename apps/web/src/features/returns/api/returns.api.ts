/**
 * Returns API Client
 *
 * Typed client for the returns read surface (#2334), consumed by the returns
 * list (#2335).
 *
 * Both reads run their response through the feature's Zod parse rather than
 * casting it, so a contract break surfaces as a reported dropped row instead of
 * an `undefined` rendered into a cell.
 *
 * @module apps/web/src/features/returns/api
 */
import { parseReturnIngestionAvailability, parseReturnList } from './returns.schema';
import { RETURNS_MAX_LIMIT } from './returns.types';
import type {
  PaginatedReturns,
  ReturnFilters,
  ReturnIngestionAvailability,
  ReturnPagination,
} from './returns.types';

/**
 * The list envelope plus the count of rows this build could not read.
 *
 * `counts` widens to `| null` here: the server may send an envelope this build
 * cannot read, and a synthesised partition would be two invented claims
 * rendered as authoritative chip numbers. A caller renders the chips without
 * numbers instead.
 */
export interface ReturnListResult extends Omit<PaginatedReturns, 'counts'> {
  counts: PaginatedReturns['counts'] | null;
  droppedCount: number;
}

export interface ReturnsApi {
  /**
   * `GET /returns` — paged, newest first, no sort parameter (the server pins
   * `createdAt DESC, id ASC`).
   *
   * The backend caps `limit` at 100; a higher value is an HTTP 400.
   */
  list: (filters?: ReturnFilters, pagination?: ReturnPagination) => Promise<ReturnListResult>;

  /**
   * `GET /returns/ingestion-availability` — whether ANY connection's adapter
   * declares returns ingestion. Resolves to `null` when the response cannot be
   * read, because `configured: false` is a positive claim about the operator's
   * configuration and an unreadable response is not evidence for it.
   */
  getIngestionAvailability: () => Promise<ReturnIngestionAvailability | null>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ReturnFilters, pagination?: ReturnPagination): string {
  const params = new URLSearchParams();
  if (filters?.sourceConnectionId) params.set('sourceConnectionId', filters.sourceConnectionId);
  if (filters?.bucket) params.set('bucket', filters.bucket);
  if (filters?.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters?.createdTo) params.set('createdTo', filters.createdTo);
  // Clamped rather than forwarded: the backend answers HTTP 400 above 100, so
  // an over-large caller value would fail the whole page instead of returning
  // the most it can. `RETURNS_MAX_LIMIT` is the mirror of that `@Max(100)`, and
  // enforcing it here is what stops it being a constant that documents a cap
  // nothing applies.
  if (pagination?.limit !== undefined) {
    params.set('limit', String(Math.min(pagination.limit, RETURNS_MAX_LIMIT)));
  }
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createReturnsApi(request: ApiRequest): ReturnsApi {
  return {
    async list(filters, pagination): Promise<ReturnListResult> {
      const raw = await request<unknown>(`/returns${buildQuery(filters, pagination)}`);
      const parsed = parseReturnList(raw);
      return {
        items: parsed.items,
        total: parsed.total,
        // What the server APPLIED, not what was asked for — the controller
        // fills its own defaults when a param is absent, so echoing the request
        // would report `limit: 0` for a call that omitted it while the server
        // used 20. The request is only the fallback.
        limit: parsed.limit ?? pagination?.limit ?? 0,
        offset: parsed.offset ?? pagination?.offset ?? 0,
        counts: parsed.counts,
        droppedCount: parsed.droppedCount,
      };
    },

    async getIngestionAvailability(): Promise<ReturnIngestionAvailability | null> {
      const raw = await request<unknown>('/returns/ingestion-availability');
      return parseReturnIngestionAvailability(raw);
    },
  };
}
