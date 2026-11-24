# Implementation plan - OpenLinker-rendered FA(3) invoice PDF with KOD I / KOD II and a persisted invoice hash (#3620)

Part of #3510 (G06). Decision D30. Blocks #3548, #3549, #3550. Mockup M24 (`ksef-issued`, `not-cleared`).
Status: DRAFT, local only (not committed).

## 1. Goal and layer

Render a PDF visualisation of the FA(3) XML OpenLinker submitted, with KOD I (and KOD II for an offline invoice) and the KSeF number as caption, and persist the invoice hash in a new `invoice_records` column when the invoice is sent.

Layers: **CORE** (neutral column + read path) and **Integration** (KSeF renderer, hash at send). No frontend.

### Non-goals
- A PDF of the legal e-receipt (stays at eparagony.pl, D30).
- The shared "document read" that every provider resolves through (#3548) - this issue only makes the KSeF side able to answer it.
- Marketplace upload (#3549), email (#3550).
- The FE QR restore (#3547, PR #3783).

## 2. What is already on `main` (do not rebuild)

- `KsefInvoicingAdapter.getVerificationLink` (#3648) builds KOD I from `record.sourceDocument` bytes + `P_1` + seller NIP + `resolveKsefQrBaseUrl(env)`. It re-hashes the stored XML on every read (`ksef-invoicing.adapter.ts:1299`) - exactly what AC2 forbids.
- `submitInvoice` computes `invoiceHash` in plain Base64 for the KSeF request body (`:1484`) and stores it nowhere.
- `supportedRegulatoryDocumentKinds()` returns `['confirmation']`; `getRegulatoryDocument` throws `UnsupportedRegulatoryDocumentKindError` for `rendered`.
- `sourceDocument` (StoredDocument, jsonb) already holds the submitted XML bytes for issued AND offline records.
- No PDF or QR library exists on the backend. The web app uses `qrcode-generator`.

## 3. Open questions (need an answer before step 6)

1. **KOD II is not implementable from what the repo holds.** KOD II is a URL signed with an *offline certificate* (KSeF certificate type "Offline"). No connection field, credential or session code carries one (`setup-guide.md:462`). Options: (a) this issue adds acquiring and storing the offline certificate (large, separate); (b) ship KOD I + the not-cleared waiting state now, and for an offline invoice render the PDF **without** a QR and with an explicit "awaiting submission" caption, filing KOD II as a follow-up. AC1/AC5 name KOD II explicitly, so (b) is a scope cut that needs sign-off.
2. **PDF library and fonts.** Polish characters need an embedded TTF (standard PDF fonts lack `ł`, `ą`...). Proposal: `pdfkit` + the already-used `qrcode-generator`, with one OFL font file vendored in the ksef package. Alternative is a server-side HTML renderer (puppeteer) - rejected: a headless browser in the API image.
3. **Byte stability (AC4).** pdfkit embeds a creation date and a document ID. Both must be fixed from the invoice (`issuedAt`) so the same invoice yields identical bytes; verified by a test.

## 4. Design

### 4.1 Persisted hash
- New column `invoice_records.sourceDocumentHash text NULL` (neutral name, ADR-026: no `ksef` in core). Value: Base64URL of SHA-256 over the submitted XML bytes.
- Written when the document is created from the issue result: the adapter returns it on the issued result next to `sourceDocument`; `InvoiceService` persists it at create. Sent-at semantic: the hash is of the bytes sent, taken once from the same buffer as `sourceDocument`.
- `getVerificationLink` reads the column; if it is `NULL` (rows issued before this migration) it falls back to hashing `sourceDocument` once (keeps existing links working, no backfill needed). The column is never recomputed from re-serialised XML.
- Migration with `up` and `down`; run `migration:show`. No backfill.

### 4.2 PDF renderer (KSeF package)
- `ksef-invoice-pdf.renderer.ts` (pure): input = FA(3) XML string + KSeF number + KOD I url; output = `Uint8Array`. Parses with the already-present `fast-xml-parser`. Sections: seller, buyer, lines, totals, KSeF number, QR.
- Pre-condition: only for `regulatoryStatus === 'accepted'` with a valid KSeF number. Before that no QR and no PDF are produced; the read reports the waiting state through a new neutral error (see 4.3).
- Deterministic: fixed info dict dates (`issuedAt`), no random IDs, fixed font.

### 4.3 Read path
- `supportedRegulatoryDocumentKinds()` adds `'rendered'`; `getRegulatoryDocument(record, 'rendered')` returns `{ content, contentType: 'application/pdf' }`.
- Not cleared: throw a new `RegulatoryDocumentNotReadyError` (core, `domain/exceptions`, sibling of `UnsupportedRegulatoryDocumentKindError`) that the controller maps to 409 with a distinct code, so #3548 can render M24 `not-cleared` rather than "missing document".
- `assessPrintability` in `bench-documents.service.ts` already calls `supportsRegulatoryDocumentKind(adapter, 'rendered')`, so a cleared KSeF invoice becomes `ready` at the bench with no bench change - this is intended and must be covered by a test.

## 5. Steps (file by file)

1. `libs/core/src/invoicing/domain/types/invoicing.types.ts`, `entities/invoice-record.entity.ts`, `infrastructure/persistence/entities/invoice-record.orm-entity.ts`, `.../invoice-record.repository.ts`: add `sourceDocumentHash`. AC: round-trips through repository.
2. `apps/api/src/migrations/<ts>-add-invoice-record-source-document-hash.ts`: add/drop column. AC: `migration:show` clean, down works.
3. `libs/core/src/invoicing/application/services/invoice.service.ts` (+ issue result type): carry and persist the hash at create. AC: unit test.
4. `libs/integrations/ksef/.../ksef-invoicing.adapter.ts`: compute Base64URL hash from the XML buffer once, return it; `getVerificationLink` prefers the column. AC: known XML -> known hash; link unchanged for a legacy NULL row.
5. `libs/core/src/invoicing/domain/exceptions/regulatory-document-not-ready.error.ts` + barrel + controller mapping (`invoicing.controller.ts`, two `getRegulatoryDocument` call sites). AC: 409 with a distinct code.
6. `libs/integrations/ksef/src/infrastructure/pdf/ksef-invoice-pdf.renderer.ts` + vendored font + `package.json` deps. AC: golden tests (below).
7. Adapter: `rendered` kind wired as in 4.3. AC: cleared -> PDF bytes; not cleared -> not-ready error; `supportedRegulatoryDocumentKinds` includes `rendered`.
8. Docs: update `setup-guide.md` KOD II note (honest per the answer to open question 1), `docs/architecture-overview.md` (new column, `rendered` kind for KSeF), `docs/lessons.md` if a mistake surfaces.

## 6. Tests

- Hash: known XML -> known Base64URL hash; column written at create; legacy NULL row still yields the same KOD I link.
- QR payload per environment (test / demo / prod hosts from `KsefEnvironment`).
- Offline case: per the decision on KOD II - either KOD II payload, or "no QR + awaiting caption".
- Renderer: golden text extraction (seller, buyer, lines, totals, KSeF number); Polish diacritics survive; **same invoice -> identical bytes** across two renders.
- Not cleared: no PDF and no QR produced; read reports the waiting state.
- Bench: a cleared KSeF invoice is `ready`; an uncleared one is not.
- Integration spec for the repository column (real Postgres via Testcontainers).

## 7. Validation

- Hexagonal: renderer lives in the integration package; core only gains a neutral column, a neutral error and no `ksef` vocabulary (ADR-026).
- Capability: `rendered` is advertised through the existing optional `supportedRegulatoryDocumentKinds` probe (ADR-046 shape), so inFakt/Subiekt/out-of-tree plugins are untouched.
- Security: the PDF is built only from the persisted XML; no user input is interpolated into a URL except the NIP, which is `encodeURIComponent`-ed as today.
- Risks: new runtime dependencies (pdfkit); font licensing; KOD II scope.
