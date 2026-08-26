/**
 * Sales-Document View Service Interface (#2516, ADR-065)
 *
 * The ONE read the `/orders` row, the order-detail panel and the settings
 * page's per-market evidence share. It composes what already exists - the
 * order record's persisted block reasons, the invoicing projection, the
 * fiscal-registration projection and the routing decision - into
 * `SalesDocumentView` (`@openlinker/core/sales-documents`), so the three
 * surfaces cannot disagree about the same order.
 *
 * It lives in `orders` because the projection is keyed by order and the two
 * document contexts are consumed through their published `I*Service`s
 * (`docs/architecture-overview.md` § Cross-context dependencies in core). It
 * could not live in `sales-documents`, which is a sink with zero outbound
 * edges to sibling core contexts and must stay one.
 *
 * WRITES NOTHING. Every method here is a projection read; none of them issues,
 * registers, routes or configures anything.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
import type { SalesDocumentView } from '@openlinker/core/sales-documents';

export interface ISalesDocumentViewService {
  /**
   * The sales-document projection for each of `orderIds`, keyed by order id.
   *
   * BATCHED (#2516): the number of queries is fixed and does NOT grow with the
   * number of ids - one read per underlying store for the whole page, in the
   * shape `getEarliestOrderDateByConnection` (#2083) established, never a
   * per-row loop.
   *
   * An order that has no sales document at all is PRESENT in the map with
   * `documentKind` resolved from routing (or `null` when routing has not
   * decided) and `document: null` - never absent, because "no document yet" is
   * a state the surfaces render rather than a gap they skip.
   *
   * An id with no `order_records` row at all IS absent, matching
   * `IOrderRecordService.findByIds`: there is no order to project, and
   * inventing an all-null entry would let a caller render a document panel for
   * an order OpenLinker has never seen.
   *
   * Duplicate ids are collapsed. Returns an empty map for an empty input.
   */
  getForOrders(orderIds: readonly string[]): Promise<Map<string, SalesDocumentView>>;
}
