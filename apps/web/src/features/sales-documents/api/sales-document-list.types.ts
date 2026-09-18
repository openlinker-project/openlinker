/**
 * Sales-Document List Types (#3307)
 *
 * Hand-mirrored from `GET /sales-documents`'s response DTOs
 * (`apps/api/src/orders/http/dto/sales-document-list-item-response.dto.ts`,
 * `.../paginated-sales-documents-response.dto.ts`) per the FE-001 contract
 * strategy — the browser bundle cannot import `@openlinker/core`.
 *
 * `document` reuses `SalesDocumentRecordView` from `features/orders`
 * (re-exported for exactly this reason, #3307) rather than a second copy of
 * the discriminated union: one document is described one way everywhere it
 * renders.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { SalesDocumentRecordView } from '../../orders';

/** Mirrors `ListSalesDocumentsQueryDto`. `kind` omitted fetches both. */
export interface SalesDocumentListFilters {
  readonly kind?: 'invoice' | 'fiscal-receipt';
  readonly status?: string;
  readonly connectionId?: string;
  readonly issuedFrom?: string;
  readonly issuedTo?: string;
  readonly taxId?: 'with' | 'without';
  readonly search?: string;
}

export interface SalesDocumentListPagination {
  readonly limit?: number;
  /** Opaque — from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

export interface SalesDocumentListAmount {
  readonly value: number;
  /** ISO 4217, native to the order — never converted. */
  readonly currency: string;
}

export interface SalesDocumentListItem {
  readonly orderId: string;
  readonly connectionId: string;
  readonly document: SalesDocumentRecordView;
  /** `null` when the order carries no populated total. */
  readonly amount: SalesDocumentListAmount | null;
  /** How many OTHER connections hold a record for this same order (ADR-041). */
  readonly otherRecordCount: number;
}

export interface PaginatedSalesDocuments {
  readonly items: readonly SalesDocumentListItem[];
  /** `null` means both sources are exhausted — there is no more data. */
  readonly nextCursor: string | null;
}
