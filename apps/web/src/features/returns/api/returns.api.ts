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
import { parseDeclineReturnResult, parseReturnDetail } from './return-detail.schema';
import {
  parseDisposeReturnLineResult,
  parseMarkNotReturnedResult,
  parseReceiveReturnLineResult,
} from './return-custody.schema';
import { RETURNS_MAX_LIMIT } from './returns.types';
import type {
  DeclineReturnInput,
  DeclineReturnResult,
  DisposeReturnLineInput,
  DisposeReturnLineResult,
  MarkReturnLineNotReturnedInput,
  MarkReturnLineNotReturnedResult,
  ReceiveReturnLineInput,
  ReceiveReturnLineResult,
  PaginatedReturns,
  ReturnDetail,
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
  /**
   * The whole response was unreadable, as opposed to some of its rows. Carried
   * separately because it yields zero items and zero drops, so a caller testing
   * only `droppedCount` would render it as a confirmed-empty list.
   */
  envelopeUnreadable: boolean;
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

  /**
   * `GET /returns/:returnId` — one return with its lines, ordered by
   * `lineIndex`, plus the backend-resolved `declineAvailability`.
   *
   * Rejects with `ReturnDetailUnreadableError` when the record cannot be read —
   * see that class for why a detail throws where the list degrades.
   */
  get: (returnId: string) => Promise<ReturnDetail>;

  /**
   * `POST /returns/:returnId/decline` — ask the source to decline the refund.
   *
   * An ADR-044 change PROPOSAL, not a mutation OpenLinker completes: the result
   * reports what the source did, and `outcome: 'decline-sent'` with a null
   * `declinedAt` means it has not yet said. Safe to call twice — the backend's
   * proposal row resolves a second call to `in-flight` rather than sending
   * again — but the UI still guards, so the operator is never left wondering
   * whether a second request went out.
   */
  decline: (returnId: string, input: DeclineReturnInput) => Promise<DeclineReturnResult>;

  /**
   * `POST /returns/:returnId/lines/:lineId/receive` — record that more units
   * arrived (spec § 5.2).
   *
   * **Not idempotent, and must not be treated as such**: each call is a fresh
   * arrival act and a second one records a second receipt. The caller guards
   * against a double submit; there is no server-side dedup to fall back on,
   * because a return arriving in three parcels legitimately receives three
   * times.
   *
   * Refused with 409 + a `reason` — `over-receipt` when it would push past the
   * advised quantity.
   */
  receiveLine: (
    returnId: string,
    lineId: string,
    input: ReceiveReturnLineInput
  ) => Promise<ReceiveReturnLineResult>;

  /**
   * `POST /returns/:returnId/lines/:lineId/dispose` — record what became of
   * received units (spec § 5.3).
   *
   * A refused inventory-master write comes back on a **2xx** as
   * `restockBlocked`, never as an error: the disposition succeeded and is
   * recorded; the units simply stay in `quantityReceived` until an operator
   * attests.
   */
  disposeLine: (
    returnId: string,
    lineId: string,
    input: DisposeReturnLineInput
  ) => Promise<DisposeReturnLineResult>;

  /**
   * `POST /returns/:returnId/lines/:lineId/mark-not-returned` — record that the
   * parcel is not coming.
   *
   * Applies only where NOTHING arrived. Despite spec § 5.2's *"Mark remainder
   * not returned"* phrasing this is not a shortfall write — the model refuses a
   * partially received line, since custody is single-valued and no counter
   * exists for a shortfall to move into. Refused with 409 +
   * `partially-received` or `nothing-advised`.
   */
  markLineNotReturned: (
    returnId: string,
    lineId: string,
    input: MarkReturnLineNotReturnedInput
  ) => Promise<MarkReturnLineNotReturnedResult>;
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

/** One per-line custody route, with both ids encoded exactly once. */
function linePath(returnId: string, lineId: string, action: string): string {
  return `/returns/${encodeURIComponent(returnId)}/lines/${encodeURIComponent(lineId)}/${action}`;
}

/**
 * Omit an absent or empty note rather than sending `""`.
 *
 * The same rule the decline body follows: the backend treats the field as
 * optional, so an empty string would persist a comment the operator did not
 * write — and it would then render on the timeline as if they had.
 */
function noteBody(note: string | undefined): { note?: string } {
  return note !== undefined && note.trim() !== '' ? { note: note.trim() } : {};
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
        stageCounts: parsed.stageCounts,
        segmentCounts: parsed.segmentCounts,
        counts: parsed.counts,
        droppedCount: parsed.droppedCount,
        envelopeUnreadable: parsed.envelopeUnreadable,
      };
    },

    async getIngestionAvailability(): Promise<ReturnIngestionAvailability | null> {
      const raw = await request<unknown>('/returns/ingestion-availability');
      return parseReturnIngestionAvailability(raw);
    },

    async get(returnId): Promise<ReturnDetail> {
      const raw = await request<unknown>(`/returns/${encodeURIComponent(returnId)}`);
      return parseReturnDetail(raw, returnId);
    },

    async decline(returnId, input): Promise<DeclineReturnResult> {
      const raw = await request<unknown>(
        `/returns/${encodeURIComponent(returnId)}/decline`,
        {
          method: 'POST',
          body: JSON.stringify({
            reasonCode: input.reasonCode,
            // Omitted rather than sent as an empty string: the backend treats
            // the field as optional and the adapter decides whether a code
            // requires one, so an empty string would be a comment the operator
            // did not write.
            ...(input.comment !== undefined && input.comment !== ''
              ? { comment: input.comment }
              : {}),
          }),
        },
      );
      return parseDeclineReturnResult(raw);
    },

    async receiveLine(returnId, lineId, input): Promise<ReceiveReturnLineResult> {
      const raw = await request<unknown>(linePath(returnId, lineId, 'receive'), {
        method: 'POST',
        body: JSON.stringify({ quantity: input.quantity, ...noteBody(input.note) }),
      });
      return parseReceiveReturnLineResult(raw);
    },

    async disposeLine(returnId, lineId, input): Promise<DisposeReturnLineResult> {
      const raw = await request<unknown>(linePath(returnId, lineId, 'dispose'), {
        method: 'POST',
        body: JSON.stringify({
          quantity: input.quantity,
          disposition: input.disposition,
          ...noteBody(input.note),
        }),
      });
      return parseDisposeReturnLineResult(raw);
    },

    async markLineNotReturned(
      returnId,
      lineId,
      input
    ): Promise<MarkReturnLineNotReturnedResult> {
      const raw = await request<unknown>(linePath(returnId, lineId, 'mark-not-returned'), {
        method: 'POST',
        body: JSON.stringify({ ...noteBody(input.note) }),
      });
      return parseMarkNotReturnedResult(raw);
    },
  };
}
