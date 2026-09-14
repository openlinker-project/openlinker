/**
 * Pack-bench work-list types (#2416, `W3b-3`)
 *
 * The browser's view of `GET /bench/work`.
 *
 * ## No `z.enum` on the two server-owned vocabularies
 *
 * `state` and `supportedActions` are plain strings here for the reason
 * `fulfillment.types.ts` records: an enum would mean that the day the backend
 * adds a value, the whole response fails to parse and the bench reports "nothing
 * to pack" for a bench that has work — a false statement, and on this surface a
 * packer standing in front of a full trolley being told there is nothing to do.
 * An unrecognised value degrades in the copy layer instead.
 *
 * @module apps/web/src/features/bench/api
 */

/** One parcel on the bench's list. */
export interface BenchWork {
  workId: string;
  version: number;
  orderId: string;
  orderReference: string;
  buyerName: string | null;
  dispatchByAt: string | null;
  parcelIndex: number;
  parcelTotal: number;
  lineCount: number;
  /** Units to confirm against the box. Never a readiness claim. */
  unitsToVerify: number;
  /** `packable` | `held` | `cancelled`, or an unrecognised value from a newer API. */
  state: string;
  holdReason: string | null;
  holdPlacedAt: string | null;
  expeditedAt: string | null;
  supportedActions: string[];
}

/** Whether packing work can reach this bench at all. */
export interface BenchRoutingReadiness {
  ready: boolean;
  /** Why not, when it cannot. `null` when it can. */
  reason: string | null;
}

export interface BenchWorkList {
  works: BenchWork[];
  executorName: string | null;
  routing: BenchRoutingReadiness;
  /** May exceed `works.length` — the surface says so rather than truncating silently. */
  total: number;
}
