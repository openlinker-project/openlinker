# Implementation Plan — Infakt real PDF download (#1321)

## 1. Task

Fix `InfaktInvoicingAdapter`'s always-null `pdfUrl` by implementing the existing
`RegulatoryDocumentReader` sub-capability against Infakt's real PDF endpoint
(`GET /invoices/{uuid}/pdf.json?document_type=original&invoice_type={kind}`,
verified live against the sandbox). Wire the FE Infakt invoice detail section to
the already-existing `GET /invoices/:invoiceId/document?kind=rendered` route.

**Layer**: Integration (Infakt adapter) + Frontend (Infakt plugin detail section).
**Non-goals**: no new sub-capability, no new controller route (the `/document`
route + `isRegulatoryDocumentReader` dispatch already exist and are unchanged),
no operator-configurable `document_type` (hardcode `'original'` for v1), no
change to Subiekt's `pdfUrl` usage (out of scope — Subiekt is FE-only today and
untouched by this fix).

## 2. Decision: keep `InvoiceRecord.pdfUrl`

Subiekt's FE detail section (`apps/web/src/plugins/subiekt/components/subiekt-invoice-detail-section.tsx`)
still reads `invoice.pdfUrl` for its own (separate, unverified) PDF link. Removing
the field core-wide would break that component's types for no benefit to this
issue's scope. **Decision: keep `pdfUrl` on `InvoiceRecord`, but stop Infakt from
populating it with a nonexistent field** — pass `null` explicitly at the 3 call
sites, with a comment explaining Infakt's real PDF path is now
`RegulatoryDocumentReader.getRegulatoryDocument(record, 'rendered')`, not this
field. Also drop the dead `print_url` field from the Infakt DTO type (never read).

## 3. Backend changes

1. `libs/integrations/infakt/src/infrastructure/http/infakt-http-client.interface.ts`
   — add `getBinary(path, query?): Promise<{ data: Uint8Array; contentType: string }>`.
2. `libs/integrations/infakt/src/infrastructure/http/infakt-http-client.ts`
   — implement `getBinary` via `fetch` + a capped streaming read (mirrors
   `KsefHttpClient.readBinaryBodyCapped`'s 10 MB cap — same defense-in-depth
   rationale: never fully buffer a mendacious/oversized body).
3. `libs/integrations/infakt/src/domain/types/infakt.types.ts` — remove the dead
   `pdf_url` / `print_url` fields from `InfaktInvoice`.
4. `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts`
   — add `RegulatoryDocumentReader` to the `implements` clause; implement
   `getRegulatoryDocument(record, kind)`: throws `UnsupportedRegulatoryDocumentKindError`
   for any kind other than `'rendered'` (Infakt has no UPO/confirmation of its
   own — it submits to KSeF natively and OL never touches that document), else
   calls `getBinary('invoices/{providerInvoiceId}/pdf.json', { document_type: 'original', invoice_type: toInfaktInvoiceType(record.documentType) })`.
   Replace the 3 `invoice.pdf_url ?? null` call sites with `null` + explanatory comment.
5. Unit tests: `infakt-invoicing.adapter.spec.ts` — new `getRegulatoryDocument`
   describe block (happy path returns bytes+contentType; unsupported kind throws).
   `infakt-http-client.spec.ts` — new `getBinary` test (happy path + oversized-body cap).

## 4. Frontend changes

1. `apps/web/src/features/invoicing/hooks/use-invoice-rendered-document-download.ts`
   (new) — mirrors `useKsefUpoDownload`'s shape (`{ download, isDownloading, error }`),
   calling `apiClient.invoicing.downloadDocument(invoiceId, 'rendered')` (already
   exists on the API client — no client change needed) and triggering a browser
   download. Neutral (kind-agnostic naming) so any future `rendered`-only
   provider can reuse it, not just Infakt.
2. Export it from `features/invoicing/index.ts` barrel.
3. `apps/web/src/plugins/infakt/components/infakt-invoice-detail-section.tsx`
   — add a "Download PDF" button gated on `invoice.regulatoryStatus === 'accepted'`
   (mirrors KSeF's UPO-availability gating), wired to the new hook. Update the
   file's header comment (currently says Infakt "exposes no UPO/FA3 document
   endpoints of its own" — still true for confirmation/source, but no longer
   true for a rendered PDF).
4. Tests: `infakt-invoice-detail-section.test.tsx` — new case asserting the
   download button appears when accepted and calls the mocked API client.

## 5. Validation

- `pnpm --filter @openlinker/integrations-infakt test`
- `pnpm --filter @openlinker/web test -- infakt-invoice-detail-section`
- `pnpm lint && pnpm type-check` (scoped packages first, full run before PR)
- Manual: re-verify against the sandbox that `GET /invoices/{uuid}/pdf.json?document_type=original&invoice_type=vat` still returns a valid PDF (already done ad hoc in this session).

## Pre-implement gate: skipped

This is a self-contained fix reusing an existing, unmodified capability
(`RegulatoryDocumentReader`), an existing, unmodified controller route
(`GET /invoices/:invoiceId/document`), and an existing, unmodified FE API
client method (`downloadDocument`). No new port, DI token, ORM entity, or
contract-surface change is introduced, so there is no reuse-collision or
contract-break surface for `/pre-implement` to catch.
