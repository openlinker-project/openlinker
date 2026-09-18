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
import type {
  SalesDocumentListFilters,
  SalesDocumentListPage,
  SalesDocumentListPagination,
} from '../../domain/types/sales-document-list.types';

export interface ISalesDocumentViewService {
  /**
   * Cross-order operational list (#3306) - `GET /sales-documents`. Unlike
   * {@link getForOrders}, which projects a caller-supplied set of order ids,
   * this walks every order that has AT LEAST ONE invoice or
   * fiscal-registration record, newest-first, keyset-paginated.
   *
   * Merges two independently keyset-paginated sources
   * (`IInvoiceService.listInvoicesKeyset`,
   * `IFiscalRegistrationService.listRegistrationsKeyset`) in application
   * code - never a SQL `UNION` - via the pure
   * `mergeSalesDocumentPages` helper, which is what keeps the merge correct
   * under concurrent inserts (see that function's own docblock). Each
   * returned row's duplicate-order signal
   * (`SalesDocumentListItem.otherRecordCount`) reuses the SAME
   * `groupRankedRecords` grouping `getForOrders` uses internally, batched
   * over just the orders on this page.
   */
  listSalesDocuments(
    filters: SalesDocumentListFilters,
    pagination: SalesDocumentListPagination,
  ): Promise<SalesDocumentListPage>;
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
   * `matchedRule` is ALWAYS `null` here (#3186 review): the "Why this kind?"
   * disclosure is a detail-only read — the #2349/#2350 convention — so this
   * path neither carries a conditions array per row nor issues the extra rule
   * read. A caller must therefore never infer "no rule decided this order's
   * kind" from this read; only {@link getForOrder} answers that.
   *
   * Duplicate ids are collapsed. Returns an empty map for an empty input.
   */
  getForOrders(orderIds: readonly string[]): Promise<Map<string, SalesDocumentView>>;

  /**
   * The same projection for one order, or `null` when no `order_records` row
   * exists for it (#2517).
   *
   * Deliberately the batched read applied to one id rather than a second
   * assembly path: the order-detail panel and the `/orders` row must agree
   * about the same order, and two code paths building one shape is exactly how
   * they stop agreeing. `null` is the caller's 404, never an all-null
   * projection - an order OpenLinker has never seen has no document state to
   * describe.
   *
   * The ONE field that differs from the batch read is `matchedRule`, which only
   * this path resolves (#3186 review) — one shared assembly with one flag, not
   * a second path, so nothing else can drift between the row and the panel.
   */
  getForOrder(orderId: string): Promise<SalesDocumentView | null>;
}
