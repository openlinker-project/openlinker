# Implementation Plan — Merged Sales-Documents List (Backend, #3306)

## 1. Goal

Give the frontend (#3307) one endpoint that answers "every invoice and fiscal receipt, one paginated
list" — today `GET /invoices` only reads `invoice_records`, and no endpoint reads
`fiscal_registration_records` as a flat list at all.

**Layer**: CORE (orders context, extending `ISalesDocumentViewService`) + Interface (`apps/api`).

**Explicit non-goals for this slice**: a SQL `UNION` (Option A in the design mockup) — the merge
stays two keyset-paginated queries combined in application code. No new `sales-documents` core
context edge (that context stays zero-outbound-edge).

## 2. Existing patterns to reuse (not reinvent)

- `ISalesDocumentViewService` / `SalesDocumentViewService`
  (`libs/core/src/orders/application/interfaces/sales-document-view.service.interface.ts`,
  `libs/core/src/orders/application/services/sales-document-view.service.ts`) — already injects
  `IInvoiceService` + `IFiscalRegistrationService`. This is where the new method lives.
- Keyset pagination — copy the row-value cursor shape at
  `libs/core/src/invoicing/infrastructure/persistence/repositories/invoice-record.repository.ts:379-420`
  (`(updatedAt, id)` tuple compare, millisecond-truncated).
- `IFiscalRegistrationService.getById` already exists
  (`libs/core/src/fiscalization/application/services/fiscal-registration.service.interface.ts:252`) —
  only the HTTP route is missing.
- `ListInvoicesQueryDto` (`apps/api/src/invoicing/http/dto/list-invoices-query.dto.ts`) is the filter
  shape to mirror for the new query DTO.
- The one-document-per-order duplicate check already used by the write-path guard
  (`InvoiceRecord.blocksIssuanceElsewhere` / ADR-041) is the source for the duplicate indicator — not
  a new query.

## 3. Data flow

```
GET /sales-documents?kind=&status=&connectionId=&buyerTaxId=&issuedFrom=&issuedTo=&search=&cursor=&limit=
        │
        ▼
apps/api: SalesDocumentsController (new, apps/api/src/invoicing/http/ or a sibling folder)
        │  → ISalesDocumentViewService.listSalesDocuments(filters, {cursor, limit})
        ▼
libs/core/orders: SalesDocumentViewService
        │  ├─ IInvoiceService.listInvoices(filter, keysetPagination)   (existing method, widened)
        │  └─ IFiscalRegistrationService.list-like read (new, keyset)
        ▼
merge-sort both pages by (issuedAt|updatedAt, id) in application code, cap to `limit`,
compute nextCursor from the last merged row
```

`GET /fiscal-registrations/:id` is a separate, independent addition to the existing
`FiscalizationController` — no new service method, `getById` is already there.

## 4. Steps

1. **Types** (`libs/core/src/orders/domain/types/` or beside the existing `SalesDocumentView` types):
   `SalesDocumentListFilters`, `SalesDocumentKeysetCursor` (`{ instant: string; id: string }`),
   `SalesDocumentListPage` (`{ items: SalesDocumentListItem[]; nextCursor: string | null }`),
   `SalesDocumentListItem` (orderId, kind, raw status-source fields per kind, amount + currency,
   connectionId, issuedAt, `otherRecordCount` for the duplicate indicator).
2. **Keyset read on the invoice side**: widen `InvoiceRecordRepository` (or add a sibling method)
   with a keyset variant of the existing OFFSET `findMany`, following the pattern already in
   `invoice-record.repository.ts:379-420` exactly (including the millisecond-truncation compare).
3. **Keyset read on the fiscal side**: `FiscalRegistrationRepository` currently has no cross-order
   paginated read at all — add one, same keyset shape.
4. **`ISalesDocumentViewService.listSalesDocuments`**: fetch one page from each side (limit = the
   caller's limit, so the merge never needs a second round-trip for a full page), merge-sort
   descending by instant, truncate to `limit`, derive `nextCursor` from the last row *of each source
   that was actually consumed* (a composite cursor carrying both sides' positions — a single scalar
   cursor cannot restart two independently-paged sources correctly).
5. **Duplicate indicator**: reuse `IInvoiceService`'s existing `blocksIssuanceElsewhere`-shaped check
   per order, batched to avoid N+1 (mirrors the `getEarliestOrderDateByConnection` batching
   precedent named in the architecture doc).
6. **Aggregate/summary read**: a second method (`getSalesDocumentSummary(filters)`) returning
   `{count, amountByKind, failedCount, duplicateOrderCount}` — same filter shape, no pagination.
7. **HTTP layer**: new `SalesDocumentsController` (`apps/api/src/invoicing/http/sales-documents.controller.ts`
   — living beside `invoicing.controller.ts` since it's the natural sibling of `GET /invoices`) +
   `ListSalesDocumentsQueryDto`; add `GET /fiscal-registrations/:id` to the existing
   `FiscalizationController`.
8. **Tests**: unit tests for the merge/keyset logic (including the "row inserted mid-walk" case) and
   the duplicate-indicator batching; integration tests for both new/extended HTTP routes.

## 5. Validation

- `pnpm --filter @openlinker/core type-check` / `pnpm --filter @openlinker/api type-check`
- `pnpm --filter @openlinker/core lint` / `pnpm --filter @openlinker/api lint`
- Scoped unit tests for the touched files (not the full monorepo `pnpm test`)
- `pnpm check:invariants` — confirms no new `sales-documents` outbound edge
