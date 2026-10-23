/**
 * Sales-Document Operational List Types (#3306)
 *
 * Vocabulary for `ISalesDocumentViewService.listSalesDocuments` - the merged,
 * keyset-paginated, cross-order read backing `GET /sales-documents`. Distinct
 * from `SalesDocumentView` (ADR-065): that projection is keyed by a
 * caller-supplied set of order ids (`getForOrders`/`getForOrder`); this one is
 * keyed by nothing but a filter and a cursor, and walks every order that has
 * at least one invoice or fiscal-registration record.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { SalesDocumentKind, SalesDocumentRecordView } from '@openlinker/core/sales-documents';
import type { InvoiceRecordKeysetCursor } from '@openlinker/core/invoicing';
import type { FiscalRegistrationKeysetCursor } from '@openlinker/core/fiscalization';

/**
 * Filter surface for the merged list. `status` is passed through to WHICHEVER
 * source(s) `kind` selects and compared with `=` against that source's own
 * status column - a value that names only one kind's vocabulary (e.g. an
 * invoice-only `regulatoryStatus`-flavoured status is not modelled here at
 * all) simply matches nothing on the other source, which is the documented,
 * accepted behaviour rather than a cross-kind status translation.
 */
export interface SalesDocumentListFilters {
  /**
   * `undefined` fetches both sources. `'invoice'` / `'fiscal-receipt'` fetches
   * only that source - the other contributes no rows and its half of the
   * cursor stays permanently `null`. There is no `'routing-not-set'` value:
   * an order with neither an invoice nor a fiscal-registration record has NO
   * ROW in either source table, so a record-driven list structurally cannot
   * list it. Surfacing "routing not set" orders is a different read
   * (`ISalesDocumentViewService.getForOrders` already reports it per order)
   * and is out of scope for this list.
   */
  kind?: SalesDocumentKind;
  status?: string;
  connectionId?: string;
  /** Inclusive lower bound on the source's own "issued/created" instant. */
  issuedFrom?: Date;
  /** Inclusive upper bound on the source's own "issued/created" instant. */
  issuedTo?: Date;
  taxId?: 'with' | 'without';
  /** Matches order id, provider document reference, or invoice number. */
  search?: string;
}

/**
 * Composite keyset position across BOTH sources. Per side:
 *   - `null`      — this source is exhausted; never query it again this walk.
 *   - `undefined` — fetch this source from the start (its own batch was
 *                   fetched but none of it was consumed into a page yet, so
 *                   nothing has advanced past its beginning).
 *   - a cursor    — resume strictly after this row.
 * The top-level pagination `cursor` being absent from the request means
 * "first page," equivalent to `{ invoice: undefined, fiscal: undefined }`.
 */
export interface SalesDocumentListCursor {
  invoice: InvoiceRecordKeysetCursor | null | undefined;
  fiscal: FiscalRegistrationKeysetCursor | null | undefined;
}

export interface SalesDocumentListPagination {
  limit: number;
  cursor?: SalesDocumentListCursor;
}

export interface SalesDocumentListAmount {
  value: number;
  currency: string;
}

export interface SalesDocumentListItem {
  orderId: string;
  connectionId: string;
  document: SalesDocumentRecordView;
  /**
   * The order's own native total, or `null` when `order_records` carries no
   * populated total for it (never summed across currencies - `currency`
   * travels with `value` precisely so a caller cannot add two rows' amounts
   * without checking they agree first).
   */
  amount: SalesDocumentListAmount | null;
  /**
   * How many OTHER connections hold a record (of either kind) for this same
   * order - the ADR-041 duplicate signal, reusing the exact predicate
   * `SalesDocumentView.otherRecords` already uses. `0` means this is the only
   * record for its order.
   */
  otherRecordCount: number;
}

export interface SalesDocumentListPage {
  items: SalesDocumentListItem[];
  /**
   * The composite cursor to pass back for the next page. There is no next
   * page only when BOTH `invoice` and `fiscal` are `null` on it - a caller
   * checks both fields, never a single top-level "done" flag, because either
   * side may still have rows while the other is exhausted.
   */
  nextCursor: SalesDocumentListCursor;
}
