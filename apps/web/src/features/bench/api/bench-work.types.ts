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
/** One product line as the rail shows it (#3415). */
export interface BenchWorkItem {
  /**
   * `null` when the variant is not in the catalogue - a real answer a packer
   * can act on, never to be replaced with a placeholder that reads like a
   * product name.
   */
  name: string | null;
  quantity: number;
  /** The API's own proxy path, or `null`. Rendered through `BenchThumb`. */
  imageUrl: string | null;
}

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
  /**
   * What is in the box (#3415) - what the rail leads with.
   *
   * CAPPED by the server, with `lineCount` above as the honest total, so a row
   * showing two of five lines must say so rather than implying it is all of
   * them. May be empty: every line cancelled to zero, or a parcel with none.
   */
  items: BenchWorkItem[];
  /** Units to confirm against the box. Never a readiness claim. */
  unitsToVerify: number;
  /** `packable` | `held` | `cancelled`, or an unrecognised value from a newer API. */
  state: string;
  holdReason: string | null;
  holdPlacedAt: string | null;
  expeditedAt: string | null;
  supportedActions: string[];
  /**
   * How this parcel's ADR-074 pre-assignment relates to the signed-in packer
   * (#3341) — `mine` | `unassigned` | `assigned-other`, or an unrecognised
   * value from a newer API. Computed server-side; never a raw other-packer id.
   */
  assignmentState: string;
  /** May THIS packer claim (open, verify) this parcel? See `assignmentState`. */
  claimable: boolean;
  /**
   * When an operator declared this parcel finished and off the bench
   * (pack-bench completion), or `null` until that act.
   *
   * The server deliberately keeps returning a completed row here rather than
   * filtering it out of the query — see `BenchWorkService`'s own docblock —
   * so the exclusion from "at this bench" is drawn on the READING side, by
   * `groupBenchWork`.
   */
  completedAt: string | null;
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
