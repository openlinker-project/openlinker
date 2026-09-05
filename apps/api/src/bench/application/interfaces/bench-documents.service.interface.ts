/**
 * Bench documents service contract (#2418, `W3b-5`, spec § 2.6)
 *
 * The bench PRINTS; it never ISSUES (story F1). Nothing on this interface
 * creates a document, and no sales-document trigger is added by this wave —
 * packing is not a fiscal event.
 *
 * @module apps/api/src/bench/application/interfaces
 */
import type { FulfillmentWorkView } from '@openlinker/core/fulfillment';

import type {
  BenchDocumentsView,
  BenchUnlabelledParcelListView,
} from '../types/bench-parcel.types';

export const BENCH_DOCUMENTS_SERVICE_TOKEN = Symbol('IBenchDocumentsService');

export interface IBenchDocumentsService {
  /**
   * What goes inside this box and what goes on it.
   *
   * Takes the WORK rather than a work id: the caller has already established
   * that this parcel is one the bench may see (that is `BenchParcelService`'s
   * scoping), and re-reading it here would either duplicate that rule or, worse,
   * answer for a parcel the scoping would have refused.
   *
   * `canSeeCarrierText` gates the carrier's own prose on `shipments:write`,
   * exactly as `ShipmentResponseDto` gates it — the raw rejection text may embed
   * address fragments, and a `packer` holds no permissions at all.
   */
  getDocuments(
    work: FulfillmentWorkView,
    canSeeCarrierText: boolean
  ): Promise<BenchDocumentsView>;

  /**
   * Every finished box at this bench with no label on it (story F4).
   *
   * Read by the bench AND by whoever runs dispatch — one route, two audiences,
   * one truth. A second query for the same question is how the bench's count and
   * dispatch's list start to disagree about a box sitting on a floor.
   */
  listUnlabelled(): Promise<BenchUnlabelledParcelListView>;
}
