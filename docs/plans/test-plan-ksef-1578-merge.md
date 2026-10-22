# Test plan - KSeF legal-completeness merge (epic #1578 onto `main`)

Subject: worktree `.worktrees/ksef1578`, branch `1578-ksef-legal-completeness-onto-main`, merge commit `a4a0cbc1b` (`git diff a4a0cbc1b^1 a4a0cbc1b`, 107 files). Issues #1578, #1579, #1580, #1581, #1582, #1586, #1589, #1594, #1595, #1596; PRs #1598, #1600, #1601, #1602, #1603, #1604, #1605, #1607, #1610, #1611, #1627.

This plan is the deduplicated UNION of three independently produced test-case inventories (source 1: 370 cases, source 2: 286 rows, source 3: 330 cases). Two input cases were merged into one row only when they test the same behaviour with the same expected result; the most precise steps, expected result and source were kept. Where sources disagreed, the merged code was read and the correct expectation kept, with the disagreement noted in the row. All `file:line` references are to the merged tree (HEAD `a4a0cbc1b`).

## Legend

- **ID** - new scheme per area (GATE, NIP, QR, ADDR, JSTGV, ADN, FX, A108G, CORR, CLR, MIG, BUYOV, LEASE, XB, GTU, RATE, MF, PERM, PACE, FC, MERGE, REG, UI, ROLE, DOC, REACH). Defects are DEF-xx.
- **Level** - `e2e-UI` (Playwright, live stack), `e2e-API` (apps/e2e api client, live stack + KSeF TEST), `integration` (`*.int-spec.ts` / Testcontainers / CI build), `unit` (jest / vitest), `manual-KSeF-portal` (needs the MF KSeF / QR portal, a phone scanner or a real KSeF response), `manual-review` (document, legal or visual review that is not a KSeF-portal step - used by the input files as "manual" / "doc review"), `not-testable` (no producer in the product). Several levels joined by `+` mean the case needs all of them; the first one is the "primary level" used in the counts.
- **Prio** - P0 = blocks shipping / fiscal-correctness or data-integrity risk; P1 = must run before release; P2 = hardening / cosmetic / docs. When sources disagreed, the highest priority was kept.
- **Found by** - which input file had the case, with its original IDs, e.g. `1 (LS-09); 3 (GATE-01)`. Source 3's UI-state matrix rows are cited as `3 (§20 row n)`, the reachability tables as `2 (§14)` / `3 (§21)`.
- **Existing coverage** - a unit / integration spec shipped in the merge (or an existing suite to rerun) that already covers the row; the row is kept regardless. `none - add` marks a gap that sources flagged explicitly.
- **Providers** - correction-form rows that repeat per provider list `ksef, infakt, subiekt-nexo, subiekt-gt, eparagony` in the Precondition column and run once per provider.

## Summary

### Rows per area, priority and primary level

Primary level = the first level listed in the row. REACH matrix rows are counted separately below.

| Area | P0 | P1 | P2 | Total | e2e-UI | e2e-API | integration | unit | manual-KSeF-portal | manual-review | not-testable | from 1 source | from 2 sources | from all 3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GATE | 5 | 10 | 6 | 21 | 1 | 3 | 1 | 14 | 0 | 1 | 1 | 4 | 3 | 14 |
| NIP | 1 | 24 | 15 | 40 | 4 | 7 | 1 | 27 | 0 | 1 | 0 | 10 | 11 | 19 |
| QR | 11 | 22 | 14 | 47 | 9 | 3 | 1 | 28 | 2 | 4 | 0 | 9 | 17 | 21 |
| ADDR | 5 | 4 | 3 | 12 | 0 | 2 | 0 | 9 | 1 | 0 | 0 | 4 | 4 | 4 |
| JSTGV | 0 | 8 | 8 | 16 | 1 | 4 | 2 | 8 | 1 | 0 | 0 | 7 | 3 | 6 |
| ADN | 2 | 8 | 7 | 17 | 1 | 2 | 0 | 10 | 1 | 2 | 1 | 5 | 5 | 7 |
| FX | 7 | 20 | 14 | 41 | 1 | 6 | 4 | 29 | 1 | 0 | 0 | 15 | 13 | 13 |
| A108G | 0 | 3 | 4 | 7 | 4 | 0 | 0 | 3 | 0 | 0 | 0 | 1 | 1 | 5 |
| CORR | 6 | 15 | 8 | 29 | 3 | 2 | 1 | 22 | 1 | 0 | 0 | 5 | 9 | 15 |
| CLR | 4 | 8 | 11 | 23 | 0 | 3 | 3 | 14 | 1 | 2 | 0 | 9 | 3 | 11 |
| MIG | 2 | 6 | 0 | 8 | 0 | 0 | 7 | 1 | 0 | 0 | 0 | 2 | 1 | 5 |
| BUYOV | 3 | 12 | 5 | 20 | 2 | 2 | 0 | 14 | 2 | 0 | 0 | 7 | 6 | 7 |
| LEASE | 4 | 3 | 2 | 9 | 0 | 0 | 5 | 3 | 0 | 0 | 1 | 2 | 5 | 2 |
| XB | 5 | 8 | 7 | 20 | 2 | 5 | 1 | 12 | 0 | 0 | 0 | 7 | 4 | 9 |
| GTU | 0 | 1 | 5 | 6 | 0 | 0 | 0 | 5 | 0 | 0 | 1 | 1 | 2 | 3 |
| RATE | 1 | 5 | 0 | 6 | 0 | 2 | 0 | 4 | 0 | 0 | 0 | 3 | 1 | 2 |
| MF | 2 | 13 | 6 | 21 | 0 | 2 | 1 | 17 | 0 | 0 | 1 | 6 | 3 | 12 |
| PERM | 0 | 5 | 3 | 8 | 0 | 1 | 0 | 6 | 1 | 0 | 0 | 1 | 2 | 5 |
| PACE | 0 | 23 | 18 | 41 | 2 | 5 | 2 | 31 | 0 | 1 | 0 | 13 | 7 | 21 |
| FC | 2 | 3 | 0 | 5 | 0 | 1 | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 1 |
| MERGE | 5 | 2 | 2 | 9 | 0 | 1 | 2 | 4 | 0 | 2 | 0 | 9 | 0 | 0 |
| REG | 7 | 13 | 8 | 28 | 3 | 4 | 6 | 15 | 0 | 0 | 0 | 13 | 6 | 9 |
| UI | 0 | 3 | 6 | 9 | 2 | 0 | 0 | 7 | 0 | 0 | 0 | 4 | 5 | 0 |
| ROLE | 2 | 7 | 2 | 11 | 3 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 8 |
| DOC | 0 | 2 | 10 | 12 | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 4 | 3 | 5 |
| **Total** | **74** | **228** | **164** | **466** | **38** | **63** | **39** | **285** | **11** | **25** | **5** | **143** | **119** | **204** |

### Totals

| Measure | Count |
|---|---|
| Test-case rows (areas above) | 466 |
| REACH matrix rows | 24 |
| Defects (DEF-xx) | 39 (36 CONFIRMED, 3 UNVERIFIED) |
| Rows found by exactly 1 source / 2 sources / all 3 | 143 / 119 / 204 |
| Rows citing source 1 / 2 / 3 | 344 / 310 / 339 |
| Rows found ONLY by source 1 / 2 / 3 | 61 / 40 / 42 |
| Input rows merged (source 1 / 2 / 3) | 370 / 286 / 330 - every input ID appears in at least one "Found by" cell |

## Defects found during analysis

Merged from source 1 (B1-B13, G1), source 2 (F1-F20) and source 3 (F1-F22). Severity is the highest any source gave (source 1's B-list carries no severity, so its test priority was used). Status CONFIRMED = re-checked in the merged code for this plan; UNVERIFIED = needs an outside source (MF documentation, a live KSeF response, or legal review).

| ID | Title | Severity | file:line | Found by | Status | Tests |
|---|---|---|---|---|---|---|
| DEF-01 | New pre-provider KSeF refusals (`KsefCrossBorderUnsupportedException`, `KsefExchangeRateException`, `KsefPermissionDeniedException`) carry no `failureMode: 'rejected'`, so `InvoiceService.classifyFailure` records them `in-doubt` / `transport-timeout` ("request timed out"). Consequences: not re-attemptable (`/invoices/retry` skips, `resumeExisting` returns untouched), `blocksIssuanceElsewhere` true, operator sees a timeout, manual issue 422 hides the actionable text, worker job ends `outcome:'ok'` on retry, the allocated P_2 number is consumed, flipping `allowCrossBorder` afterwards does not unstick the order | P0 | `libs/core/src/invoicing/application/services/invoice.service.ts:981-984,1007-1013,658-684,740-762`; `invoice-record.entity.ts:218-242`; `libs/integrations/ksef/src/domain/exceptions/ksef-{cross-border-unsupported,exchange-rate,permission-denied}.exception.ts` | 1 (B1); 2 (F2); 3 (F1) | CONFIRMED (only `ksef-invalid-correction.exception.ts` sets `failureMode`; `classifyFailure` returns `in-doubt` for anything not `'rejected'`) | XB-09, XB-10, FX-29, FX-30, PERM-04, FC-01..05 |
| DEF-02 | QR points at the TEST portal for `operator` (and non-demo `viewer`) on a prod connection: `ConnectionResponseDto` returns `config:{}`, `config.env` is undefined, host falls back to `qr-test` | P0 | `apps/api/src/integrations/http/dto/connection-response.dto.ts:137-138`; `ksef-invoice-detail-section.tsx:80-81`; `ksef-verification.ts:53-55` | 2 (F1) | CONFIRMED (`canViewConfig = role === 'admin' \|\| (isDemoModeEnabled && role === 'viewer')`) | QR-07, ROLE-02 |
| DEF-03 | QR host and path likely wrong: code maps `prod -> ksef.mf.gov.pl`, `demo -> qr-test.ksef.mf.gov.pl` and emits `/invoice/{nip}/{date}/{hash}`; a real eparagony DEMO payload in the repo shows `https://qr-demo.ksef.mf.gov.pl/client-app/invoice/...` (host AND path differ). Prod host likely `qr.ksef.mf.gov.pl` | P0 | `apps/web/src/plugins/ksef/lib/ksef-verification.ts:39-43,114`; `libs/integrations/eparagony/src/infrastructure/adapters/__tests__/eparagony-invoicing.adapter.spec.ts:103` | 1 (B10); 2 (F10); 3 (F8) | CONFIRMED for the divergence (code vs in-repo MF DEMO payload); exact prod host UNVERIFIED until checked against MF QR documentation | QR-01, QR-03, QR-29..32 |
| DEF-04 | Pacer breaks the fiscal lease invariant: `KsefRateLimiter.acquire` loops on `clock.sleep` with no upper bound, once each for open, submit and close inside one provider round-trip (plus NBP walk-back up to 10 x 10 s); `ISSUING_LEASE_MS` is 5 min and assumes a round-trip under `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS` (120 s). An expired lease can be re-claimed and the document submitted twice | P0 | `libs/integrations/ksef/src/infrastructure/http/ksef-rate-limiter.ts:112-137`; `ksef-http-client.ts:209`; `invoice.service.ts:149-170` | 2 (F3); 3 (F2) | CONFIRMED (unbounded loop in code); exploit timing needs the LEASE-08 / LEASE-09 fake-clock test | LEASE-08, LEASE-09, FX-16 |
| DEF-05 | Token bucket admits about 216 session opens in the first rolling hour against a 120/h ceiling: it starts full (`tokens: capacity` = 108) and refills continuously | P1 | `ksef-rate-limiter.ts:143,150-156` | 3 (F3) | CONFIRMED | PACE-10 |
| DEF-06 | Pacer is process-local: api (bulk / manual) and every worker replica (auto-issue, reconcile, offline resubmit) each hold their own 108/h bucket per NIP, so combined traffic can exceed the KSeF ceiling; code comment claims one bucket per deployment | P1 | `ksef-rate-limiter.ts:160-174` | 1 (RL-18); 2 (F7); 3 (F3) | CONFIRMED (module-level singleton) | PACE-19 |
| DEF-07 | Correction FX rate keyed to the wrong date: original uses `saleDate ?? issueDate`, correction uses `correction.originalIssueDate`; auto-issued invoices carry `saleDate` from `placedAt`, so KOR `KursWaluty` / `P_14_xW` use a different NBP rate; docs claim "snapshot-equivalent" | P0 | `libs/integrations/ksef/src/infrastructure/adapters/ksef-invoicing.adapter.ts:456-458`; `order-to-issue-invoice-command.mapper.ts:171-173` | 1 (B2); 2 (F6); 3 (F4) | CONFIRMED | FX-21, FX-22, FX-36, DOC-10 |
| DEF-08 | Correction drops JST / GV flags and buyer e-mail: `buildSnapshotFromRecord` rebuilds `new BuyerProfile(b.name, b.taxId, b.address, b.type)`; KOR emits `JST=2` / `GV=2` against an original with 1; retry rebuild also loses them | P1 | `apps/api/src/invoicing/http/invoicing.controller.ts:1425` | 1 (B3); 2 (F5); 3 (F5) | CONFIRMED | JSTGV-10, JSTGV-11, JSTGV-13 |
| DEF-09 | `buyerOverride` silently ignored by inFakt, eparagony, Subiekt GT and Subiekt nexo, while core persists the override into the correction's `issuedLineSnapshot` / `documentContent` - OL shows a buyer the provider document does not carry | P1 | `invoice.service.ts:1278-1310`; only `ksef-invoicing.adapter.ts` reads `buyerOverride` | 1 (B4); 2 (BO-09); 3 (BOV-12) | CONFIRMED (grep: no other integration reads the field) | BUYOV-15 |
| DEF-10 | Correction fallback idempotency key ignores `buyerOverride`: two keyless corrections differing only in the override collapse; the second returns the first record (e.g. the typo NIP) | P1 | `libs/core/src/invoicing/domain/idempotency/correction-fallback-key.ts:85-95` | 1 (B5); 2 (F13); 3 (F6) | CONFIRMED | BUYOV-16 |
| DEF-11 | Buyer `pl-nip` with separators passes `BuyerTaxIdDto` (strips `[\s-]` for the check) but `toTaxIdentifier` forwards the raw value and the KSeF mapper requires `^\d{10}$` -> `InvalidBuyerIdentificationException` (also classified in-doubt) | P1 | `buyer-tax-id.dto.ts:53`; `invoicing.controller.ts:1388-1392`; `fa3-buyer-id.mapper.ts:79-86` | 1 (B6) | CONFIRMED | NIP-29, NIP-30 |
| DEF-12 | Seller NIP with separators accepted by the config validator (normalised only for the check), stored verbatim, factory only trims: `Podmiot1/NIP` carries dashes (`TNrNIP` violation), rate-limit bucket key and shared-NIP warning compare raw strings | P1 | `ksef-connection-config-shape-validator.adapter.ts:72-86`; `ksef-adapter.factory.ts:86,158`; `connection.service.ts:275-284` | 1 (B6); 2 (F19); 3 (F11) | CONFIRMED | NIP-23, PACE-18, PACE-41 |
| DEF-13 | Checked-in e2e broken: `routing-full-path.spec.ts` F2 submits the eparagony correction without a reason, the form now blocks it, neither race branch fires; `apps/e2e` still types `IssueCorrectionInput.reason` optional | P1 | `apps/e2e/tests/sales-documents/routing-full-path.spec.ts:625-652`; `apps/e2e/src/api/api.types.ts:834`; `eparagony-invoice-correction-flow.tsx:163` | 1 (B7); 2 (F8) | CONFIRMED | CORR-28, CORR-29 |
| DEF-14 | Art. 108g hint and copy button shown on a non-KSeF number: `resolveKsefNumber` falls back to `providerInvoiceNumber` (OL's own P_2) before clearance, labelled "KSeF number" with the bank-transfer-title hint | P1 | `apps/web/src/plugins/ksef/components/ksef-invoice-detail-section.tsx:53-58,197-211` | 1 (B8); 2 (A108-04); 3 (F7) | CONFIRMED | A108G-04, DOC-11 |
| DEF-15 | QR effect has no error path: `void buildKsefVerificationUrl(...).then(...)` with no `.catch`; `crypto.subtle` is undefined outside a secure context, so the QR vanishes with an unhandled rejection on plain-HTTP non-localhost origins | P1 | `ksef-fa3-view.tsx:429-433`; `ksef-verification.ts:86` | 1 (B9); 2 (F9) | CONFIRMED | QR-25, UI-01 |
| DEF-16 | Stale docs after conflict resolution: FA3 notes still describe PrestaShop `order_details` rate inference (dropped; forbidden by ADR-063) and say JST / GV are hard-coded to 2; `ksef-verification.ts` header says "OL never issues offline" | P2 | `libs/integrations/ksef/src/infrastructure/fa3/FA3_IMPLEMENTATION_NOTES.md:83-89,271`; `ksef-verification.ts:9-10` | 1 (B11); 2 (F17); 3 (F17) | CONFIRMED | DOC-04, DOC-05 |
| DEF-17 | Least-privilege 403 not detectable at connection-test time: the tester only runs `handshake.authenticate`, which a token without "wystawianie faktur" passes; the 403 branch has no spec; docs claim detection "at connection-test time and during issuance", and during issuance it surfaces as a timeout (DEF-01) | P1 | `libs/integrations/ksef/src/infrastructure/adapters/ksef-connection-tester.adapter.ts:100-140` | 1 (B12); 2 (F18); 3 (F10) | CONFIRMED (code + no `ksef-connection-tester` spec in the merge); live KSeF behaviour of such a token UNVERIFIED | PERM-02, PERM-03 |
| DEF-18 | Upgrade behaviour change: with strict mode off, any foreign-buyer document with a default-rate line (incl. the shipping fallback `''`) is now refused, also for corrections of pre-merge cross-border invoices; `allowCrossBorder` has no UI (raw JSON / API only), is undocumented, and a string `"true"` is silently ignored | P1 | `ksef-invoicing.adapter.ts:284-289`; `ksef-adapter.factory.ts:223-226`; `order-to-issue-invoice-command.mapper.ts:446` | 1 (B13); 3 (F9) | CONFIRMED (no `allowCrossBorder` in `apps/web`) | XB-11, XB-12, XB-14, XB-15, XB-20 |
| DEF-19 | A KSeF connection whose stored seller NIP fails the checksum can no longer save ANY config change (incl. who-decides preset apply); `seller.nip: ''` now 400. A PATCH without `config` still succeeds | P2 | `connection.service.ts:1189-1195`; `ksef-connection-config-shape-validator.adapter.ts:72-86`; `ksef-connection-config.ts:105` | 1 (B13); 3 (F13) | CONFIRMED | NIP-16, NIP-24, NIP-25, NIP-26 |
| DEF-20 | Dead seams: `InvoiceAnnotations` (P_16, P_17, P_18A, P_23, PMarzy, `exemptionLegalBasis`), `InvoiceLine.gtuCode` / `procedureCode` have no producer; #1580 AC3 (operator flags) and #1586 AC4 not reachable | P1 | grep over `apps/api`, `apps/worker`, `apps/web`, `libs/core` | 1 (G1); 2 (F11); 3 (F16) | CONFIRMED (grep finds no assignment) | ADN-11, ADN-12, GTU-06 |
| DEF-21 | `ConnectionResponseDto.warnings` and `BulkIssueInvoicesResponseDto.total` have no FE consumer; the #1594 warning and progress denominator are API-only | P2 | grep `apps/web/src/features/{connections,invoicing}` | 1 (G1); 3 (F12) | CONFIRMED | PACE-27, PACE-37, UI-08 |
| DEF-22 | Exempt (`zw`) lines emit the placeholder `P_19C='Zwolnienie z podatku VAT'`, which cites no statutory provision and is not operator-editable | P1 | `fa3-xml.types.ts:63`; `fa3-xml.builder.ts:486-491` | 2 (F12); 3 (ADN-11) | CONFIRMED (code); legal adequacy UNVERIFIED | ADN-02, ADN-15 |
| DEF-23 | Buyer-identity correction emits the new buyer as `Podmiot2` and never `Podmiot2K`; the XSD documents that a wrong buyer NIP must instead be corrected to zero values; builder comment "OL never tracks party changes" is stale | P1 | `schemat_fa3_v1-0e.xsd:2966-2968`; `fa3-xml.builder.ts:646-653`; `issue-correction-request.dto.ts:99-104` | 2 (F4) | CONFIRMED (XSD text and builder read) | BUYOV-13 |
| DEF-24 | A pure buyer-only correction is impossible: `lines` needs `ArrayMinSize(1)` and each line a delta (`HasCorrectionDelta`); only workaround is a line with an unchanged quantity | P1 | `issue-correction-request.dto.ts:41-56,186` | 2 (F14); 3 (F6) | CONFIRMED | BUYOV-12, BUYOV-14 |
| DEF-25 | Correction reason has no 256-character cap (XSD `TZnakowy`) in DTO, FE or local validator; longer reasons pass OL and fail at clearance | P1 | `issue-correction-request.dto.ts:172-182`; XSD `:1170-1176,2884` | 2 (F15); 1 (RS-23); 3 (REA-06) | CONFIRMED (no `MaxLength` in the DTO) | CORR-08 |
| DEF-26 | #1596 AC2 (operator flag when an order is cancelled / refunded after its invoice) not implemented; the live-status gate exists only in the `invoicing.issue` worker (manual, bulk and `fiscalization.register` ungated); no block reason written; `refunded` skips the whole invoice even for a partial refund | P2 | `apps/worker/src/sync/handlers/invoicing-issue.handler.ts:113-126` | 1 (G1, LS-13); 2 (F16); 3 (F14) | CONFIRMED (no cancel check in `invoicing.controller.ts`; no `isCancelled` in the fiscalization handler) | GATE-16..18, GATE-20, GATE-21 |
| DEF-27 | Currencies published only in NBP table B cannot be invoiced: 10 x 404 then a misleading "no rate published" | P2 | `nbp-exchange-rate.types.ts:18`; client `:97-125` | 2 (F20); 3 (F18) | CONFIRMED (table A URL only) | FX-13 |
| DEF-28 | Checksum-valid but structurally odd seller NIP (`0000000000`) passes OL; may fail KSeF `TNrNIP` | P2 | `ksef-nip.ts`; `nip-checksum.ts` | 1 (NIP-05); 3 (F11) | UNVERIFIED - needs a KSeF response / XSD pattern check | NIP-05 |
| DEF-29 | FE FA(3) preview (the copy the QR certifies) renders none of the new legal content: `KursWaluty`, `P_14_xW`, `Adnotacje`, GTU | P2 | `ksef-fa3-view.tsx:29` | 3 (F15) | CONFIRMED (header "Skipped by design: Adnotacje"; no `KursWaluty` / `P_14_1W` in the view) | ADN-17, FX-40 |
| DEF-30 | `JST=1` / `GV=1` emitted without a `Podmiot3`; KSeF semantic validation may require Podmiot3 with the matching role | P2 | `fa3-xml.builder.ts:415-416` | 3 (F19) | UNVERIFIED - needs a KSeF TEST submission | JSTGV-08 |
| DEF-31 | Margin-scheme yes-branch still emits `P_12` and VAT bands on lines (contradictory for a VAT-marża invoice); dead seam today | P2 | `fa3-xml.builder.ts:493-496` | 3 (F20) | UNVERIFIED - legal impact; code shows the margin flag only changes `PMarzy` | ADN-16 |
| DEF-32 | Reason now mandatory for all providers at the API (breaking for API clients / MCP / scripts); no `aria-required` / required marker on any of the five textareas; error does not clear while typing | P2 | `issue-correction-request.dto.ts:172-182`; five correction flows | 2 (RSN-10, RSN-25); 3 (F21) | CONFIRMED for the API change; a11y and clearing behaviour UNVERIFIED in a browser | CORR-06, CORR-13, CORR-16 |
| DEF-33 | FX tax point and `P_1` use the UTC calendar day (`toISOString().slice(0,10)`), not Europe/Warsaw; issuance between 00:00 and 01:00 / 02:00 local keys NBP a day early | P2 | `ksef-invoicing.adapter.ts:458,1348-1350` | 2 (FX-26); 3 (F22) | CONFIRMED | FX-20, QR-47 |
| DEF-34 | `exemptionLegalBasis: ''` is forwarded and emits an empty `P_19C` (`??` keeps `''`); the local validator does not catch it | P2 | `fa3-builder-input.mapper.ts:166-168`; `fa3-xml.builder.ts:486-491` | 1 (AN-08); 3 (F16) | CONFIRMED (latent; dead seam) | ADN-09 |
| DEF-35 | Address fold filter `part !== null && part.trim()` TypeErrors on an `undefined` `line2` (legacy snapshot jsonb) | P2 | `fa3-xml.builder.ts:198-200` | 1 (ADR-07) | CONFIRMED in code; reachability UNVERIFIED (producers coerce `?? null`) | ADDR-08 |
| DEF-36 | NBP 200 with a non-JSON body: `response.json()` throws a raw SyntaxError, not wrapped in `KsefExchangeRateException` | P2 | `nbp-exchange-rate.client.ts:108` | 1 (FX-06) | CONFIRMED | FX-09 |
| DEF-37 | Cross-border check calls `line.taxRate.trim()` unguarded; a legacy payload line without `taxRate` TypeErrors and retries to dead | P2 | `ksef-invoicing.adapter.ts:288` | 2 (CB-11) | CONFIRMED in code; likelihood low | XB-08 |
| DEF-38 | `PrzyczynaKorekty` content check is prefix-sensitive (`<ns:PrzyczynaKorekty/>` not caught); builder output is unprefixed | P2 | `fa3-xsd.validator.ts:193,199` | 2 (RSN-08); 3 (REA-11) | CONFIRMED | CORR-24 |
| DEF-39 | KSeF buyer mapper lowercases but does not trim the scheme, so `' pl-nip '` (accepted by the DTO) is treated as a foreign scheme downstream | P2 | `fa3-buyer-id.mapper.ts:137-139` | 1 (NIP-21) | CONFIRMED | NIP-31 |

## 1. GATE - live order-status gate in `invoicing.issue` (#1596, PR #1598, merge adjustment for `cancelledAt` #1984)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| GATE-01 | race e2e | #1596 AC1 | PS order, KSeF connection `config.invoicing.triggerModel` auto-on-paid, worker paused or job delayed; needs PS cancel helper (see prerequisites) | Pay the order so `invoicing.issue` is queued; cancel it in PS (state "Canceled") and re-sync so the snapshot status is `cancelled`; resume the worker | No `InvoiceRecord` created, no KSeF session opened; job `succeeded` with `outcome=business_failure`; warn log names the status / `cancelledAt` with orderId + connectionId only (no PII) | e2e-API | P0 | `invoicing-issue.handler.ts:113-126` | 1 (LS-09); 2 (ST-01); 3 (GATE-01) | - |
| GATE-02 | refunded | #1596 AC1 | Same as GATE-01 but the order snapshot status is `refunded` | Run the job | `business_failure`; `issueInvoice` not called; warn log | unit + e2e-API | P0 | `invoicing-issue.handler.ts:118-121` | 1 (LS-02); 2 (ST-02); 3 (GATE-02) | `invoicing-issue.handler.spec.ts` |
| GATE-03 | cancelled unit | #1596 | Job queued; order snapshot status now `cancelled` | Run the job | `business_failure`; `issueInvoice` not called; warn log | unit | P0 | `invoicing-issue.handler.ts:113-126` | 1 (LS-01) | `invoicing-issue.handler.spec.ts` |
| GATE-04 | cancelledAt | merge (#1984) | `cancelledAt` stamped while `orderSnapshot.status` is still `processing` | Run the job (unit, and integration with a real `order_records` row) | Skipped via `isCancelled`; `business_failure`; log "order is cancelled (cancelledAt set)" | unit + integration | P0 | `invoicing-issue.handler.ts:117-119`; `order-record.entity.ts:563` | 1 (LS-03); 2 (ST-03); 3 (GATE-03) | `invoicing-issue.handler.spec.ts` |
| GATE-05 | eligible | #1596 | Live status `pending` / `processing` / `shipped` / `delivered` | Run the job | Issued normally, `outcome=ok`, post-sale refresh enqueued | unit + e2e-API | P1 | `invoicing-issue.handler.ts:116-133` | 1 (LS-04); 2 (ST-04); 3 (GATE-04) | `invoicing-issue.handler.spec.ts` (processing only) |
| GATE-06 | absent record | #1596 | `getOrderRecord` returns `null` | Run the job | Issues normally (graceful degradation) | unit | P1 | `invoicing-issue.handler.ts:113-117` | 1 (LS-05); 2 (ST-05); 3 (GATE-05) | `invoicing-issue.handler.spec.ts` |
| GATE-07 | unknown status | #1596 | Snapshot status `'archived'`, a number, or absent | Run the job | `status` getter `undefined`, issuance proceeds | unit | P1 | `order-record.entity.ts:660-665` | 1 (LS-06); 2 (ST-06); 3 (GATE-06) | getter in `order-record.entity.spec.ts`; handler path new |
| GATE-08 | read failure | #1596 | `getOrderRecord` throws (DB down) | Run the job; then recover DB and re-run | Wrapped retryable `SyncJobExecutionError`, `issueInvoice` NOT called; succeeds after recovery | unit | P1 | `invoicing-issue.handler.ts:100-113`, catch `:182-193` | 1 (LS-07); 2 (ST-07); 3 (GATE-07) | none - add |
| GATE-09 | lookup key | #1596 | - | Run the job | `getOrderRecord(payload.orderId)` called with the internal id | unit | P2 | `invoicing-issue.handler.ts:113` | 1 (LS-08); 3 (GATE-08) | - |
| GATE-10 | payload first | regression | Cancelled order with invalid payload | Run the job | Payload validation returns `business_failure` first; `getOrderRecord` not called | unit | P2 | `invoicing-issue.handler.ts:95-98` | 2 (ST-08) | - |
| GATE-11 | no refresh when skipped | regression | Gate blocks (cancelled) | Inspect side effects | `postSaleInventoryRefresh.enqueue` NOT called; no `invoice:{id}` idempotency key consumed | unit | P1 | `invoicing-issue.handler.ts:130-136` | 1 (LS-10); 2 (ST-09); 3 (GATE-09) | - |
| GATE-12 | refresh when issued | regression | Issued record (incl. Subiekt, whose document moves stock) | Run the job; re-run on an already-issued record | `invoice:{id}` refresh enqueued exactly once; retry does not re-enqueue | unit + e2e-API | P1 | `invoicing-issue.handler.ts:129-136,190-216` | 1 (RG-10); 2 (REG-08); 3 (GATE-10, REG-12) | pre-existing handler spec |
| GATE-13 | terminal mappings | regression | `OrderAlreadyInvoicedException` / `MissingTaxRateException`; transport error | Run the job | First two still terminal `business_failure`; transport error still retryable | unit | P1 | `invoicing-issue.handler.ts:135-180` | 1 (RG-11); 2 (ST-10); 3 (GATE-11) | pre-existing handler spec |
| GATE-14 | DI boot | #1596 | Worker started with `jobs` role | Boot worker (`invoicing-auto-issue-boot.int-spec.ts`) | Boots; `ORDER_RECORD_SERVICE_TOKEN` resolves for `InvoicingIssueHandler`; `assertFullLaneCoverage` green | integration | P0 | `invoicing-issue.handler.ts:86-87`; `sync-worker.module.ts:185` | 1 (LS-16); 2 (ST-14); 3 (GATE-12) | `invoicing-auto-issue-boot.int-spec.ts` (rerun) |
| GATE-15 | re-delivery after issue | #1596 | Record already `issued`; order cancelled later; job re-delivered | Run the job | `business_failure` returned before `issueInvoice`; no new document; existing record unchanged; refresh skipped. Confirm acceptable vs previous `ok` | unit | P2 | gate precedes issue, `:113-126` | 1 (LS-11); 3 (GATE-16) | - |
| GATE-16 | operator signal | #1596 | GATE-01 done | Open order detail | Nothing explains why no invoice exists (no sales-document block reason written). Record as gap | e2e-UI | P2 | handler returns only | 1 (LS-12); 2 (F16) | - |
| GATE-17 | manual/bulk ungated | #1596 | Cancelled order | `POST /invoices` and `POST /invoices/bulk-issue` | Still issued (gate only in the worker). Product decision required | e2e-API | P1 | `invoicing.controller.ts:372-466,630-700` | 1 (LS-13); 2 (ST-12); 3 (GATE-14) | - |
| GATE-18 | receipts ungated | #1596 | eparagony receipt connection; order cancelled before `fiscalization.register` runs | Run the job | Receipt registered (no gate). Out of scope; document | e2e-API | P2 | `fiscalization-register.handler.ts` | 1 (LS-14); 2 (ST-13); 3 (GATE-14) | - |
| GATE-19 | status getter | #1596 | - | `OrderRecord.status` for each `OrderStatusValues`, missing, `null`, `42`, `'archived'` | The value, or `undefined` | unit | P1 | `order-record.entity.ts:650-665` | 1 (LS-15) | `order-record.entity.spec.ts` |
| GATE-20 | AC2 post-issue flag | #1596 AC2 | Accepted KSeF invoice; order then cancelled | Open invoice and order detail | No "consider a correction" prompt exists - AC2 not implemented | not-testable | P1 | grep - no implementation | 1 (LS-17); 2 (ST-11); 3 (GATE-13) | - |
| GATE-21 | partial refund | #1596 | Partially refunded order whose source maps status to `refunded` | Run the job | Whole invoice skipped - confirm with product | manual-review | P2 | `invoicing-issue.handler.ts:121` | 3 (GATE-15) | - |

## 2. NIP - mod-11 checksum (#1595, PR #1600)

Reference values: valid `1189981779`, `5261040828`, `5252248481`, `1234563218`, `1111111111`; bad check digit `1189981770`; remainder-10 (invalid) `5272514610` and `1234567890`; `0000000000` passes mod-11.

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| NIP-01 | pure fn | #1595 AC2 | - | Valid NIPs through all three copies (FE `isValidNipChecksum`, plugin `nip-checksum`, API DTO) | `true` | unit | P1 | `apps/web/src/plugins/ksef/lib/ksef-nip.ts:31-38`; `nip-checksum.ts`; `buyer-tax-id.dto.ts:30-37` | 1 (NIP-01); 2 (NIP-01); 3 (ref values) | `ksef-nip.test.ts`, `nip-checksum.spec.ts`, `buyer-tax-id.dto.spec.ts` |
| NIP-02 | pure fn | #1595 | - | `1189981770`, `1234567890` | `false` | unit | P1 | same | 1 (NIP-02); 2 (NIP-02) | same |
| NIP-03 | pure fn | #1595 | - | `'12345'`, `'12345678a0'`, `'11899817790'`, `''`, `' 1189981779'`, `PL1189981779` | `false` (pure fn does NOT normalise) | unit | P1 | `ksef-nip.ts:31-38` | 1 (NIP-03); 2 (NIP-04) | `ksef-nip.test.ts` |
| NIP-04 | remainder 10 | #1595 | - | `5272514610` (pure fn and wizard) | `false` / rejected as invalid checksum | unit | P1 | `ksef-nip.ts:35-37` | 1 (NIP-04); 2 (NIP-03); 3 (NIP-05) | `ksef-nip.test.ts` |
| NIP-05 | all-zero | #1595 | - | `0000000000` in pure fn, wizard; then issue on KSeF TEST | OL accepts (mathematically valid); KSeF expected to reject on `TNrNIP` (UNCERTAIN) - record actual and decide | unit + e2e-API + manual-KSeF-portal | P2 | `ksef-nip.ts`; XSD `TNrNIP` | 1 (NIP-05); 3 (NIP-08) | - |
| NIP-06 | parity | #1595 | - | One shared table (about 50 valid and invalid NIPs) through the three copies | Identical verdicts | unit | P2 | three files | 1 (NIP-27); 2 (NIP-05) | none - add |
| NIP-07 | fixtures | #1595 | - | Grep test fixtures for `1234567890` used as a NIP in flows that now validate | None left that would now fail | unit | P2 | PR #1600 note | 1 (NIP-28) | - |
| NIP-08 | e2e constants | #1595 | - | Run suites using `1234563218` (corrections.spec, Subiekt document-kind) | Checksum-valid, suites still pass | e2e-API | P1 | `apps/e2e/tests/invoicing/corrections.spec.ts:53` | 3 (NIP-30) | - |
| NIP-09 | FE wizard | #1595 AC1 | Admin, Connections > New > KSeF | Seller NIP `1189981779` | Accepted; payload `config.seller.nip='1189981779'` | e2e-UI | P1 | `ksef-setup.schema.ts:90-97` | 3 (NIP-01) | `ksef-setup-form.test.tsx` |
| NIP-10 | FE wizard | #1595 AC1 | Same | `11-8998177-9`, `118 998 17 79`, `  1189981779  ` | Accepted, saved as digits `1189981779` | unit + e2e-UI | P1 | `ksef-setup.schema.ts:86-97`; `ksef-nip.ts:12-14` | 1 (NIP-06); 2 (NIP-10); 3 (NIP-02) | `ksef-setup-form.test.tsx` |
| NIP-11 | FE wizard | #1595 AC1 | Same | `1189981770` / `1234567890` | Inline "Seller NIP has an invalid checksum", submit blocked, no API call | e2e-UI | P1 | `ksef-setup.schema.ts:96` | 1 (NIP-07); 2 (NIP-11); 3 (NIP-03) | `ksef-setup-form.test.tsx` |
| NIP-12 | FE wizard | #1595 | Same | `12345`, `123456789`, `11899817790`, `12345678a0` | "Seller NIP must be 10 digits" (format error wins over checksum) | unit | P1 | `ksef-setup.schema.ts:92-95` | 1 (NIP-08); 2 (NIP-12); 3 (NIP-04) | `ksef-setup-form.test.tsx` |
| NIP-13 | FE wizard | #1595 | Same | `118.998.17.79`, `118/998/17/79`, `PL1189981779` | Rejected (only spaces/dashes stripped); check the message is actionable for the `PL` prefix | unit | P2 | `ksef-nip.ts:12` | 3 (NIP-06) | - |
| NIP-14 | FE wizard | #1595 | Same | Leave Seller NIP empty (incremental save) | Allowed; `seller.nip` omitted from the payload | unit | P1 | `ksef-setup.schema.ts:97-98`; `ksef-seller-config.ts:74-81,110` | 1 (NIP-09); 2 (NIP-13); 3 (NIP-07) | `ksef-setup-form.test.tsx` |
| NIP-15 | FE edit | #1595 AC1 | Existing KSeF connection | Edit > change NIP to a bad checksum > save (and NIP-09..14 matrix) | "Seller NIP has an invalid checksum."; no PATCH | unit + e2e-UI | P1 | `ksef-connection-config.ts:99-108` | 1 (NIP-10); 2 (NIP-14); 3 (NIP-09) | - |
| NIP-16 | FE edit legacy | #1595 | Existing connection whose stored NIP fails the checksum (dev seed `1234567890`) | Open edit, change only an unrelated field (e.g. payment), save | Blocked by the NIP refine; message must tell the operator what to fix. Decide whether an upgrade note / migration is needed | e2e-UI | P1 | `ksef-connection-config.ts:105` | 1 (NIP-11); 2 (NIP-15); 3 (NIP-10) | - |
| NIP-17 | FE read-only | #1595 | Operator, viewer, demo mode | Open the KSeF connection edit page | Edit gated as before (read-only form); checksum message not shown to read-only roles | e2e-UI | P2 | - | 2 (NIP-16); 3 (PERM-12) | - |
| NIP-18 | API validator | #1595 AC1 | Admin | `POST /connections` KSeF `seller.nip:'1189981779'` | 201 | e2e-API | P1 | `ksef-connection-config-shape-validator.adapter.ts:72-86` | 3 (NIP-11) | - |
| NIP-19 | API validator | #1595 AC1 | Admin | `seller.nip:'1189981770'` / `'1234567890'` | 400, `{path:'seller.nip', message:'has an invalid checksum'}` | unit + e2e-API | P1 | `...shape-validator.adapter.ts:83` | 1 (NIP-13); 2 (NIP-20); 3 (NIP-12) | `ksef-connection-config-shape-validator.adapter.spec.ts` |
| NIP-20 | API validator | #1595 | Admin | `seller.nip:'12345'` | 400 `must be a 10-digit Polish NIP` | unit | P1 | `:81` | 1 (NIP-14); 3 (NIP-13) | same |
| NIP-21 | API validator | #1595 | Admin | `seller.nip` = number `1189981779`, `null`, `''`, `'   '` | 400 `must be a non-empty string` each (empty string was previously accepted; raw JSON editor can send it) | unit + e2e-API | P1 | `:76-77` | 1 (NIP-15); 2 (NIP-22, NIP-23); 3 (NIP-14, NIP-15) | same (number case) |
| NIP-22 | API validator | #1595 | Admin | `seller: {}`, `seller: null`, `seller: []`, no `seller` | No NIP issue | unit | P2 | `:72-75` | 1 (NIP-16); 2 (NIP-24); 3 (NIP-16) | - |
| NIP-23 | API separators | #1595 | Admin | `seller.nip:'118-998-17-79'` (or `'526-104-08-28'`); then issue an invoice | Accepted (normalised for the check only, stored verbatim); `Podmiot1/NIP` in the source XML carries the dashes (DEF-12). Expected after fix: digits only | unit + e2e-API | P1 | `...shape-validator.adapter.ts:72-84`; `ksef-adapter.factory.ts:158` | 1 (NIP-12); 2 (NIP-21); 3 (NIP-17) | - |
| NIP-24 | API legacy PATCH | #1595 | Connection with a stored checksum-invalid NIP | `PATCH /connections/:id` with only `name` / `status` (no `config`) | 200 - validator runs only when `patch.config` is present. Disagreement: source 1 expected 400; code (`connection.service.ts:1189-1195`) confirms 200 | e2e-API | P1 | `connection.service.ts:1189-1195` | 1 (NIP-17); 2 (NIP-25) | - |
| NIP-25 | API legacy PATCH config | #1595 | Same | `PATCH` any `config` change (e.g. rate-limit edit); also apply a who-decides preset (rewrites config wholesale) | 400 on both. Document as an upgrade note | e2e-API | P0 | `connection.service.ts:1195`; validator `:72-84` | 1 (NIP-17); 2 (NIP-26); 3 (NIP-18) | - |
| NIP-26 | preset partial | #1595 | Several connections, one KSeF connection with an invalid stored NIP | Who-decides preset apply (`AuthorityStatusService`) | That connection fails, others apply; reported as partial (`failedConnectionIds`) | integration | P2 | DEF-19 | 3 (NIP-19) | - |
| NIP-27 | buyer DTO | #1595 AC1 | Admin, issuable order | `POST /invoices` with `buyerTaxId {scheme:'pl-nip', value:'1189981779'}` | Passes validation; issued | unit + e2e-API | P1 | `buyer-tax-id.dto.ts:44-70` | 1 (NIP-18); 3 (NIP-20) | `buyer-tax-id.dto.spec.ts` |
| NIP-28 | buyer DTO | #1595 AC1 | Same | `value:'1189981770'` / `'1234567890'` / `'12345'` | 400, constraint `plNipChecksum`, "value must be a checksum-valid 10-digit Polish NIP when scheme is pl-nip" | unit + e2e-API | P1 | `buyer-tax-id.dto.ts:46-59,70` | 1 (NIP-19); 2 (NIP-30); 3 (NIP-21) | `buyer-tax-id.dto.spec.ts` |
| NIP-29 | buyer DTO | #1595 | - | `value:'11-8998177-9'`, `'526 104 08 28'`, tab/newline inside | DTO accepts (`[\s-]` stripped for the check) | unit | P1 | `buyer-tax-id.dto.ts:52-53` | 2 (NIP-31); 3 (NIP-22) | `buyer-tax-id.dto.spec.ts` |
| NIP-30 | buyer DTO -> KSeF | #1595 | KSeF connection | NIP-29 value end to end | Defect DEF-11: DTO passes, `toTaxIdentifier` forwards the raw value, `resolveBuyerIdentity` throws `InvalidBuyerIdentificationException` ("NIP must be exactly 10 digits"), record failed. Expected: normalise or reject at the DTO | e2e-API | P1 | `invoicing.controller.ts:1388-1392`; `fa3-buyer-id.mapper.ts:79-86` | 1 (NIP-20) | - |
| NIP-31 | buyer scheme | #1595 | - | scheme `'PL-NIP'`, `' pl-nip '` with bad checksum; then `' pl-nip '` with a VALID NIP end to end on KSeF | Checksum enforced (trim + lowercase); but KSeF mapper lowercases without trimming, so `' pl-nip '` is treated as a foreign scheme downstream (DEF-39) | unit | P2 | `buyer-tax-id.dto.ts:48-49`; `fa3-buyer-id.mapper.ts:137-139` | 1 (NIP-21); 2 (NIP-32); 3 (NIP-23) | - |
| NIP-32 | buyer scheme | #1595 | - | `scheme:'eu-vat'`, `'nip'`, `'PL_NIP'` with any value | No checksum applied | unit | P1 | `buyer-tax-id.dto.ts:48-51` | 1 (NIP-22); 2 (NIP-33); 3 (NIP-24) | `buyer-tax-id.dto.spec.ts` |
| NIP-33 | buyer PL prefix | #1595 | - | `scheme:'pl-nip', value:'PL5261040828'` | 400 (prefix not stripped). Decide if it should be accepted | unit | P2 | `buyer-tax-id.dto.ts:52` | 2 (NIP-34) | - |
| NIP-34 | buyer non-string | #1595 | - | `value: 1189981779` (number) with `pl-nip` | Only the `@IsString` error (constraint returns true, no double error) | unit | P2 | `buyer-tax-id.dto.ts:51-52` | 1 (NIP-23); 2 (NIP-35); 3 (NIP-25) | - |
| NIP-35 | buyer empty | #1595 | - | `scheme:''`, `value:''` | `isNotEmpty` errors | unit | P2 | `buyer-tax-id.dto.ts:62-70` | 1 (NIP-24); 3 (NIP-26) | `buyer-tax-id.dto.spec.ts` |
| NIP-36 | override taxId | #1595 / #1582 | Admin | `buyerOverride.taxId {pl-nip, bad checksum}` on `POST /invoices/:id/correct` | 400 nested under `buyerOverride.taxId.value` | unit + e2e-API | P1 | `issue-correction-request.dto.ts:139-147` | 1 (NIP-25); 2 (NIP-36); 3 (NIP-27) | `issue-correction-request.dto.spec.ts` |
| NIP-37 | retry/bulk | #1595 | - | `POST /invoices/retry`, `POST /invoices/bulk-issue` | Unaffected (no `buyerTaxId` field) | unit | P2 | - | 3 (NIP-28) | - |
| NIP-38 | auto path gap | #1595 | Order whose source buyer NIP has a bad checksum (untagged scheme) | Auto-issue to KSeF | Not caught by OL (order-derived NIP never checksum-validated); KSeF rejects at clearance - verify the rejection detail shows (CLR-13). AC1 met only for the API `pl-nip` path | e2e-API + manual-KSeF-portal | P2 | `order-to-issue-invoice-command.mapper.ts:201-233` | 1 (NIP-26); 2 (NIP-37) | - |
| NIP-39 | API breaking | #1595 | API client that previously sent a bad `pl-nip` buyer tax id | `POST /invoices` | Now 400; only API callers affected (FE sends no `buyerTaxId`) - release note | e2e-API | P2 | - | 3 (REG-08) | - |
| NIP-40 | whitelist doc | #1595 AC3 | - | Read setup-guide Limitations | "VAT-payer / biała lista" row states the deliberate deferral | manual-review | P2 | `setup-guide.md` | 1 (DOC-02); 2 (NIP-38); 3 (NIP-29) | - |

## 3. QR - KOD I verification code (#1579, PR #1602)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| QR-01 | host | #1579 | - | `resolveKsefVerificationHost('prod')` | Today `ksef.mf.gov.pl` - pins current behaviour; correct value must come from QR-30 (DEF-03) | unit | P1 | `ksef-verification.ts:39-55` | 1 (QR-01); 3 (QR-07) | `ksef-verification.test.ts` |
| QR-02 | host | #1579 | - | `'test'` | `qr-test.ksef.mf.gov.pl` | unit | P1 | `ksef-verification.ts:41` | 1 (QR-02); 3 (QR-08) | `ksef-verification.test.ts` |
| QR-03 | host | #1579 | - | `'demo'` | Today `qr-test.ksef.mf.gov.pl`; in-repo eparagony DEMO payload uses `qr-demo.ksef.mf.gov.pl` (DEF-03) - fix and re-pin after QR-31 | unit | P1 | `ksef-verification.ts:42`; `eparagony-invoicing.adapter.spec.ts:103` | 1 (QR-02); 2 (QR-07); 3 (QR-09) | - |
| QR-04 | host fallback | #1579 | - | `undefined`, `null`, `''`, `'production'`, `'PROD'` | Test host, never prod (`'PROD'` upper-case falls to test) | unit | P1 | `ksef-verification.ts:53-55` | 1 (QR-03); 2 (QR-09); 3 (QR-10) | `ksef-verification.test.ts` (partial) |
| QR-05 | env threading | #1579 | Connection with no `config.env`, or `config.env` non-string (number) | View FA(3) | `ksefEnvironment` undefined -> test host | unit | P2 | `ksef-invoice-detail-section.tsx:80-81` | 1 (QR-27); 3 (QR-11) | - |
| QR-06 | env threading | #1579 | Prod connection (`config.env='prod'`), admin | View FA(3) | QR URL uses the prod host | unit + e2e-UI | P1 | `ksef-invoice-detail-section.tsx:80-81,303` | 1 (QR-26) | - |
| QR-07 | operator on prod | #1579 | Prod connection, user with role `operator` (or non-demo `viewer`) | View FA(3) of an accepted invoice | Defect DEF-02: `ConnectionResponseDto` returns `config:{}` so env is undefined and the QR points at the test portal. Expected: prod host for every role | unit + e2e-UI | P0 | `connection-response.dto.ts:137-138`; `ksef-verification.ts:53-55` | 2 (QR-05, ROLE-02) | - |
| QR-08 | demo viewer | #1579 | Demo mode on, `viewer` | View FA(3) | Config visible, env-correct host used | e2e-UI | P1 | `connection-response.dto.ts:137` | 2 (QR-06) | - |
| QR-09 | date | #1579 | - | `formatIssueDateForVerification` with `'2026-07-01'`, `'2026-12-31'`, `'2028-02-29'` | `01-07-2026`, `31-12-2026`, `29-02-2028` | unit | P1 | `ksef-verification.ts:60-68` | 1 (QR-04); 2 (QR-10); 3 (QR-12) | `ksef-verification.test.ts` |
| QR-10 | date | #1579 | - | `null`, `''`, `'01-07-2026'`, `'2026/07/01'`, `'2026-7-1'`, `'2026-07-01T00:00:00Z'`, `' 2026-07-01 '` | `null` (QR hidden) for all except the padded one, which trims to `01-07-2026` | unit | P1 | `ksef-verification.ts:63-64` | 1 (QR-05); 2 (QR-11); 3 (QR-13) | - |
| QR-11 | base64url | #1579 | - | bytes `ff ff fe`, `00`, `00 00`, empty; digests whose base64 has `+ / =` | `___-`, `AA`, `AAA`, `''`; URL-safe, no padding | unit | P1 | `ksef-verification.ts:69-77` | 1 (QR-06); 2 (QR-14); 3 (QR-17) | `ksef-verification.test.ts` |
| QR-12 | hash fixture | #1579 | - | `sha256Base64Url('<Faktura>test-fixture</Faktura>')` | `NcIQCHZs-My4vFFE_t-x3y2M2XcBkkftWgYEEJA-Ts0` | unit | P0 | `ksef-verification.ts:84-88` | 1 (QR-07) | `ksef-verification.test.ts` |
| QR-13 | hash UTF-8 | #1579 | - | XML with Polish diacritics (`Łódź`, `zł`) and CRLF line endings | Equals Node `createHash('sha256').update(Buffer.from(s,'utf8'))` base64url - exact bytes, no normalisation | unit | P0 | `ksef-verification.ts:85` | 1 (QR-08); 2 (QR-12) | - |
| QR-14 | hash UTF-8 live | #1579 | KSeF TEST; invoice with diacritics in buyer/line names (`Zażółć gęślą jaźń`) | Issue, clear, scan / compare with backend sha256 of stored bytes | Hash matches the backend and KSeF; MF verification succeeds | e2e-API + manual-KSeF-portal | P0 | `ksef-verification.ts:76-88` | 2 (QR-12); 3 (QR-05) | - |
| QR-15 | BOM | #1579 | Stored source XML | Check whether the builder ever emits a UTF-8 BOM / CRLF | No BOM (`blob.text()` would strip it and silently change the hash) | unit + e2e-API | P1 | `use-ksef-fa3.ts:73-75` | 2 (QR-13); 3 (QR-06) | - |
| QR-16 | URL format | #1579 | - | Full build for prod and test | `https://{host}/invoice/{nip}/{DD-MM-RRRR}/{hash}` | unit | P1 | `ksef-verification.ts:104-115` | 1 (QR-09) | `ksef-verification.test.ts` |
| QR-17 | NIP in URL | #1579 | - | Seller NIP `'123-456-78-90'`, `' 123 456 78 90 '` | Digits only in the path | unit | P2 | `ksef-verification.ts:107-108` | 1 (QR-10); 2 (QR-16); 3 (QR-15) | `ksef-verification.test.ts` |
| QR-18 | null inputs | #1579 | - | Missing NIP / bad date / empty XML | `buildKsefVerificationUrl` returns `null` | unit | P1 | `ksef-verification.ts:109-111` | 1 (QR-11); 2 (QR-15) | `ksef-verification.test.ts` |
| QR-19 | FA3 view | #1579 | Parsed XML with seller NIP + P_1, `environment='test'` | Render `KsefFa3View` | `findByRole('img',{name:/verification QR code/})`; section has "Verification code", KSeF number caption and hint | unit | P1 | `ksef-fa3-view.tsx:418-436,666-690` | 1 (QR-16) | `ksef-fa3-view.test.tsx` |
| QR-20 | FA3 view | #1579 | XML without `Podmiot1/NIP` | Render | No QR section; rest of the preview renders | unit | P1 | same | 1 (QR-17); 2 (QR-15); 3 (QR-16) | `ksef-fa3-view.test.tsx` |
| QR-21 | caption | #1579 | `ksefNumber` prop absent | Render | Caption falls back to parsed `data.ksefNumber`; none -> caption omitted (label + hint only) | unit | P2 | `ksef-fa3-view.tsx:448,472,681` | 1 (QR-18); 3 (QR-21) | - |
| QR-22 | stale promise | #1579 | Switch invoice A -> B, or change `xmlText`/`environment` quickly | Re-render | Stale promise ignored (`cancelled` flag); final QR matches latest props; A's QR never briefly shown for B | unit | P2 | `ksef-fa3-view.tsx:426-436` | 1 (QR-19); 2 (QR-20) | - |
| QR-23 | unmount | #1579 | - | Unmount before the hash resolves | No setState-after-unmount warning, no console error | unit | P2 | `ksef-fa3-view.tsx:430-436` | 2 (QR-21); 3 (QR-22) | - |
| QR-24 | parse error | #1579 | Unparseable XML | Render | View returns null, parent shows "Preview failed"; no QR; parse-error fallback intact | unit | P1 | `ksef-fa3-view.tsx:420,424` | 1 (RG-18 part); 3 (QR-23) | `ksef-fa3-view.test.tsx` |
| QR-25 | secure context | #1579 | Web served over plain HTTP from a non-localhost origin (LAN/VPN staging IP) | Open accepted KSeF invoice > View FA(3) | Defect DEF-15: no QR and an unhandled promise rejection (`crypto.subtle` undefined, no `.catch`). Expected: graceful notice/fallback | e2e-UI | P1 | `ksef-verification.ts:86`; `ksef-fa3-view.tsx:431` | 1 (QR-20); 2 (QR-17) | - |
| QR-26 | e2e render | #1579 AC1/AC2 | KSeF TEST connection, invoice `accepted`, admin | Invoice detail > FA(3) "View" | QR SVG (`role=img`, "KSeF invoice verification QR code"), "Verification code" label, KSeF number caption, hint | e2e-UI | P0 | `ksef-fa3-view.tsx:665-692` | 2 (QR-01); 3 (QR-01) | - |
| QR-27 | decode | #1579 | QR-26 | Decode the QR (jsQR / screenshot decoder) | `https://{host}/invoice/{sellerNIP}/{DD-MM-RRRR}/{b64url(sha256(sourceXml))}` | e2e-UI | P0 | `ksef-verification.ts:105-115` | 2 (QR-02); 3 (QR-02) | - |
| QR-28 | hash triangulation | #1579 | QR-26 | Compare QR hash with sha256 base64url of `GET /invoices/:id/document?kind=source` bytes and with the adapter `invoiceHash` / UPO digest (base64 -> base64url) | All equal | e2e-API + manual-KSeF-portal | P0 | `ksef-invoicing.adapter.ts:1356`; `use-ksef-fa3.ts:73-74` | 1 (QR-22); 2 (QR-03); 3 (QR-04) | - |
| QR-29 | portal verify | #1579 | QR-26 | Scan with a phone / open the decoded URL | MF verification page confirms the invoice (proves host, path, date, hash) | manual-KSeF-portal | P0 | whole chain | 1 (QR-21); 2 (QR-04); 3 (QR-03) | - |
| QR-30 | prod host | #1579 | Official MF KSeF QR-code documentation | Compare `ksef.mf.gov.pl` with the documented prod verification host | Must match before prod use; likely `qr.ksef.mf.gov.pl` (DEF-03, UNCERTAIN) | manual-review | P0 | `ksef-verification.ts:40` | 1 (QR-31); 2 (QR-08); 3 (QR-07) | - |
| QR-31 | demo host | #1579 | `env='demo'` connection | Scan QR on KSeF DEMO | Verify the official demo host; repo evidence points at `qr-demo.ksef.mf.gov.pl` | manual-KSeF-portal | P1 | `ksef-verification.ts:42` | 1 (QR-30); 2 (QR-07); 3 (QR-09) | - |
| QR-32 | path format | #1579 | Official MF docs + in-repo DEMO payload `https://qr-demo.ksef.mf.gov.pl/client-app/invoice/...` | Confirm path (`/invoice/` vs `/client-app/invoice/`), `DD-MM-RRRR`, Base64URL without padding | Code emits `/invoice/...` with no `/client-app/` - likely wrong (DEF-03); fix before ship | manual-review | P0 | `ksef-verification.ts:104-115` | 1 (QR-32); 3 (F8) | - |
| QR-33 | KOR | #1579 | Accepted KOR | View FA(3) of the correction; scan | QR built from the KOR's own XML, NIP, P_1; KOR KSeF number caption; scan verifies | e2e-UI + manual-KSeF-portal | P1 | `ksef-fa3-view.tsx:426-436` | 1 (QR-23); 2 (QR-18); 3 (QR-18) | - |
| QR-34 | gating | #1579 | Invoice `submitted`, `rejected`, `pending-submission` | Open invoice detail | No FA(3) view, no QR (`isAccepted` gate) | unit + e2e-UI | P1 | `ksef-invoice-detail-section.tsx:88-90,253-258` | 1 (QR-24); 2 (QR-19); 3 (QR-19) | `ksef-invoice-detail-section.test.tsx` |
| QR-35 | offline | #1579 | Document issued offline (#1700), later cleared | Detail before and after clearance | Pre-clearance: no QR (KOD II not implemented, documented #3620); post-clearance KOD I renders; docs wording consistent | e2e-UI | P1 | setup-guide KOD II note | 1 (QR-25); 2 (QR-19); 3 (QR-20) | - |
| QR-36 | order panel | #1579 | Order with an accepted KSeF invoice | Order detail > sales-document panel (also mounts `invoiceDetailSection`) | Same QR behaviour as the invoice page | e2e-UI | P2 | `sales-document-panel.tsx:428` | 1 (QR-28) | - |
| QR-37 | dark theme | #1579 | Dark theme | View FA(3) | QR stays black-on-white with a white frame (scannable) | e2e-UI | P2 | `index.css` `.ksef-fa3-view__verification-qr` | 1 (QR-29); 2 (QR-22); 3 (QR-27) | - |
| QR-38 | print | #1579 | - | Browser print of the preview | QR printed and scannable | manual-review | P2 | - | 1 (QR-29); 3 (QR-28) | - |
| QR-39 | mobile | #1579 | Mobile width | View FA(3) | Footer wraps, QR 148 px, no horizontal overflow | e2e-UI | P2 | `index.css` | 2 (QR-23) | - |
| QR-40 | QrCode render | #1579 | - | Render `QrCode` with a value and `ariaLabel` | `<svg role="img" aria-label>`, white `rect`, black `path`, non-empty `d`, viewBox = modules + 8 (quiet zone 4) | unit | P1 | `qr-code.tsx:39,49,66-87` | 1 (QR-12); 2 (QR-24) | `qr-code.test.tsx` |
| QR-41 | QrCode empty | #1579 | - | `value=''` | Renders nothing (`null`) | unit | P2 | `qr-code.tsx:49-51` | 1 (QR-13); 2 (QR-25); 3 (QR-24) | `qr-code.test.tsx` |
| QR-42 | QrCode a11y | #1579 | - | No `ariaLabel` | `role="presentation"`, `aria-hidden` | unit | P2 | `qr-code.tsx:79-81` | 1 (QR-14); 2 (QR-26); 3 (QR-26) | - |
| QR-43 | QrCode capacity | #1579 | - | Longest realistic URL (prod host + NIP + date + 43-char hash) and a 500-char value, EC `M` and `H` | Auto version selection, no throw, scannable | unit | P2 | `qr-code.tsx:52-66` | 1 (QR-15); 2 (QR-27); 3 (QR-25) | - |
| QR-44 | shared/ui export | #1579 | - | `import { QrCode } from shared/ui`; lint, `check:invariants`, type-check | Exported; no barrel cycle or dependency-direction violation | unit | P2 | `shared/ui/index.ts:140-143` | 1 (QR-34); 2 (QR-28); 3 (REG-14) | - |
| QR-45 | dependency | #1579 | Clean checkout | `pnpm install --frozen-lockfile`; web build; Docker web image | `qrcode-generator@1.5.2` resolves from the lockfile; builds pass | integration | P0 | `apps/web/package.json`; `pnpm-lock.yaml` | 1 (QR-33); 2 (QR-29); 3 (QR-30) | - |
| QR-46 | PDF export | #1579 AC1/AC2 | - | Look for a PDF / print export / e-mail of a KSeF invoice | None exists; QR only on screen. AC "PDF/print show QR" not met - confirm scope | manual-review | P1 | `ksef-invoice-detail-section.tsx:256` | 1 (REACH-08); 2 (QR-30); 3 (QR-29) | - |
| QR-47 | UTC date | #1579 | Invoice issued 00:30 Europe/Warsaw | Compare QR date with P_1 and KSeF | P_1 is the UTC day; QR uses P_1, so consistent with KSeF - record behaviour (DEF-33) | e2e-API | P2 | `ksef-invoicing.adapter.ts:1348-1350` | 3 (QR-14) | - |

## 4. ADDR - FA(3) address fold (#1580, PR #1605)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| ADDR-01 | buyer | #1580 AC1 | - | Build with buyer `line1='Main St 5', postalCode='10115', city='Berlin'` | `AdresL1=Main St 5`, `AdresL2=10115 Berlin` | unit | P0 | `fa3-xml.builder.ts:197-213` | 1 (ADR-01) | `fa3-xml.builder.spec.ts` |
| ADDR-02 | seller | #1580 AC1 | - | Seller address | `AdresL2=00-001 Warszawa` | unit | P0 | same | 1 (ADR-02) | `fa3-xml.builder.spec.ts` |
| ADDR-03 | e2e both parties | #1580 AC1 | KSeF connection, synthesized PS order | Issue; fetch source XML (`kind=source`) | `Podmiot1` and `Podmiot2`: `AdresL1` = street (+ `, line2`), `AdresL2 = "{postal} {city}"` | e2e-API | P0 | same | 2 (ADR-01); 3 (ADDR-01) | - |
| ADDR-04 | line2 | #1580 | - | Buyer `line2='Suite 4'` (apartment) | `AdresL1=Main St 5, Suite 4`; `AdresL2` = postcode + city | unit + e2e-API | P1 | `:198-200` | 1 (ADR-03); 2 (ADR-02); 3 (ADDR-02) | `fa3-xml.builder.spec.ts` |
| ADDR-05 | blank line2 | #1580 | - | `line2=''` / `'  '` / `null` | No `, ` suffix (no trailing comma) | unit | P1 | `:199` | 1 (ADR-04); 3 (ADDR-03) | - |
| ADDR-06 | only city | #1580 | - | `postalCode=''`, `city='Kraków'` (foreign buyer without postcode) | `AdresL2=Kraków` (no leading space) | unit | P2 | `:201-204` | 1 (ADR-06); 2 (ADR-03); 3 (ADDR-04) | - |
| ADDR-07 | both empty | #1580 | - | postalCode and city empty, no line2 | `AdresL2` omitted; document still XSD-valid | unit | P2 | `:208-210` | 1 (ADR-05); 2 (ADR-03); 3 (ADDR-05) | - |
| ADDR-08 | undefined line2 | #1580 | Buyer address from a legacy snapshot jsonb where the `line2` key is missing (`undefined`) | Build a KOR from it; check every producer (snapshot round-trip, pre-#1297 rebuild, buyerOverride) | Must not throw: the filter does `part !== null && part.trim()`, so `undefined` TypeErrors (DEF-35). Producers coerce `?? null` - verify none yields `undefined` | unit | P1 | `fa3-xml.builder.ts:198-200`; `order-to-issue-invoice-command.mapper.ts:279`; `invoicing.controller.ts:964` | 1 (ADR-07) | - |
| ADDR-09 | length | #1580 | - | `line1 + line2` over 512 chars combined; or `line1` whitespace-only | Not truncated; local validator misses `TZnakowy512` / minLength; KSeF rejects. Decide | unit | P2 | XSD ~1125 | 1 (ADR-08); 2 (ADR-04) | - |
| ADDR-10 | KSeF accepts | #1580 | KSeF TEST | Issue an invoice with the new fold | Accepted (no XSD / semantic rejection) | e2e-API | P0 | - | 3 (ADDR-07) | - |
| ADDR-11 | portal view | #1580 | KSeF TEST, B2B invoice accepted | Inspect UPO / visualisation in the portal | Both parties show postcode + city | manual-KSeF-portal | P0 | - | 1 (ADR-09); 2 (ADR-05) | - |
| ADDR-12 | FE preview | #1580 | Accepted invoice (new XML) and a pre-merge invoice (old XML, line2 in AdresL2) | View FA(3) | Party block renders both address lines correctly for old and new XML | unit + e2e-UI | P1 | `ksef-fa3-view.tsx:155,393` (PartyBlock) | 1 (ADR-10); 2 (ADR-06); 3 (ADDR-06) | `ksef-fa3-view.test.tsx` |

## 5. JSTGV - JST / GV buyer flags (#1580, PR #1605)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| JSTGV-01 | default | #1580 | - | Build with no flags / flags `false` | `<JST>2</JST><GV>2</GV>` (unchanged default) | unit | P1 | `fa3-xml.builder.ts:415-416` | 1 (JG-01); 2 (JST-04); 3 (ADDR-11) | `fa3-xml.builder.spec.ts` |
| JSTGV-02 | builder flags | #1580 AC2 | - | `buyerIsPublicSectorEntity:true` / `buyerIsVatGroupMember:true` / both | JST=1 / GV=1 / both 1; XSD-valid | unit | P1 | same | 1 (JG-02); 3 (ADDR-10) | `fa3-xml.builder.spec.ts` |
| JSTGV-03 | KSeF mapper | #1580 | - | `cmd.buyer.isPublicSectorEntity=false` | Forwarded as false -> 2 | unit | P2 | `fa3-builder-input.mapper.ts:111-116` | 1 (JG-03) | - |
| JSTGV-04 | core mapper | #1580 | - | `toIssueInvoiceCommand({..., buyerIsPublicSectorEntity:true})` | `BuyerProfile.isPublicSectorEntity === true` | unit | P1 | `order-to-issue-invoice-command.mapper.ts:226-233` | 1 (JG-04) | `order-to-issue-invoice-command.mapper.spec.ts` |
| JSTGV-05 | API JST | #1580 AC2 | Admin, KSeF connection, issuable order | `POST /invoices {orderId, connectionId, buyerIsPublicSectorEntity:true}` | Issued; source XML `JST=1`, `GV=2` | e2e-API | P1 | `issue-invoice-request.dto.ts:54-70`; `invoicing.controller.ts:462-463` | 1 (JG-05); 2 (JST-01); 3 (ADDR-08) | - |
| JSTGV-06 | API GV | #1580 AC2 | Same | `buyerIsVatGroupMember:true` | `JST=2`, `GV=1` | e2e-API | P1 | same | 2 (JST-02); 3 (ADDR-09) | - |
| JSTGV-07 | both live | #1580 | KSeF TEST | Both flags true | `JST=1`, `GV=1`, XSD-valid, accepted | e2e-API + manual-KSeF-portal | P1 | same | 2 (JST-03) | - |
| JSTGV-08 | Podmiot3 | #1580 | KSeF TEST | Submit JST=1 / GV=1 without a `Podmiot3` | Record accept/reject; KSeF semantic validation may require Podmiot3 with the matching role (DEF-30, UNCERTAIN) | manual-KSeF-portal | P1 | `fa3-xml.builder.ts:415-416` | 3 (ADDR-13) | - |
| JSTGV-09 | DTO type | #1580 | - | `buyerIsPublicSectorEntity:"true"` (string) / `1` | 400 `isBoolean` | unit | P2 | `issue-invoice-request.dto.ts:58-70` | 1 (JG-06); 2 (JST-05); 3 (ADDR-12) | - |
| JSTGV-10 | lost on correction | #1580 / #1582 | Invoice issued with JST=1 (post-#1297 snapshot) | `POST /invoices/:id/correct` without `buyerOverride` | Defect DEF-08: KOR emits `JST=2` because `buildSnapshotFromRecord` drops the flag. Expected `JST=1` | unit + e2e-API | P1 | `invoicing.controller.ts:1425` | 1 (JG-07); 2 (JST-07); 3 (BOV-14) | - |
| JSTGV-11 | e-mail lost on correction | #1580 | Invoice with buyer e-mail | Correct; then send the correction by e-mail (provider supporting it) | Snapshot buyer e-mail is null after the re-wrap - verify impact (DEF-08) | integration | P2 | same | 1 (JG-08) | - |
| JSTGV-12 | snapshot persisted | #1580 | JST=1 invoice | Read `invoice_records.issuedLineSnapshot` | Buyer contains `isPublicSectorEntity:true` | integration | P2 | `invoice.service.ts:803-804` | 1 (JG-09) | - |
| JSTGV-13 | retry/bulk | #1580 | Failed or rejected JST invoice | `POST /invoices/retry`, bulk-issue | Re-issued with `JST=2` (flags not threaded / not persisted on retry rebuild) - document | e2e-API | P2 | controller bulk `:650-720`, `retryOne` | 1 (JG-10); 2 (JST-08) | - |
| JSTGV-14 | auto path | #1580 | Auto-issue | Inspect XML | JST/GV = 2 (no source carries the flags; handler BuyerProfile 5-arg) | unit | P2 | `invoicing-issue.handler.ts:342-348` | 1 (JG-11); 2 (JST-06); 3 (ADDR-14) | - |
| JSTGV-15 | override sets flag | #1580 / #1582 | Admin | Correct with `buyerOverride{..., isPublicSectorEntity:true}` | KOR `JST=1` | unit + e2e-API | P2 | `invoicing.controller.ts:958-976` | 1 (JG-12); 2 (BO-05); 3 (BOV-08) | - |
| JSTGV-16 | no FE | #1580 | Any role | Manual issue in the FE | No JST/GV controls - API only | e2e-UI | P2 | web `IssueInvoiceInput` lacks fields | 2 (JST-09) | - |

## 6. ADN - Adnotacje (#1580, PR #1607, ADR-078)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| ADN-01 | default | #1580 AC3 | Plain standard-rate (23%) invoice | Build; issue (e2e) | `P_16..P_18A=2`, `Zwolnienie/P_19N=1`, `P_22N=1`, `P_23=2`, `PMarzy/P_PMarzyN=1`; XSD-valid; byte-identical to main | unit + e2e-API | P0 | `fa3-xml.builder.ts:484-514` | 1 (AN-01); 2 (ADN-01); 3 (ADN-01) | `fa3-xml.builder.spec.ts` |
| ADN-02 | zw line | #1580 AC3 | Line with neutral rate `zw` / `exempt` (shop product, ADR-063) | Build | `<Zwolnienie><P_19>1</P_19><P_19C>Zwolnienie z podatku VAT</P_19C>`; no `P_19N` | unit + e2e-API | P0 | `:486-491`; `fa3-xml.types.ts:63` | 1 (AN-02); 2 (ADN-02); 3 (ADN-02) | `fa3-xml.builder.spec.ts` |
| ADN-03 | oo line | #1580 AC3 | Line `oo` / `reverse-charge` | Build | `P_18=1` | unit + e2e-API | P1 | `:485-486,505` | 1 (AN-03); 2 (ADN-03); 3 (ADN-03) | `fa3-xml.builder.spec.ts` |
| ADN-04 | mixed | #1580 | zw line + 23% line | Build | Zwolnienie yes-branch plus the 23% band | unit | P1 | same | 1 (AN-04) | - |
| ADN-05 | KOR after lines | #1580 | KOR whose AFTER lines have no `zw` while BEFORE did (and vice versa); KOR removing a zw line (qty 0) | Build | Annotations derive from `correctedLines` only; legal check of before/after semantics | unit | P1 | `:600-608` | 1 (AN-05); 2 (ADN-04); 3 (ADN-04) | - |
| ADN-06 | operator flags | ADR-078 | `cashAccounting/selfBilling/splitPayment/triangulation=true` | Build + `validateFa3Xml` | `P_16=1, P_17=1, P_18A=1, P_23=1`; XSD-valid | unit | P2 | `:500-511` | 1 (AN-06); 2 (ADN-06); 3 (ADN-05) | `fa3-xml.builder.spec.ts` |
| ADN-07 | margin | ADR-078 | `marginScheme=true` | Build | `<PMarzy><P_PMarzy>1</P_PMarzy><P_PMarzy_3_1>1</P_PMarzy_3_1></PMarzy>` | unit | P2 | `:493-495` | 1 (AN-07); 3 (ADN-06) | `fa3-xml.builder.spec.ts` |
| ADN-08 | custom basis | ADR-078 | `exemptionLegalBasis:'art. 43 ust. 1 pkt 1'`, no zw line | Build | Exemption yes-branch with that text in `P_19C` | unit | P2 | `:487-490` | 3 (ADN-07) | - |
| ADN-09 | empty basis | ADR-078 | `exemptionLegalBasis:''` | Build + validate | Forwarded verbatim, yes-branch with empty `P_19C` (minLength violation); local validator misses it (DEF-34). Reachable only by code today | unit | P2 | `fa3-builder-input.mapper.ts:166-168,795-797`; builder `:487-490` | 1 (AN-08); 3 (ADN-08) | - |
| ADN-10 | mapper | ADR-078 | `cmd.annotations` absent / `{}` / partial / explicit `false` | Map | Only defined keys forwarded; `false` emits 2; all negative for `{}` | unit | P2 | `fa3-builder-input.mapper.ts:147-200` (`mapAnnotations`) | 1 (AN-09); 2 (ADN-07); 3 (ADN-09) | `fa3-builder-input.mapper.spec.ts` |
| ADN-11 | reachability | #1580 AC3 | - | Grep api/worker/core/web for anything assigning `IssueInvoiceCommand.annotations` | None - operator flags are a dead seam (DEF-20) | not-testable | P1 | grep | 1 (AN-10); 3 (ADN-10) | - |
| ADN-12 | no API field | #1580 | Admin | Try to send `cashAccounting` / `splitPayment` / `marginScheme` / `triangulation` / `selfBilling` / `exemptionLegalBasis` on `POST /invoices` | No DTO field: stripped / 400 by whitelist | e2e-API | P1 | grep | 2 (ADN-05) | - |
| ADN-13 | live zw | #1580 | Shop product with exempt rate, KSeF TEST | Auto-issue | Accepted; visualisation shows exemption annotation with the placeholder basis | e2e-API + manual-KSeF-portal | P1 | - | 1 (AN-11); 2 (ADN-02); 3 (ADN-13) | - |
| ADN-14 | live oo | #1580 | Product rated `oo`, KSeF TEST | Issue | Accepted; `P_18=1` | manual-KSeF-portal | P1 | - | 1 (AN-12); 3 (ADN-13) | - |
| ADN-15 | placeholder legal | #1580 | - | Compliance review of `P_19C='Zwolnienie z podatku VAT'` (no statutory provision, not operator-editable) | Legal sign-off or a configurable basis (DEF-22) | manual-review | P1 | `fa3-xml.types.ts:63` | 2 (ADN-02, F12); 3 (ADN-11) | - |
| ADN-16 | margin legal | ADR-078 | - | Review margin yes-branch: lines still carry `P_12` and VAT bands | Compliance review before exposing the seam (DEF-31) | manual-review | P2 | `fa3-xml.builder.ts:494-496` | 3 (ADN-12) | - |
| ADN-17 | preview | #1580 | `zw` / `oo` invoice | View FA(3) preview | Annotation wording not rendered on the buyer copy (by design, "Skipped: Adnotacje") - record (DEF-29) | e2e-UI | P2 | `ksef-fa3-view.tsx:29` | 3 (ADN-14) | - |

## 7. FX - foreign currency / NBP (#1581, PR #1610, merge adjustment: NBP via the connection transport)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| FX-01 | NBP URL | #1581 | Fake fetch | `resolveRate('EUR','2026-03-11')` (Wednesday) | First GET for `2026-03-10`, `/a/eur/`, `?format=json`; returns `{rate, rateDate, table}` | unit | P1 | `nbp-exchange-rate.client.ts:68-121` | 1 (FX-01); 2 (FX-01) | `nbp-exchange-rate.client.spec.ts` |
| FX-02 | weekend | #1581 | Monday tax point | 404 Sun, 404 Sat, 200 Fri | Friday's rate; 3 calls | unit | P1 | `:97-101` | 1 (FX-02); 2 (FX-02); 3 (FX-13) | `nbp-exchange-rate.client.spec.ts` |
| FX-03 | New Year | #1581 | Tax point `2026-01-02`, only `2025-12-24` published | Resolve | `rateDate 2025-12-24` (9 lookups, within 10) | unit | P1 | `:82-120` | 1 (FX-03); 3 (FX-14) | `nbp-exchange-rate.client.spec.ts` |
| FX-04 | Christmas | #1581 | Tax point `2026-12-28` (Mon) after 24-26 Dec + weekend | Resolve with a real calendar | Walks back to 23 Dec | unit | P1 | same | 2 (FX-03) | none - add |
| FX-05 | other holidays | #1581 | Epiphany (`2026-01-07`), Easter Monday, 1-3 May, Corpus Christi + weekend | Resolve | Correct previous publication day | unit | P2 | same | 2 (FX-04); 3 (FX-15) | - |
| FX-06 | max lookback | #1581 | Rate exactly at day 10 vs day 11; all 404 for 10 days | Resolve with default 10 | Day 10 found; otherwise `KsefExchangeRateException` "No NBP table-A rate ... within 10 day(s)" after exactly 10 requests | unit | P1 | `nbp-exchange-rate.types.ts:27`; client `:83,119-125` | 1 (FX-04); 2 (FX-05); 3 (FX-16) | `nbp-exchange-rate.client.spec.ts` |
| FX-07 | HTTP errors | #1581 | 500 / 503 / 400 / 403 / 429 | Resolve | Immediate `KsefExchangeRateException`, no walk-back, no retry | unit | P1 | `:102-106` | 1 (FX-05); 2 (FX-06); 3 (FX-17) | `nbp-exchange-rate.client.spec.ts` (non-404) |
| FX-08 | malformed body | #1581 | 200 with `rates:[]`, `mid:0`, `mid:-1`, `mid:'abc'`, `mid:'4.3'`, missing `no` / `effectiveDate` | Resolve | Exception for all except string `'4.3'`, which is coerced via `Number()` and accepted | unit | P1 | `:107-147` | 1 (FX-05); 2 (FX-08); 3 (FX-19) | partial |
| FX-09 | non-JSON 200 | #1581 | 200 with an HTML body | Resolve | `response.json()` throws a raw SyntaxError, not wrapped (DEF-36) - verify how core classifies it | unit | P2 | `nbp-exchange-rate.client.ts:108` | 1 (FX-06) | - |
| FX-10 | network/timeout | #1581 | fetch rejects (DNS) / hangs | `createNbpFetch` wrapper | Network `KsefExchangeRateException`; aborts at 10 s; worst case 10 x 10 s total (feeds DEF-04) | unit | P1 | `:89-95,166-180`; types `:30` | 1 (FX-07); 2 (FX-07); 3 (FX-18) | `nbp-exchange-rate.client.spec.ts` (network); timeout - add |
| FX-11 | currency case | #1581 | `'eur'`, `' EUR '`, `''` | Adapter + client | Adapter uppercases for the PLN check, client lowercases the URL; empty -> exception; `resolveKodWaluty` consistent | unit | P2 | adapter `:444-445`; client `:66-72` | 1 (FX-08); 2 (FX-09); 3 (FX-06) | - |
| FX-12 | bad tax point | #1581 | `'2026-02-30'`, `'2026/01/01'`, `''` | Resolve | Exception before any fetch; check `Date.parse('2026-02-30')` roll-over | unit | P2 | `:66-75,150-156` | 2 (FX-10); 3 (FX-20) | - |
| FX-13 | table B | #1581 | Currency only in NBP table B (e.g. AED - verify) | Resolve / issue | 10 x 404 then misleading "no rate published"; invoice fails (DEF-27) - document | unit + e2e-API | P2 | `NBP_TABLE_A_BASE`; `:97-101` | 1 (FX-19); 2 (FX-11); 3 (FX-21) | - |
| FX-14 | transport | merge | KSeF connection with `config.rateLimit` | Issue an EUR invoice; inspect outbound | NBP GET goes through `host.http.forConnection(connection)`, counts against the connection limiter, outbound log tags the connection; NBP 429/503 `Retry-After` slows KSeF calls on that connection | unit + integration | P1 | `ksef-adapter.factory.ts:94-98`; `http-transport-factory.ts:142-160` | 1 (FX-16); 2 (FX-12); 3 (FX-24) | none (no factory spec) |
| FX-15 | limiter vs abort | merge | Connection limiter queue longer than 10 s | Issue EUR | NBP AbortController fires during the limiter wait -> network failure -> issuance fails | unit | P2 | `createNbpFetch` | 2 (FX-13) | - |
| FX-16 | low rate limit | merge | `rateLimit` 1/min, EUR invoice over a long weekend (3+ GETs) | Issue 2 EUR invoices back to back | NBP calls throttled; no deadlock; total time stays under the lease (DEF-04) | integration | P1 | factory `:94-98` | 1 (FX-16); 3 (FX-25) | - |
| FX-17 | no leak | merge / security | - | Inspect outbound NBP request | Absolute `https://api.nbp.pl/...` URL; no Authorization / KSeF token headers | integration | P1 | `nbp-exchange-rate.client.ts:87,167-178` | 1 (FX-17); 2 (FX-14) | - |
| FX-18 | PLN skip | #1581 | Currency `PLN` / `pln` | Issue | No NBP call; no `KursWaluty` / `P_14_xW`; byte-identical | unit + e2e-API | P0 | adapter `:444-451` | 1 (FX-09); 2 (FX-22); 3 (FX-05) | `ksef-invoicing.adapter.spec.ts` |
| FX-19 | tax point sale | #1581 | Invoice with `saleDate` | Issue | NBP keyed to `saleDate - 1` | unit | P1 | adapter `:456-458` | 3 (FX-07) | - |
| FX-20 | tax point issue | #1581 | No `saleDate`; issue at 00:30 Europe/Warsaw | Issue | Keyed to UTC issue date - 1 (consistent with P_1, a day early locally - DEF-33); legal check | unit | P1 | adapter `:458,1348-1350` | 2 (FX-26); 3 (FX-08) | - |
| FX-21 | KOR tax point | #1581 | EUR KOR | Issue correction | Keyed to `correction.originalIssueDate` | unit | P1 | adapter `:457` | 3 (FX-09) | `ksef-invoicing.adapter.spec.ts` |
| FX-22 | KOR rate mismatch | #1581 | EUR invoice auto-issued with `saleDate` 2026-06-20, issued 2026-06-25 | Issue, then correct | Defect DEF-07: original resolved at 06-19, correction at 06-24 (issue date - 1) -> different rate. Expected: correction uses the original's rate | unit + e2e-API | P0 | adapter `:456-458` | 1 (FX-10); 2 (FX-24); 3 (FX-10) | - |
| FX-23 | KOR same day | #1581 | `saleDate` == issue date | Issue + correct | Same rate on both | e2e-API | P1 | same | 1 (FX-11) | - |
| FX-24 | future saleDate | #1581 | `saleDate` in the future | Issue | NBP 404 walks back to the latest available; verify legal intent | unit | P2 | same | 2 (FX-27) | - |
| FX-25 | builder | #1581 AC1/AC5 | EUR with 23/8/5 lines, rate 4.321 | Build + `validateFa3Xml` | `KursWaluty 4.3210` on every `FaWiersz`; `P_14_1W 99.38`, `P_14_2W 34.57`, `P_14_3W 4.32`, each right after its `P_14_x`; XSD-valid | unit | P0 | builder `:159-161,278-283,338-351` | 1 (FX-12); 3 (FX-03, FX-04) | `fa3-xml.builder.spec.ts` |
| FX-26 | KOR builder | #1581 | EUR KOR, rate 4.3210 | Build | `KursWaluty` on `StanPrzed` and after rows; `P_14_xW` = converted difference (e.g. `P_14_1=-23.00`, `P_14_1W=-99.38`); negatives allowed; never `-0.00` | unit | P1 | builder `:446-453,577-589` | 1 (FX-13); 2 (FX-25); 3 (FX-11) | `fa3-xml.builder.spec.ts` |
| FX-27 | e2e live | #1581 AC1/AC5 | PS shop with EUR; order with 23% + 8% items (`currencyId` option); KSeF TEST | Synthesize EUR order, auto-issue | `KodWaluty=EUR`, `KursWaluty` (4 dp) per line, `P_14_xW` per band; accepted; portal shows PLN VAT + rate | e2e-API + manual-KSeF-portal | P0 | builder `:279-283,341-351` | 1 (FX-21); 2 (FX-20); 3 (FX-01) | - |
| FX-28 | rate check | #1581 AC1 | FX-27 | Compare `KursWaluty` with `api.nbp.pl` table A for the expected date | Equal; log line "Resolved NBP rate ..." | e2e-API | P0 | adapter `:456-466`; client `:82-125` | 2 (FX-21); 3 (FX-02) | - |
| FX-29 | NBP down | #1581 | NBP unreachable (block egress to `api.nbp.pl`) | Issue EUR invoice (manual + auto) | Defect DEF-01: record `failed`, `failureMode=in-doubt`, `failureCode=transport-timeout` ("request timed out"); not re-attemptable; blocks other connections; P_2 number consumed; worker job ends `ok` on retry. Expected: terminal `rejected`, re-attemptable once NBP is back | e2e-API + integration | P0 | `invoice.service.ts:762-787,981-984`; adapter `:313` | 1 (FX-14, FC-02); 2 (FX-23); 3 (FX-22) | - |
| FX-30 | manual issue HTTP | #1581 | Same | `POST /invoices` | 422 generic "rejected by the provider (correlationId)" - the actionable NBP message stays in the log | e2e-API | P1 | `invoicing.controller.ts:1590-1601` | 1 (FX-15) | - |
| FX-31 | before session | #1581 | NBP failure | Issue | No `POST /sessions/online` call recorded | unit | P1 | adapter `:313` | 3 (FX-23) | - |
| FX-32 | no resolver | #1581 | Adapter built without resolver (unit path), EUR | Issue | Warn log; no conversion elements (production factory always wires one) | unit | P2 | adapter `:448-455` | 1 (FX-18); 3 (FX-26) | - |
| FX-33 | 0 / zw bands | #1581 | EUR with 0% and `zw` lines | Build + validate | `P_14_xW` only for bands 1-3 (no W for 0 / zw); `validateFa3Xml` passes | unit | P2 | builder `:338-352` | 2 (FX-29) | `fa3-xml.builder.spec.ts` |
| FX-34 | rounding | #1581 | VAT 0.005 EUR x rate; converted VAT edge `x.xx5` | Build | Half-up 2 dp via `money()`, consistent with `P_14_x`; no `-0.00` | unit | P2 | builder `:350` | 1 (FX-20); 3 (FX-31) | - |
| FX-35 | rate format | #1581 | - | `rate(4.3)`, `rate(0.0001)` | `4.3000`; 4 dp, within `TIlosci` | unit | P2 | builder `:159-161` | 3 (FX-30) | - |
| FX-36 | live correction | #1581 | FX-27 accepted | Correct the EUR invoice on KSeF TEST | Accepted; rate shown equals the original (see FX-22) | manual-KSeF-portal | P0 | - | 1 (FX-22) | - |
| FX-37 | KOR of pre-merge | #1581 | EUR invoice issued before the merge (no `KursWaluty`) | Correct it | KOR emits `KursWaluty` / `P_14_xW`; KSeF accepts | e2e-API | P1 | - | 3 (FX-12) | - |
| FX-38 | offline resubmit | #1581 | EUR invoice issued offline | Resubmit later | Persisted XML reused (rate frozen); no new NBP call | integration | P2 | adapter `resubmit` | 1 (FX-23) | - |
| FX-39 | offline + EUR | #1581 | KSeF outage (#1700) + EUR order | Issue during the outage | NBP resolved before the session; offline record XML carries `KursWaluty`; if NBP also down -> issuance fails, no offline document | integration | P1 | adapter `:313` | 2 (FX-28); 3 (FX-27) | - |
| FX-40 | preview | #1581 | EUR invoice | View FA(3) preview | Rate and PLN VAT not shown (view parser not extended) - document (DEF-29) | e2e-UI | P2 | `ksef-fa3-view.tsx` | 2 (FX-30); 3 (FX-29) | - |
| FX-41 | ADR-040 | #1581 | - | Check KSeF adapter does not read the analytics FX stamp (`order_records.exchangeRateId`) | No import of the currency context in the KSeF adapter (grep guard) | unit | P2 | architecture-overview § 18 | 3 (FX-32) | - |

## 8. A108G - Art. 108g KSeF-number surfacing (#1581, PR #1610)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| A108G-01 | render | #1581 AC3 | Accepted invoice | Invoice detail > KSeF number row | `CopyableId` "Copy {number}"; Art. 108g hint under the label | unit + e2e-UI | P1 | `ksef-invoice-detail-section.tsx:192-216` | 1 (ART-01); 2 (A108-01); 3 (A108-01) | `ksef-invoice-detail-section.test.tsx` |
| A108G-02 | copy | #1581 AC3 | Same | Click copy | Clipboard holds the exact 35-char number; toast / feedback | e2e-UI | P1 | `CopyableId` | 1 (ART-01); 2 (A108-02); 3 (A108-02) | - |
| A108G-03 | pending | #1581 | No `clearanceReference` and no `providerInvoiceNumber` | Detail | "Pending"; no hint; no copy button | unit | P2 | `:197-216` | 1 (ART-02); 2 (A108-03); 3 (A108-05) | - |
| A108G-04 | wrong number | #1581 | KSeF invoice `submitted` / offline / `rejected` with `providerInvoiceNumber='FV/2026/10/1'`, no `clearanceReference` | Detail | Defect DEF-14: OL's own document number shown as "KSeF number", copyable, with the bank-transfer-title hint. Expected: "Pending", no hint | unit + e2e-UI | P1 | `:53-58,197-211` (`resolveKsefNumber`) | 1 (ART-04); 2 (A108-04); 3 (A108-04) | - |
| A108G-05 | read roles | #1581 | Viewer / operator / demo | Open detail, click copy | Copy works (read-only action) | e2e-UI | P2 | - | 1 (ART-03); 2 (A108-05); 3 (A108-06, PERM-10) | - |
| A108G-06 | KOR | #1581 | Accepted KOR | Detail | Its own KSeF number copyable | e2e-UI | P2 | - | 1 (ART-05) | - |
| A108G-07 | clipboard denied | #1581 | Non-secure context (plain HTTP) | Click copy | Graceful failure message, no crash | e2e-UI | P2 | `CopyableId` | 2 (UI-07); 3 (A108-03) | - |

## 9. CORR - correction reason (#1582, PR #1627; merge added eparagony and Subiekt GT forms)

Rows whose "Providers" is `ksef, infakt, subiekt-nexo, subiekt-gt, eparagony` run once per provider correction flow (`*-invoice-correction-flow.tsx`) - five executions each.

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| CORR-01 | API missing | #1582 AC1 | Admin, issued invoice | `POST /invoices/:id/correct` without `reason` | 400, property `reason` | unit + e2e-API | P0 | `issue-correction-request.dto.ts:172-182` | 1 (RS-03); 2 (RSN-01); 3 (REA-01) | `issue-correction-request.dto.spec.ts` |
| CORR-02 | API empty | #1582 AC1 | Same | `reason:''` | 400 `isNotEmpty` | unit + e2e-API | P0 | same | 1 (RS-01); 2 (RSN-02); 3 (REA-02) | `issue-correction-request.dto.spec.ts` |
| CORR-03 | API whitespace | #1582 AC1 | Same | `reason:'   '`, `'\t\n'` | 400 (trimmed before validation) | unit + e2e-API | P0 | `:181` | 1 (RS-02); 2 (RSN-02); 3 (REA-03) | `issue-correction-request.dto.spec.ts` |
| CORR-04 | API trim | #1582 AC1 | Same | `reason:'  wrong NIP  '` / `'  Zwrot  '` | 201; command and XML carry the trimmed value | unit + e2e-API | P1 | `:181` | 1 (RS-04); 2 (RSN-03); 3 (REA-04) | `issue-correction-request.dto.spec.ts` |
| CORR-05 | API type | #1582 | Same | `reason: 123` / `null` / `[]` | 400 (`IsString`) | unit | P1 | same | 1 (RS-03); 2 (RSN-04); 3 (REA-05) | - |
| CORR-06 | API breaking | #1582 / merge | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony. Any API client / MCP tool / script that omitted `reason` | Correct without a reason via API | 400 for every provider (shared DTO) - breaking change, release note; check MCP tools, scripts, the e2e api client (DEF-32) | e2e-API | P1 | `issue-correction-request.dto.ts:172-182` | 1 (RS-05); 2 (RSN-10); 3 (REA-25) | - |
| CORR-07 | API forward | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony | Correction via API with a reason | Reason forwarded to each adapter as before (now always non-empty) | e2e-API | P1 | DTO shared | 2 (RSN-09) | - |
| CORR-08 | max length | #1582 | KSeF connection | Reason of 257+ chars (e.g. 4000) via API | Today accepted by OL (no `MaxLength` in DTO, FE or local validator) and rejected at KSeF clearance (`TZnakowy` max 256) - DEF-25. Expected: 400 at OL | unit + e2e-API + manual-KSeF-portal | P1 | DTO `:172-182`; XSD `:1170-1176,2884` | 1 (RS-23); 2 (RSN-05); 3 (REA-06) | - |
| CORR-09 | inner whitespace | #1582 | - | Reason with internal multiple spaces / newlines | KSeF `xsd:token` collapses them; no validator issue | unit | P2 | - | 2 (RSN-06) | - |
| CORR-10 | FE empty | #1582 / merge | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony. Correction dialog open | Fill valid lines, leave reason empty, click "Issue correction" / "Issue KOR" | Inline "A reason for the correction is required." (`role=alert`), textarea `aria-invalid=true`, no POST | unit + e2e-UI | P0 | `ksef-invoice-correction-flow.tsx:147-158,243-249`; `infakt-...:140-155`; `subiekt-nexo/...:101-116`; `subiekt-gt/...:122-137`; `eparagony-...:159-174` | 1 (RS-06, RS-07, RS-08, RS-09, RS-10); 2 (RSN-20); 3 (REA-13, REA-14, REA-15, REA-16, REA-17) | all five `*-invoice-correction-flow.test.tsx` |
| CORR-11 | FE whitespace | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony | Reason `'   '` | Same error; submitted payload never contains whitespace-only | unit | P1 | each flow | 1 (RS-13); 2 (RSN-21); 3 (REA-19) | - |
| CORR-12 | FE error order | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony | Invalid line AND empty reason | Line error shown first; reason error only after lines are valid | unit | P2 | each flow | 1 (RS-11); 2 (RSN-22); 3 (REA-18) | - |
| CORR-13 | FE error clears | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony. After CORR-10 | Type a reason; then resubmit | Error stays while typing (does not clear on input - UX check, DEF-32); on resubmit it disappears and the POST carries the trimmed reason | unit + e2e-UI | P1 | each flow | 1 (RS-12); 2 (RSN-23); 3 (REA-20) | - |
| CORR-14 | FE submitting | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony. Mutation pending | - | Textarea and fields disabled; no double submit | unit | P2 | `disabled={isSubmitting}` | 1 (RS-15); 2 (RSN-24); 3 (REA-22) | pre-existing |
| CORR-15 | FE grid path | #1582 / #3090 | Providers: ksef, infakt, subiekt-gt, eparagony (grid where `linesAreAuthoritative`); subiekt-nexo manual rows | Invoice with authoritative content (`CorrectionLineGrid`), empty reason | Same block; grid lines submitted once the reason is filled | unit + e2e-UI | P1 | each flow grid branch (`gridLines`) | 1 (RS-14); 2 (RSN-26); 3 (REA-23) | - |
| CORR-16 | FE a11y | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony | Inspect label / textarea (axe) | No required marker, no `aria-required`, error not linked via `aria-describedby` (DEF-32) | e2e-UI | P2 | `ksef-invoice-correction-flow.tsx:7,228-249` (labels ~184-238) | 2 (RSN-25); 3 (REA-21) | - |
| CORR-17 | returns panel | #1582 / #2382 | Return detail with a correction-proposal panel (`suggestedLines`) | Open the provider flow from the panel and submit | Reason not prefilled; operator must type one; submit then works | e2e-UI | P1 | `correction-proposal-panel.tsx:147` | 2 (RSN-27); 3 (REA-24) | - |
| CORR-18 | FE type | #1582 | - | `IssueCorrectionInput.reason` now required; `pnpm type-check` (`tsc -b`) across callers | Compiles | integration | P1 | `invoicing.types.ts:299-304` | 1 (RG-25); 2 (RSN-30) | - |
| CORR-19 | mutation hook | #1582 | - | `use-issue-correction-mutation` tests | Pass with a reason | unit | P2 | hook | 1 (RG-26) | `use-issue-correction-mutation.test.tsx` |
| CORR-20 | builder omit | #1582 AC2 | Builder input `reason ''` / `'  '` | Build KOR | `PrzyczynaKorekty` omitted | unit | P1 | `fa3-xml.builder.ts:614-621` | 1 (RS-17); 2 (RSN-07); 3 (REA-07) | `fa3-xml.builder.spec.ts` |
| CORR-21 | builder trim | #1582 | `'  wrong NIP  '` | Build | `<PrzyczynaKorekty>wrong NIP</PrzyczynaKorekty>` | unit | P1 | same | 1 (RS-18); 3 (REA-08) | - |
| CORR-22 | builder escape | #1582 | Reason with `<&>"`, Polish chars, emoji | Build + validate; issue on KSeF TEST | Escaped, XSD-valid, KSeF accepts | unit + e2e-API | P1 | same | 1 (RS-19); 3 (REA-09) | - |
| CORR-23 | validator empty | #1582 AC2 | XML with `<PrzyczynaKorekty></PrzyczynaKorekty>`, `<PrzyczynaKorekty/>`, `<PrzyczynaKorekty />`, whitespace body | `validateFa3Xml` | `Fa3XsdValidationException`, path `/Faktura/Fa/PrzyczynaKorekty` | unit | P1 | `fa3-xsd.validator.ts:187-206` | 1 (RS-20, RS-21); 2 (RSN-08); 3 (REA-10) | `fa3-xsd.validator.spec.ts` |
| CORR-24 | validator prefix | #1582 | Namespaced `<ns:PrzyczynaKorekty/>` | Validate | Not matched (regex prefix-sensitive, DEF-38); builder output is unprefixed - record | unit | P2 | `fa3-xsd.validator.ts:193,199` | 2 (RSN-08); 3 (REA-11) | - |
| CORR-25 | validator ok | #1582 | Non-empty reason | Validate | Passes | unit | P2 | same | 1 (RS-22); 3 (REA-12) | `fa3-xsd.validator.spec.ts` |
| CORR-26 | live | #1582 | KSeF TEST | Issue a KOR with a reason | Accepted; visualisation shows the reason | manual-KSeF-portal | P0 | - | 1 (RS-24) | - |
| CORR-27 | fallback key trim | #1582 / #3365 | Keyless API calls | Two corrections with same lines, reasons `'a'` and `' a '` | Trimmed by the DTO -> same fallback key -> second dedupes | unit | P2 | `correction-fallback-key.ts:85-95` | 1 (RS-25); 3 (REA-26) | - |
| CORR-28 | e2e F2 | #1582 / merge | eparagony sandbox | Run `apps/e2e/tests/sales-documents/routing-full-path.spec.ts` F2 | Defect DEF-13: fails today (no reason filled; dialog stays open with inline error, neither race branch fires). After filling the reason in the test: passes | e2e-UI | P0 | `routing-full-path.spec.ts:625-652` | 1 (RG-30); 2 (RSN-28, F8) | - |
| CORR-29 | e2e api types | #1582 | - | Make `IssueCorrectionInput.reason` required in `apps/e2e/src/api/api.types.ts:834`; type-check | Type-check flags every caller that omits a reason | unit | P1 | `apps/e2e/src/api/api.types.ts:834` | 1 (RG-31) | - |

## 10. CLR - clearance (rejection) detail `clearanceDetail` (#1582, PR #1627)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| CLR-01 | format full | #1582 AC3 | Status read `code 440`, description, `details[]` | `getClearanceStatus` | `rejected`, `clearanceDetail='KSeF status 440: <desc>; <d1>; <d2>'` | unit | P0 | `ksef-invoicing.adapter.ts:1012-1022,1085-1102` | 1 (CD-01); 3 (RJD-03) | `ksef-invoicing.adapter.spec.ts` |
| CLR-02 | format partial | #1582 | Description only / details only / neither | Read | `KSeF status 440: desc` / `KSeF status 440: d1; d2` / `KSeF status 440` | unit | P1 | same | 1 (CD-02); 2 (CD-04); 3 (RJD-03) | - |
| CLR-03 | format filter | #1582 | `details` with non-strings, blanks, whitespace | Read | Only trimmed non-empty strings joined | unit | P2 | same | 1 (CD-03); 2 (CD-04); 3 (RJD-04) | - |
| CLR-04 | truncation | #1582 | Composed detail of 499 / 500 / 501 / 5000 chars | Read | <=500 verbatim; >500 -> first 497 + `...` (total 500) | unit | P1 | `:177,1098-1101` | 1 (CD-04); 2 (CD-03); 3 (RJD-05) | none - add |
| CLR-05 | submitted | #1582 | Status 150 | Read / reconcile | `clearanceDetail` null; patch key omitted | unit | P1 | `:1016-1021`; reconcile `:217-224` | 1 (CD-05); 2 (CD-05); 3 (RJD-06) | `regulatory-status-reconciliation.service.spec.ts` |
| CLR-06 | accepted | #1582 | Status 200 | Read | `buildClearedStatus` - no detail key | unit | P2 | `:1024` | 1 (CD-06); 2 (CD-06); 3 (RJD-06) | - |
| CLR-07 | reconcile write | #1582 | Record `submitted`, read returns rejected with detail | Reconcile sweep | Patch contains `clearanceDetail` | unit + integration | P0 | `regulatory-status-reconciliation.service.ts:222-224` | 1 (CD-07) | `regulatory-status-reconciliation.service.spec.ts` |
| CLR-08 | reconcile no rewrite | #1582 | Read with the same detail as stored, null detail, or an unrelated accepted read | Reconcile | Key omitted; existing detail untouched | unit | P2 | same `:221` | 1 (CD-08); 2 (CD-07); 3 (RJD-07, RJD-08) | - |
| CLR-09 | apply | #1582 | - | `applyRegulatoryClearance` with detail / without | Persists detail / writes explicit `null` | unit | P1 | `invoice.service.ts:1482-1498` | 1 (CD-09) | `invoice.service.spec.ts` |
| CLR-10 | resend clears | #1582 | inFakt rejected invoice with stored detail | `POST /invoices/:id/resend-to-ksef` | Detail cleared to null; UI row disappears | integration + e2e-API | P1 | controller `:1041-1094,1086` | 1 (CD-10); 2 (CD-08); 3 (RJD-09) | `invoice.service.spec.ts` (apply) |
| CLR-11 | resend re-rejected | #1582 | Resend result itself rejected with a new detail | Reconcile | New detail persisted | unit | P2 | - | 3 (RJD-10) | - |
| CLR-12 | KSeF resend | #1582 | KSeF rejected invoice | `resend-to-ksef` | 501 (KSeF has no `RegulatoryResubmitter`) - "cleared on resend" unreachable for KSeF | e2e-API | P2 | controller `:1062-1066` | 1 (CD-11) | - |
| CLR-13 | e2e persisted | #1582 AC3 | KSeF TEST; invoice KSeF will reject (semantic error accepted locally, or a fake status 440) | Issue; run `invoicing.regulatoryStatus.reconcile` | `regulatoryStatus=rejected`, `clearanceDetail="KSeF status {code}: {description}; {details}"` persisted | e2e-API | P0 | adapter `:1011-1022,1085-1102` | 2 (CD-01); 3 (RJD-01) | - |
| CLR-14 | live portal | #1582 | KSeF TEST | Force a rejection (invalid untagged buyer NIP, wrong P_ amounts), wait for reconcile | Detail visible on the invoice page and matches the portal message | manual-KSeF-portal | P0 | - | 1 (CD-22) | - |
| CLR-15 | FE row | #1582 AC3 | Rejected + detail; admin, operator, viewer | Invoice detail | "Rejection detail" row, hint "Reported by the authority (KSeF)", `role=status`, `text-danger` | unit + e2e-UI | P1 | `ksef-invoice-detail-section.tsx:173-190` | 1 (CD-19); 2 (CD-02); 3 (RJD-02) | `ksef-invoice-detail-section.test.tsx` |
| CLR-16 | FE row hidden | #1582 | Not rejected; rejected with null / `''` detail (old record); accepted with a stale detail | Detail | No row | unit | P2 | `:175` | 1 (CD-20); 2 (CD-11); 3 (RJD-11, RJD-12) | `ksef-invoice-detail-section.test.tsx` |
| CLR-17 | long text | #1582 | 500-char detail | Render at mobile width | Wraps; no horizontal overflow | manual-review | P2 | - | 1 (CD-21) | - |
| CLR-18 | DTO | #1582 | - | `GET /invoices/:id`, `GET /invoices` list, `GET /orders/:orderId/invoice` | `clearanceDetail` key always present (string or null); list projection without N+1 | e2e-API | P1 | `invoice-record-response.dto.ts:92-99,194`; controller `:1628` | 1 (CD-18, RG-27); 2 (CD-09); 3 (RJD-13) | - |
| CLR-19 | repo round trip | #1582 | - | Save via `updateOutcome`; `findById` | `InvoiceRecord.clearanceDetail` populated (`toDomain` maps the column) | integration | P1 | `invoice-record.repository.ts:669` | 1 (CD-17); 3 (RJD-15) | - |
| CLR-20 | PII | #1582 | KSeF message that echoes a buyer NIP | Inspect stored detail; view as viewer | Only KSeF status text; decide acceptability of showing it to the viewer role (privacy review) | manual-review | P2 | adapter comment | 1 (CD-23); 2 (CD-10); 3 (RJD-14, PERM-11) | - |
| CLR-21 | offline resubmit | #1582 | Rejection surfaced via the offline resubmission (#1701) path | Resubmit | Record whether the detail is captured (only `getClearanceStatus` populates it) | integration | P2 | - | 3 (RJD-16) | - |
| CLR-22 | other providers | #1582 | inFakt `RegulatoryStatusReader` rejected read | Reconcile | No detail (adapter unchanged); row absent; no crash | unit | P2 | - | 3 (RJD-17) | - |
| CLR-23 | FE types | #1582 | - | `clearanceDetail?` optional in the FE type while the API always returns the key; fixtures without the key | Type-check (`tsc -b`) passes | unit | P2 | `invoicing.types.ts:106-110` | 3 (RJD-18) | - |

## 11. MIG - migration `1937370002000-add-invoice-clearance-detail` (renumbered from the branch's `1818000000008`)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| MIG-01 | fresh run | merge | Fresh DB | `pnpm --filter @openlinker/api migration:run` | `AddInvoiceClearanceDetail1937370002000` applied; `invoice_records.clearanceDetail text NULL` | integration | P0 | `1937370002000-add-invoice-clearance-detail.ts:23-27` | 1 (CD-12); 2 (MIG-01); 3 (MIG-01) | - |
| MIG-02 | show | merge | DB at main head | `migration:show` | Only `1937370002000` pending; main's `1818000000008-add-email-confirmation-tokens` unaffected; after run, no pending | integration | P0 | `apps/api/src/migrations/` | 1 (CD-16); 2 (MIG-02); 3 (MIG-02) | - |
| MIG-03 | branch DB | merge | DB that ran the epic branch (row `AddInvoiceClearanceDetail1818000000008` exists, column present) | `migration:run` / `show` | `1921` runs as a no-op (`ADD COLUMN IF NOT EXISTS`) and is recorded; stale migrations-table row does not break run/show | integration | P1 | same `:23-27` | 1 (CD-13); 2 (MIG-03); 3 (MIG-03) | - |
| MIG-04 | timestamp collision | merge | Same branch DB | Check whether main's `AddEmailConfirmationTokens1818000000008` was applied on that DB | UNCERTAIN: TypeORM may treat the `1818000000008` timestamp as already applied and skip the email-tokens migration - must be verified per environment (see Environment checks) | integration | P1 | `apps/api/src/migrations/1818000000008-add-email-confirmation-tokens.ts` | 1 (CD-15); 2 (MIG-03) | - |
| MIG-05 | revert | merge | After up | `migration:revert`, then `run` again (twice) | Column dropped (`DROP COLUMN IF EXISTS`) and re-added; idempotent | integration | P1 | `:29-33` | 1 (CD-14); 2 (MIG-04); 3 (MIG-04) | - |
| MIG-06 | existing rows | merge | Existing invoice rows | Run migration; `GET /invoices/:id` | `clearanceDetail` NULL; API returns `null` | integration | P1 | - | 3 (MIG-05) | - |
| MIG-07 | entity parity | merge | Integration harness | Compare `synchronize`-built schema with the migration | Nullable `text` column identical | integration | P1 | `invoice-record.orm-entity.ts:108-115` | 1 (CD-16); 2 (MIG-05); 3 (MIG-06) | - |
| MIG-08 | prefix check | merge | - | Run the migration-prefix collision check (HEAD commits `e156ddd..`) | No duplicate timestamp prefixes | unit | P1 | scripts | 3 (MIG-07) | - |

## 12. BUYOV - buyer override on correction (#1582, PR #1627)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| BUYOV-01 | DTO valid | #1582 AC4 | - | Well-formed `buyerOverride` | Valid | unit | P1 | `issue-correction-request.dto.ts:106-171` | 1 (BO-01) | `issue-correction-request.dto.spec.ts` |
| BUYOV-02 | DTO invalid | #1582 | - | Missing `address`; `type:'x'`; empty `name`; empty / missing `city`, `postalCode`, `countryIso2`, `line1` | 400 under `buyerOverride` | unit + e2e-API | P1 | `:107-131,149-158` | 1 (BO-02); 2 (BO-04); 3 (BOV-05, BOV-06) | `issue-correction-request.dto.spec.ts` (partial) |
| BUYOV-03 | DTO line2 | #1582 | - | `address.line2:null` / omitted | Valid; controller maps to `null` | unit | P2 | `:117-120`; controller `:964` | 1 (BO-03); 2 (BO-04) | - |
| BUYOV-04 | DTO cross-field | #1582 | - | `taxId` omitted with `type:'company'` | Valid (no cross-field check) - decide | unit | P2 | `:139-146` | 1 (BO-04) | - |
| BUYOV-05 | B2C override | #1582 | KSeF | Override `type:'private'`, no `taxId` | Accepted; KOR `Podmiot2` without NIP (`BrakID` / private branch) | unit + e2e-API | P1 | `fa3-buyer-id.mapper.ts` (`resolveBuyerIdentity`) | 2 (BO-03); 3 (BOV-07) | - |
| BUYOV-06 | controller | #1582 | Admin | Correct with an override | `BuyerProfile` built from the override; `email:null` | unit + integration | P1 | `invoicing.controller.ts:958-976` | 1 (BO-05) | - |
| BUYOV-07 | KSeF Podmiot2 | #1582 AC4 | KSeF | KOR with override (unit) | `Podmiot2` = override name / NIP / address | unit | P0 | `ksef-invoicing.adapter.ts:861-869` | 1 (BO-06); 2 (BO-01); 3 (BOV-01) | `ksef-invoicing.adapter.spec.ts` |
| BUYOV-08 | KSeF e2e | #1582 AC4 | Accepted KSeF invoice | `POST /invoices/:id/correct` with reason, one changed line, `buyerOverride{name, taxId pl-nip valid, address, type:'company'}` | KOR XML `Podmiot2` = override; KSeF accepts | e2e-API | P0 | adapter `:861`; controller `:955-976` | 2 (BO-01); 3 (BOV-01) | - |
| BUYOV-09 | snapshot | #1582 | After issuance of BUYOV-07 | Read the correction record | `issuedLineSnapshot.buyer` = override; `documentContent` buyer = override | unit | P1 | `invoice.service.ts:1278-1311` | 1 (BO-07) | `invoice.service.spec.ts` |
| BUYOV-10 | correction of correction | #1582 | KOR #1 issued with an override | Correct KOR #1 again without override | KOR #2 diffs against and carries the override buyer from KOR #1's snapshot | unit + e2e-API | P1 | controller `:918,1425`; service `:1278-1300` | 1 (BO-08); 2 (BO-08); 3 (BOV-03) | `invoice.service.spec.ts` |
| BUYOV-11 | no original document | #1582 | Correction with override but no resolvable `originalDocument` | Correct | Snapshot null; no crash | unit | P2 | `invoice.service.ts:1289-1295` | 3 (BOV-04) | - |
| BUYOV-12 | buyer-only | #1582 AC4 | Wrong NIP on the original | Send `lines:[]` / a line without quantity or price + override; then the workaround: one line with `newQuantity` = original quantity | First: 400 (`ArrayMinSize` / `HasCorrectionDelta`); workaround accepted -> KOR with unchanged amounts and the new buyer. A pure buyer correction is impossible (DEF-24); document | e2e-API | P1 | DTO `:40-56,183-189` | 1 (BO-09); 2 (BO-06); 3 (BOV-02) | - |
| BUYOV-13 | legal Podmiot2K | #1582 | KSeF TEST | BUYOV-08 flow; check clearance and legal correctness | Record whether KSeF accepts it. Per XSD a wrong buyer NIP may not be corrected this way (requires a zero-value correction); `Podmiot2K` (original buyer) is never emitted; builder comment is stale (DEF-23) | manual-KSeF-portal + manual-review | P1 | XSD `:2966-2968`; `fa3-xml.builder.ts:646-653` | 2 (BO-02) | - |
| BUYOV-14 | live zero-diff KOR | #1582 | KSeF TEST | BUYOV-12 workaround on KSeF TEST | Record whether KSeF accepts a KOR changing only `Podmiot2` (zero difference) | manual-KSeF-portal | P0 | - | 1 (BO-17); 3 (BOV-02) | - |
| BUYOV-15 | other providers | #1582 | Providers: infakt, subiekt-gt, subiekt-nexo, eparagony (ksef honours it - BUYOV-07) | Correct with `buyerOverride` | Defect DEF-09: the provider document keeps the original buyer while OL's snapshot / `documentContent` record the override. Expected: honoured or refused, never silently ignored | unit + e2e-API | P1 | `invoice.service.ts:1278-1310`; grep `buyerOverride libs/integrations` -> ksef only | 1 (BO-10, BO-11, BO-12, BO-13); 2 (BO-09); 3 (BOV-12) | - |
| BUYOV-16 | fallback key | #1582 / #3365 | Keyless API | Correction A (override NIP X), then identical correction B (override NIP Y) | Defect DEF-10: B returns record A (fallback key ignores `buyerOverride`). Expected: distinct or refused | unit + e2e-API | P1 | `correction-fallback-key.ts:85-95` | 1 (BO-14); 2 (BO-07); 3 (BOV-11) | - |
| BUYOV-17 | cross-border override | #1582 / #1586 | Domestic original | Override with `countryIso2:'DE'` (or lowercase `'de'`) and default-rate lines | Normalised by the KSeF mapper; guard uses the override country and refuses (DEF-01 classification applies) | unit + e2e-API | P1 | adapter `:284-288,861` | 1 (BO-15); 3 (BOV-09, XB-11) | - |
| BUYOV-18 | no FE | #1582 | Any role | Open the correction dialogs | No buyer-override UI exists - API only | e2e-UI | P1 | flows send no `buyerOverride`; `invoicing.types.ts:278-303` | 1 (BO-16); 2 (BO-10); 3 (BOV-13) | - |
| BUYOV-19 | e-mail | #1582 | Correction issued with an override | `send-email` after the correction | Override sets e-mail `null`, so the correction has no buyer address - verify expected behaviour | unit + e2e-API | P2 | controller `:969-971` | 2 (BO-11); 3 (BOV-10) | - |
| BUYOV-20 | preview | #1582 | Accepted KOR with override | View FA(3) | Party block shows the corrected buyer | e2e-UI | P2 | - | 3 (BOV-15) | - |

## 13. LEASE - correction single-flight / CAS lease (#1582 item 4, superseded by main #3365) and the fiscal lease vs pacing

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| LEASE-01 | rename | merge | Adapter lacking `CorrectionIssuer`; adapter throw; success | Correct | `recordId` (renamed from `pending.id`) is the row updated on failure / rejected / outcome, including the resume path where the pending record is the claimed existing one; unsupported -> 422 | unit | P0 | `invoice.service.ts:1208-1266,1320` | 1 (CAS-01); 2 (CAS-02); 3 (CAS-03, CAS-04) | `invoice.service.spec.ts` |
| LEASE-02 | resume issued | #3365 | Same-key replay after an issued correction | Correct twice | 201 with the same record; one provider call | unit + e2e-API | P1 | `invoice.service.ts:1122-1152`; controller `:984-998` | 1 (CAS-02); 2 (CAS-03) | - |
| LEASE-03 | same key concurrent | #3365 | Explicit same idempotency key | Parallel POSTs | One provider call; the other 409 `CORRECTION_IN_PROGRESS` | integration | P1 | `:1183-1199` | 1 (CAS-03); 3 (CAS-02) | - |
| LEASE-04 | in-doubt replay | #3365 | Failed in-doubt correction | Retry with the same key | 409 `CORRECTION_NEEDS_RECONCILIATION`; no provider call | integration | P1 | `:1166-1172` | 1 (CAS-04) | - |
| LEASE-05 | keyless concurrent | #3365 | Keyless | Two concurrent identical keyless POSTs | Exactly one provider call; second returns the existing record or a contended 409 (fallback key + `claimForIssue`) | integration | P0 | `:1111-1215` | 1 (CAS-05); 2 (CAS-01); 3 (CAS-01) | main suites (rerun) |
| LEASE-06 | FE double click | - | KSeF dialog | Double-click submit; resubmit after an error | Same `idempotencyKeyRef`; one correction | unit + e2e-UI | P2 | flows `idempotencyKeyRef` | 1 (CAS-06); 3 (REA-22) | - |
| LEASE-07 | branch CAS | superseded | - | Look for PR #1627's own CAS code | Not in tree (main's #3365 kept) - nothing to test | not-testable | P2 | merge commit message | 3 (CAS-05) | - |
| LEASE-08 | pacer vs lease | #1594 / merge | Drained session-open bucket; 10 concurrent issuances of different orders on one NIP (fake clock) | Measure the wait inside one `issueInvoice` (open + submit + close each paced, plus NBP walk-back up to 10 x 10 s) | Defect DEF-04: must stay under `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS` (120 s) and well under `ISSUING_LEASE_MS` (5 min). Likely FAILS - `KsefRateLimiter.acquire` sleeps unbounded | integration | P0 | `ksef-rate-limiter.ts:112-137`; `ksef-http-client.ts:209`; `invoice.service.ts:149-170` | 2 (RL-10); 3 (RL-08) | - |
| LEASE-09 | double submit | #1594 / merge | LEASE-08 with a lease that expired while parked | `POST /invoices/retry` or stuck-job requeue of that record | No second provider call, no duplicate document. Expected to fail today (CAS re-claim after expiry) | integration | P0 | `invoice.service.ts:149-170,709` | 2 (RL-11); 3 (RL-08) | - |

## 14. XB - cross-border guard (#1586, PR #1611; merge narrowed it to "a line relies on the connection default rate")

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| XB-01 | domestic | #1586 | - | Seller PL / buyer PL, `pl`, `' PL '` | Pass | unit | P1 | `fa3-cross-border-guard.ts:38-56` | 1 (CB-01); 2 (CB-07); 3 (XB-06) | `fa3-cross-border-guard.spec.ts` |
| XB-02 | refuse | #1586 AC3 | Seller PL, buyer DE (or `de`), one line with `taxRate:''` (non-strict or pre-rollout), `allowCrossBorder` absent | Issue (unit; e2e needs a buyer-country option in order-synthesis) | `KsefCrossBorderUnsupportedException` naming seller PL / buyer DE (uppercased), before NBP and before any KSeF call | unit + e2e-API | P0 | guard `:47-58`; adapter `:284-289` | 1 (CB-02); 2 (CB-01); 3 (XB-02) | `fa3-cross-border-guard.spec.ts` |
| XB-03 | escape unit | #1586 | Same with `allowCrossBorder` true | Guard | Pass | unit | P1 | guard `:47` | 1 (CB-03) | `fa3-cross-border-guard.spec.ts` |
| XB-04 | narrowed | merge | Seller PL, buyer DE, EVERY line (incl. shipping) carries a shop rate (e.g. `23`) | Issue | Guard bypassed; document issued with the shop's rate (by design) | unit + e2e-API | P0 | guard `:47-49`; adapter `:288` | 1 (CB-04); 2 (CB-02); 3 (XB-01) | `ksef-invoicing.adapter.spec.ts` |
| XB-05 | empty country | #1586 | Buyer country `''` / `'  '` | Guard | Pass (KodKraju resolver decides) | unit | P2 | guard `:55` | 1 (CB-05); 2 (CB-07); 3 (XB-07) | `fa3-cross-border-guard.spec.ts` |
| XB-06 | shipping line | merge | Product lines rated, shipping line `taxRate:''` because one product lacks a rate | Issue to DE | Refused (shipping counts as relying on the default) | unit | P1 | `order-to-issue-invoice-command.mapper.ts:445-447` | 1 (CB-06); 2 (CB-03); 3 (XB-03) | none - add |
| XB-07 | whitespace rate | merge | A line `taxRate:'  '` | Issue to DE | Treated as relying on the default -> refused | unit | P2 | adapter `:288` | 1 (CB-07) | - |
| XB-08 | legacy payload | regression | Worker payload line lacking `taxRate` (legacy job) | Run the job | `line.taxRate.trim()` raises a TypeError, which retries to dead (old code tolerated it) - DEF-37, low likelihood | unit | P2 | adapter `:288` | 2 (CB-11) | - |
| XB-09 | failure state | #1586 | KSeF connection, DE buyer, default-rate line | Auto and manual issue; inspect record, FE, HTTP | Defect DEF-01: record `failed` `in-doubt` / `transport-timeout` ("timed out"), FE shows a timeout, manual issue 422 hides the "set allowCrossBorder" hint. Expected: terminal `rejected` with an actionable reason | e2e-API + e2e-UI | P0 | `invoice.service.ts:981-984,1011`; controller `:1590-1601` | 1 (CB-08, FC-01); 2 (CB-08); 3 (XB-09) | - |
| XB-10 | operator recovery | #1586 | After XB-09 | Set `allowCrossBorder:true`, then `POST /invoices/retry` / re-issue the same order | Expected: issues. Actual: retry skipped ("Not retry-eligible ... in-doubt"), in-doubt record returned, nothing re-attempted (DEF-01) | e2e-API | P0 | `invoicing.controller.ts:566`; `invoice.service.ts:658-684` | 2 (CB-09); 3 (XB-08) | - |
| XB-11 | escape hatch | #1586 | Admin | PATCH config `allowCrossBorder:true` via raw JSON editor / API; issue a DE order with rate-less lines | Issued at the domestic default (operator's responsibility) | e2e-API + e2e-UI | P1 | `ksef-adapter.factory.ts:223-226` | 1 (CB-09); 2 (CB-05); 3 (XB-04) | - |
| XB-12 | escape hatch type | #1586 | - | `allowCrossBorder:"true"` (string) / `1` | Silently treated as false (literal `true` only); validator accepts the value - consider validation (DEF-18) | unit + e2e-API | P2 | factory `:225`; validator has no rule | 1 (CB-10); 2 (CB-06); 3 (XB-05) | - |
| XB-13 | edit preserves | #1586 | `allowCrossBorder:true` in config | Save the KSeF edit form | Key preserved (`{...config}` spread) | e2e-UI | P1 | `ksef-connection-config.ts:357,393` | 1 (CB-11) | - |
| XB-14 | upgrade | #1586 / merge | Existing install, strict off, Allegro/Erli/PS orders to foreign buyers previously invoiced at the default rate | Same scenario after deploy | Now refused (and stuck per DEF-01); release note + product sign-off required (DEF-18) | e2e-API | P0 | adapter `:284-288` | 1 (CB-12); 3 (XB-13) | - |
| XB-15 | correction | #1586 | Old cross-border invoice with rate-less lines | Correct it | Refused unless `allowCrossBorder` / rated lines (guard runs on the original lines inside `issueCorrection`) | unit + e2e-API | P1 | adapter `:284,861-880` | 1 (CB-13); 2 (CB-10); 3 (XB-10) | - |
| XB-16 | seller case | #1586 | Seller `countryIso2:'pl'` | Issue to PL | Pass | unit | P2 | guard `:52-53` | 1 (CB-14) | - |
| XB-17 | live WDT | #1586 | Shop product rated `0-wdt`, buyer DE, KSeF TEST | Issue | Accepted, band `P_13_6_2` | e2e-API + manual-KSeF-portal | P1 | tax map `'0-wdt'` | 1 (CB-15); 2 (CB-04) | - |
| XB-18 | strict on | #1586 | `OL_TAX_RATE_STRICT_ENABLED=true` | Rate-less foreign order | Never reaches the adapter (`MissingTaxRate`); guard only matters for the pre-rollout era | integration | P1 | - | 3 (XB-12) | - |
| XB-19 | message | #1586 | - | Inspect the exception message | Names seller and buyer country, mentions `allowCrossBorder`, no PII | unit | P2 | `ksef-cross-border-unsupported.exception.ts` | 3 (XB-14) | - |
| XB-20 | no UI | #1586 | Connection setup UI and setup guide | Look for `allowCrossBorder` | None - raw JSON / API only, undocumented | e2e-UI | P2 | grep | 2 (CB-12); 3 (XB-16) | - |

## 15. GTU - GTU / Procedura (#1586 Phase 2, PR #1604 - dead seam)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| GTU-01 | mapper trim | #1586 AC4 | `gtuCode:' GTU_01 '`, `procedureCode:'SW'` | Map | Trimmed, forwarded | unit | P2 | `fa3-builder-input.mapper.ts:200-202` | 1 (GTU-01) | `fa3-builder-input.mapper.spec.ts` |
| GTU-02 | mapper blank | #1586 | `''` / `'  '` / absent | Map | Keys absent | unit | P2 | same | 1 (GTU-02); 2 (GTU-02); 3 (GTU-02) | `fa3-builder-input.mapper.spec.ts` |
| GTU-03 | builder order | #1586 AC4 | Codes set, EUR | Build + validate | `P_12 < GTU < Procedura < KursWaluty < StanPrzed`; XSD-valid | unit | P2 | builder `:268-283`; `FA3_FA_WIERSZ_CHILD_ORDER` | 1 (GTU-03); 2 (GTU-01); 3 (GTU-01) | `fa3-xml.builder.spec.ts` |
| GTU-04 | invalid enum | #1586 | `GTU_99` | Build + validate; submit to KSeF | Passes locally (opaque; validator checks order only); KSeF rejects at clearance | unit + manual-KSeF-portal | P2 | `fa3-xml.types.ts:100-107` | 1 (GTU-04); 3 (GTU-03) | - |
| GTU-05 | correction lines | #1586 | Codes on corrected lines | Map | Forwarded | unit | P2 | mapper | 1 (GTU-05); 3 (GTU-04) | - |
| GTU-06 | reachability | #1586 AC4 | - | Grep core/api/worker/web for any producer of `InvoiceLine.gtuCode` / `procedureCode` | None - "operator can configure and emit" NOT met (DEF-20) | not-testable | P1 | grep | 1 (GTU-06); 2 (GTU-01); 3 (GTU-05) | - |

## 16. RATE - per-line tax rate (#1586, superseded by main's ADR-063) - regression only

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| RATE-01 | mapper | #1586 / ADR-063 | Order items `taxRate '23'`, `'8'`, unset | `toIssueInvoiceCommand` | `'23'`, `'8'`, `''` (trimmed) | unit | P1 | `order-to-issue-invoice-command.mapper.ts:379` | 1 (TR-01); 3 (GTU-08) | `order-to-issue-invoice-command.mapper.spec.ts` |
| RATE-02 | dropped fields | merge | - | `pnpm type-check`; grep for the branch's `OrderItem` / `IncomingOrderItem` per-line fields, PS inference code and branch ADR-035 | None present; PS adapter untouched | unit | P1 | merge commit | 1 (TR-02); 2 (RATE-02); 3 (GTU-07) | - |
| RATE-03 | mixed unit | #1586 | 23% + 8% lines | Map + build | `P_13_1/P_14_1` and `P_13_2/P_14_2` split | unit | P1 | `fa3-builder-input.mapper.spec.ts` | 1 (TR-03) | `fa3-builder-input.mapper.spec.ts` |
| RATE-04 | mixed live | #1586 AC1/AC2 | PrestaShop products with catalogue rates 23% and 8%, KSeF TEST | Auto-issue | Accepted; correct band split; no `OrderItem.taxRate` inference from `order_details` | e2e-API + manual-KSeF-portal | P0 | ADR-063 path | 1 (TR-04); 2 (RATE-01); 3 (GTU-06) | - |
| RATE-05 | no inference | merge | PrestaShop order whose product has no catalogue rate | Auto-issue | Held by the ADR-063 gate (not inferred from tax-incl/excl prices) | e2e-API | P1 | `libs/integrations/prestashop` (no derivation code) | 1 (TR-05) | - |
| RATE-06 | default fallback | regression | Line with `''` rate | Map | Still uses the connection `defaultTaxRate` | unit | P1 | `fa3-builder-input.mapper.ts:210` | 3 (GTU-10) | - |

## 17. MF - MF certificate chain-of-trust and revocation (#1589, PR #1601)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| MF-01 | chain ok | #1589 AC1 | Anchors [CA1] | Validate leaf1 (issued by CA1) | Pass | unit | P1 | `mf-certificate-chain.ts:27-63` | 1 (MF-01) | `mf-public-key-validator.spec.ts` |
| MF-02 | untrusted root | #1589 AC1 | Anchors [CA1] | Leaf2 (issued by CA2) | `CERT_UNTRUSTED_ROOT` | unit | P1 | `:56-62` | 1 (MF-02); 2 (CRT-03) | `mf-public-key-validator.spec.ts` |
| MF-03 | parse failed | #1589 | Anchors configured | Garbage leaf PEM | `CERT_PARSE_FAILED` | unit | P1 | `:32-40` | 1 (MF-03); 3 (SEC-08) | `mf-public-key-validator.spec.ts` |
| MF-04 | direct pin | #1589 | Anchors contain the leaf itself (pinned self-signed) | Validate | Pass (fingerprint match) | unit | P2 | `:42-47` | 1 (MF-04); 2 (CRT-06); 3 (SEC-07) | - |
| MF-05 | intermediate present | #1589 | Anchors [root, intermediate]; leaf issued by the intermediate | Validate | Pass (any anchor may issue) | unit | P1 | `:43-55` | 1 (MF-05); 3 (SEC-05) | - |
| MF-06 | intermediate missing | #1589 | Bundle has the root only; leaf issued by an intermediate | Validate | Rejected (`checkIssued` is direct-issuer only); bundle must include intermediates - document | unit | P1 | `:41-53` | 2 (CRT-04) | - |
| MF-07 | expired anchor | #1589 | Anchor cert itself expired | Validate a leaf signed by it | Accepted (anchor validity not checked) - decide | unit | P2 | same | 2 (CRT-05) | - |
| MF-08 | malformed anchor | #1589 | Anchors [bad, CA1] | Validate leaf1 | Pass (bad anchor skipped) | unit | P2 | `:53-56` | 1 (MF-06) | - |
| MF-09 | no anchors | #1589 | Anchors [] | Garbage PEM | Chain not checked; pass | unit | P1 | validator `:72` | 1 (MF-07) | - |
| MF-10 | check order | regression | Usage mismatch, not-yet-valid, expired leaf with a valid chain | Validate | Unchanged codes (`CERT_USAGE_MISMATCH`, `CERT_EXPIRED`...), checked before the chain; first failing check wins | unit | P1 | validator `:48-74` | 1 (MF-08, MF-09); 2 (CRT-13); 3 (SEC-12) | pre-existing |
| MF-11 | revoked | #1589 AC2 | Injected checker returns `revoked` | Validate a trusted leaf | `CERT_REVOKED` | unit | P1 | validator `:76-96` | 1 (MF-10); 2 (CRT-10); 3 (SEC-09) | `mf-public-key-validator.spec.ts` |
| MF-12 | unknown / good | #1589 | Checker returns `good` / `unknown` | Validate | Pass; `unknown` debug-logged | unit | P1 | same `:92-94` | 1 (MF-11); 2 (CRT-11); 3 (SEC-10) | `mf-public-key-validator.spec.ts` |
| MF-13 | revocation edge | #1589 | Checker set, no anchors, garbage PEM | Validate | Passes silently (leaf undefined) - note | unit | P2 | `:81-86` | 1 (MF-12) | - |
| MF-14 | default checker | #1589 AC2 | Production wiring | Inspect | `NullRevocationChecker` always `unknown`, no network; live OCSP/CRL not implemented - AC "OCSP/CRL checked" not met | not-testable | P1 | `mf-certificate-revocation.ts:30-34` | 1 (MF-13); 2 (CRT-11); 3 (SEC-11) | - |
| MF-15 | loader unset | #1589 AC1 | `OL_KSEF_MF_ROOT_CA_PATH` unset | Load | 0 anchors + one warning "No MF root CA configured ... SKIPPED" | unit | P1 | `mf-trust-anchors.ts:93-111` | 1 (MF-14); 2 (CRT-01); 3 (SEC-01) | `mf-trust-anchors.spec.ts` |
| MF-16 | loader file | #1589 | Single PEM / bundle of 2 / unreadable path / bundle with one garbage block | Load | 1 / 2 / 0 + error log, chain SKIPPED (fail-open - confirm acceptable) / good ones only + warn | unit | P1 | `mf-trust-anchors.ts:38-92` | 1 (MF-15); 2 (CRT-07, CRT-08); 3 (SEC-04, SEC-06) | `mf-trust-anchors.spec.ts` (partial) |
| MF-17 | memoisation | #1589 | Load, change env, load | - | Same array (restart required, as documented) | unit | P2 | `:91-110` | 1 (MF-16); 2 (CRT-09); 3 (SEC-14) | `mf-trust-anchors.spec.ts` |
| MF-18 | wrong root live | #1589 AC1 | Env points at an unrelated CA | Restart api + worker; test connection; issue on KSeF TEST | All MF certs fail (`CERT_UNTRUSTED_ROOT`); handshake / issuance fail closed; operator-visible message clear; record failureMode likely in-doubt (DEF-01) | e2e-API | P1 | `mf-public-key-cache.service.ts:137,189-196` | 1 (MF-17); 2 (CRT-03); 3 (SEC-03) | - |
| MF-19 | real MF root | #1589 AC1/AC5 | Real MF TEST CA bundle obtained (who issues it - UNCERTAIN) | Set env, restart, issue on KSeF TEST | "Anchors loaded" log; chain verifies; handshake + issuance succeed | e2e-API + manual-KSeF-portal | P0 | `mf-certificate-chain.ts:42-54`; trust-anchors `:86-90` | 1 (MF-18); 2 (CRT-02); 3 (SEC-02) | - |
| MF-20 | default deploy | #1589 | Env unset (default deploy) | Boot api + worker; issue | One "No MF root CA configured" warning per process; issuance works (TLS-only) | integration + e2e-API | P0 | `mf-trust-anchors.ts:96-107` | 1 (MF-19); 2 (CRT-01); 3 (SEC-01) | - |
| MF-21 | cache stale | #1589 | Cached cert in Redis now fails the chain (anchors changed + restart) | Issue within the cache window | `validateMfPublicKeyCertificate` re-run with trust options; entry dropped and refetched | unit | P2 | `mf-public-key-cache.service.ts:134-141` | 1 (MF-20); 2 (CRT-12); 3 (SEC-13) | - |

## 18. PERM - least-privilege 403 `KsefPermissionDeniedException` (#1589)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| PERM-01 | http client | #1589 AC3 | fetch returns 403 (e.g. on `POST /sessions/online`) | Any call | `KsefPermissionDeniedException` (`instanceof KsefApiException`, `statusCode` 403); no token refresh; one fetch | unit | P1 | `ksef-http-client.ts:513-526` | 1 (PD-01); 2 (PRM-02); 3 (SEC-15) | `ksef-http-client.spec.ts` |
| PERM-02 | tester mapping | #1589 AC3 | Handshake throws 403 (fake HTTP) | `POST /connections/:id/test` | `{success:false, status:403, message:'...wystawianie faktur...'}` | unit | P2 | `ksef-connection-tester.adapter.ts:127-140` | 1 (PD-02); 2 (PRM-04); 3 (SEC-18) | none (no tester spec) - add |
| PERM-03 | tester live | #1589 AC3 | KSeF TEST token generated WITHOUT "wystawianie faktur" | Connections > Test connection | Likely reports success (tester only runs `handshake.authenticate`) - contradicts the setup-guide claim (DEF-17); record actual | manual-KSeF-portal + e2e-UI | P1 | `ksef-connection-tester.adapter.ts:107-121` | 1 (PD-03); 2 (PRM-01); 3 (SEC-16) | - |
| PERM-04 | issuance surfacing | #1589 AC3 | Same token | Issue an invoice; inspect record and FE | 403 on session open, not refreshed, not retried; record `failed` `in-doubt` / "timed out" - no permission hint (DEF-01). Expected: a distinct, operator-visible permission hint | e2e-API + manual-KSeF-portal | P1 | `invoice.service.ts:981-1013` | 1 (PD-04, FC-03); 2 (PRM-02, PRM-03); 3 (SEC-17) | - |
| PERM-05 | 401 | regression | Token rejected (401) | Call | Still `KsefAuthenticationException`; refresh path unchanged; 429 / 5xx unchanged | unit | P1 | `ksef-http-client.ts` | 1 (PD-05); 2 (PRM-06); 3 (SEC-19) | pre-existing |
| PERM-06 | other 4xx | regression | 422 / 400 | Call | Generic `KsefApiException` | unit | P2 | `:528-531` | 1 (PD-06) | - |
| PERM-07 | classifier | regression | 403 seen by the retry classifier and availability probe | Classify | Still non-retryable (`NON_RETRYABLE_KSEF_STATUS_CODES`); not treated as an outage, so no offline fallback | unit | P1 | `ksef-availability.ts:38`; `ksef-retry-classifier.adapter.ts:45-62` | 2 (PRM-05); 3 (SEC-20) | - |
| PERM-08 | export | #1589 | - | `import { KsefPermissionDeniedException } from '@openlinker/integrations-ksef'` | Exported from the package barrel | unit | P2 | `ksef/src/index.ts:50-52` | 1 (PD-07); 3 (SEC-22) | - |

## 19. PACE - rate limiting, bulk `total`, shared-NIP warning (#1594, PR #1603)

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| PACE-01 | burst | #1594 AC1 | Fake clock, capacity 3 (or default 108) | 3 acquires (or 108 session-open) | All immediate; next waits `ceil(3600000/perHour)` ms | unit | P1 | `ksef-rate-limiter.ts:112-137` | 1 (RL-01); 2 (RL-02); 3 (RL-01) | `ksef-rate-limiter.spec.ts` |
| PACE-02 | pacing | #1594 AC1 | perHour 2 | 3rd acquire | Waits 1,800,000 ms (virtual) | unit | P1 | same `:130` | 1 (RL-02); 3 (RL-02) | `ksef-rate-limiter.spec.ts` |
| PACE-03 | bulk N | #1594 | perHour 5, 8 acquires | - | 3 x 720,000 ms | unit | P1 | same | 1 (RL-03) | `ksef-rate-limiter.spec.ts` |
| PACE-04 | independence | #1594 | Different categories / bucket keys (NIPs) | Drain one | Others unaffected | unit | P1 | `:118` | 1 (RL-04); 2 (RL-03); 3 (RL-05) | `ksef-rate-limiter.spec.ts` |
| PACE-05 | disabled | #1594 | perHour 0 / negative / missing category | 50 acquires | No pacing | unit | P2 | `:113-116` | 1 (RL-05); 3 (RL-06) | `ksef-rate-limiter.spec.ts` |
| PACE-06 | refill cap | #1594 | Advance the clock | Acquire | Refilled tokens used, capped at capacity | unit | P2 | `:149-157` | 1 (RL-06) | - |
| PACE-07 | concurrency | #1594 | 10 concurrent acquires on an empty / 2-token bucket | `Promise.all` | Exactly the available tokens immediate, rest serialised; total wait about N x interval; never negative tokens / no over-draw | unit | P1 | `:118-136` | 1 (RL-07); 2 (RL-09); 3 (RL-07) | none - add |
| PACE-08 | defaults | #1594 AC1/AC4 | - | `buildDefaultKsefRateLimiterConfig()` | open 108/h, submit 162/h, close 108/h (0.9 x ceiling) | unit | P1 | `:58-83` | 1 (RL-08); 2 (RL-01); 3 (RL-03) | `ksef-rate-limiter.spec.ts` |
| PACE-09 | singleton | #1594 | - | `getSharedKsefRateLimiter()` twice | Same instance (per process) | unit | P2 | `:160-174` | 1 (RL-09) | - |
| PACE-10 | rolling-hour ceiling | #1594 AC1 | Real refill over 3600 s (fake clock) | 216 session-open acquires starting from a fresh bucket | Defect DEF-05: bucket starts full (108) and refills continuously, so about 216 are admitted in the first rolling hour against a 120/h ceiling. Expected <= 120 | unit | P1 | `ksef-rate-limiter.ts:143,150-156` | 3 (RL-04) | - |
| PACE-11 | classify | #1594 | Client with limiter | POST `/sessions/online`, `/sessions/online/{ref}/invoices`, `.../close`, with / without leading slash, trailing slash, query string | session-open / invoice-submit / session-close | unit | P1 | `ksef-http-client.ts:265-293` | 1 (RL-10); 2 (RL-05); 3 (RL-09) | `ksef-http-client.spec.ts` |
| PACE-12 | not paced | #1594 | - | GET status, UPO GET, POST `/auth/*`, public-key fetch, `POST /invoices/query/metadata`, POST `/sessions/online/r/invoices/x` | No acquire | unit | P1 | same | 1 (RL-11); 2 (RL-06); 3 (RL-10) | `ksef-http-client.spec.ts` (partial) |
| PACE-13 | once per request | #1594 | 429 then 200 on POST open | Request | One acquire; retries not re-paced | unit | P2 | `:203-209` | 1 (RL-12); 2 (RL-07); 3 (RL-11) | - |
| PACE-14 | fallback key | #1594 | No `bucketKey` | POST open | Bucket = connectionId | unit | P2 | `:142-144` | 1 (RL-13); 3 (RL-13) | `ksef-http-client.spec.ts` |
| PACE-15 | factory wiring | #1594 | KSeF connection | Build adapter | Limiter = shared singleton; key = seller NIP | unit | P1 | `ksef-adapter.factory.ts:85-86` | 1 (RL-14); 3 (RL-12) | none (no factory spec) |
| PACE-16 | tester | #1594 | - | Test connection | No limiter, never paced | unit | P2 | `ksef-connection-tester.adapter.ts:107-112` | 1 (RL-15); 2 (RL-08); 3 (RL-15) | - |
| PACE-17 | shared bucket | #1594 | Two KSeF connections with the same NIP in one process | Issue on both (two clients, one limiter) | Share one bucket | unit + integration | P1 | key = nip | 1 (RL-16); 2 (RL-04); 3 (RL-12) | none - add |
| PACE-18 | NIP format split | #1594 | Conn A nip `1189981779`, conn B `118-998-17-79` (via API) | Issue on both | Separate buckets (raw string key) - DEF-12 | unit | P2 | factory `:86,158` | 1 (RL-17); 2 (RL-15); 3 (RL-12) | - |
| PACE-19 | per process | #1594 AC1 | Bulk issue in api + auto-issue in worker (and offline resubmit / reconcile in worker) on the same NIP | Count KSeF session opens per hour (proxy or fake KSeF) | Defect DEF-06: two independent buckets, up to ~216/h vs 120/h; AC met only per process - document or fix | integration | P1 | `ksef-rate-limiter.ts:160-174` | 1 (RL-18); 2 (RL-12); 3 (RL-14) | - |
| PACE-20 | long pacing in sync HTTP | #1594 | Two bulk batches of 100 within an hour on one NIP | Second `POST /invoices/bulk-issue` (API and FE) | After ~108 opens the limiter sleeps ~33 s per token inside the synchronous request -> client / proxy timeout while the server keeps issuing. Record HTTP outcome, FE behaviour, and that partial results are not lost | e2e-API + e2e-UI | P1 | limiter `:126-131`; `invoicing.controller.ts:650-675` | 1 (RL-19); 2 (RL-14); 3 (RL-19) | - |
| PACE-21 | offline resubmit | #1594 | Many offline records | Recovery / resubmit sweep (#1701) | Resubmits consume the same buckets; sweep slows under a drained bucket | integration | P2 | adapter `transmitToSession` | 1 (RL-20); 2 (RL-17) | - |
| PACE-22 | real bulk | #1594 | KSeF TEST, 100 orders | Bulk issue | All processed, no 429 surfaced, duration logged | e2e-API | P1 | - | 2 (RL-13) | - |
| PACE-23 | 429 backoff | regression | 429 with `Retry-After` after a permit | Request | Reactive backoff unchanged | unit | P1 | `ksef-http-client.ts` | 2 (RL-16) | pre-existing |
| PACE-24 | bulk total | #1594 AC2 | Admin | `POST /invoices/bulk-issue` with duplicate ids | `total` = de-duplicated count = `issued + skipped + failed` | unit + e2e-API | P1 | `invoicing.controller.ts:665-676`; DTO `:55-60` | 1 (BULK-01); 2 (BLK-01); 3 (RL-17) | - |
| PACE-25 | bulk partial | #1594 AC2 | 3 ids: 1 issuable, 1 already issued, 1 failing | Bulk issue | `{total:3, issued:1, skipped:1, failed:1, results[...]}`; per-id outcome, batch not aborted | e2e-API | P1 | controller | 1 (BULK-02); 2 (BLK-02); 3 (RL-16) | - |
| PACE-26 | bulk cap | #1594 | 101 ids | Bulk issue | 400 | unit | P2 | bulk DTO | 3 (RL-18) | - |
| PACE-27 | bulk FE | #1594 AC2 | Invoices list bulk issue | Run | FE ignores `total`; summary toast still correct; no progress shown (DEF-21) | e2e-UI | P2 | `invoices-list-page.tsx:357`; `use-bulk-issue-invoices-mutation.ts` | 1 (BULK-03); 2 (BLK-03); 3 (RL-20) | - |
| PACE-28 | e2e types | #1594 | - | apps/e2e `BulkIssueInvoicesResponse` | Add `total` if asserted | unit | P2 | `apps/e2e/src/api/api.types.ts:~818` | 1 (BULK-04) | - |
| PACE-29 | live progress | #1594 AC2 | Large batch | - | No streaming progress (documented deferral); AC partially met | manual-review | P2 | - | 2 (BLK-04) | - |
| PACE-30 | warn create | #1594 AC3 | Active KSeF connection A with `seller.nip` X | Admin `POST /connections` KSeF B with NIP X | 201 with `warnings:["Another active connection (<name>) uses the same adapter and seller tax id (<nip>) ..."]` | unit + e2e-API | P1 | `connection.service.ts:233-271`; controller `:168-170` | 1 (SN-01); 2 (WRN-01); 3 (RL-21) | `connection.service.spec.ts` |
| PACE-31 | warn update | #1594 AC3 | A and B with different NIPs | PATCH B to NIP X | 200 with `warnings` | e2e-API | P1 | controller `:234-236` | 1 (SN-02); 2 (WRN-02); 3 (RL-22) | - |
| PACE-32 | no warning | #1594 | Self only; different adapter (e.g. inFakt); sibling disabled / `needs_reauth`; no `seller.nip`; no `adapterKey` | Create / update | No `warnings` key; no list query when nothing to compare | unit + e2e-API | P1 | `connection.service.ts:235-256` | 1 (SN-03); 2 (WRN-03, WRN-04, WRN-05); 3 (RL-23) | `connection.service.spec.ts` |
| PACE-33 | advisory | #1594 | `connectionPort.list` throws | Create / update | Still 201 / 200, no warning, warn log | unit | P1 | `:239-250` | 1 (SN-04); 2 (WRN-06); 3 (RL-24) | `connection.service.spec.ts` |
| PACE-34 | GET shape | #1594 | - | `GET /connections`, `GET /connections/:id` | Never carry `warnings`; DTO otherwise identical | unit + e2e-API | P2 | `connection-response.dto.ts:154-156`; controller `:173-209` | 1 (SN-05, RG-12); 2 (WRN-07); 3 (REG-10) | - |
| PACE-35 | subject disabled | #1594 | PATCH a disabled connection to a used NIP | Update | Warns although the subject is disabled - decide | unit | P2 | `:233-267` | 1 (SN-06) | - |
| PACE-36 | enable path | #1594 | Disabled B sharing NIP with active A | `PATCH /connections/:id/restore` or enable | No warning computed on those endpoints | e2e-API | P2 | controller `:433-500` | 1 (SN-07) | - |
| PACE-37 | FE not rendered | #1594 AC3 | Admin | Create / edit the colliding connection in the UI | Warning not shown anywhere (no FE consumer of `warnings`) - API only (DEF-21) | e2e-UI | P1 | grep `warnings` in `apps/web` | 1 (SN-08); 2 (WRN-08); 3 (RL-26) | - |
| PACE-38 | controller spec | #1594 | - | `connection.controller.spec.ts` mock | Has `findSharedRateLimitBucketWarnings` | unit | P2 | spec | 1 (SN-10) | `connection.controller.spec.ts` |
| PACE-39 | other adapters | #1594 | Any other adapter storing `config.seller.nip` | Create two | Warning also fires (platform-neutral) - verify intended | unit | P2 | `:275-286` | 1 (SN-11) | - |
| PACE-40 | other platforms | regression | PS, Allegro, Woo, inFakt, Subiekt, eparagony | Create / update | Response unchanged; one extra `list({status:'active'})` only when `config.seller.nip` exists | unit + e2e-API | P1 | controller; DTO | 2 (WRN-10); 3 (REG-09) | - |
| PACE-41 | dashed vs digits | #1594 AC3 | Sibling stored with dashes, new one with digits | Create | No warning (raw trimmed compare) - DEF-12 | unit | P2 | `connection.service.ts:275-284` | 2 (F19); 3 (RL-25) | - |

## 20. FC - failure classification of the new KSeF refusals (cross-cutting, DEF-01)

The per-trigger state rows are XB-09 (cross-border), FX-29 (NBP) and PERM-04 (403). The rows below cover the consequences that are shared by all three.

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| FC-01 | blocks elsewhere | DEF-01 | After XB-09 / FX-29 / PERM-04 on KSeF; order also routable to inFakt | Issue on the inFakt connection | Today 409 `OrderAlreadyInvoicedException` (`blocksIssuanceElsewhere` true for in-doubt). Expected: a terminal `rejected` record does not block | integration | P0 | `invoice-record.entity.ts:218-242` | 1 (FC-04); 2 (F2); 3 (F1) | - |
| FC-02 | worker outcome | DEF-01 | Auto path; one of the three refusals | Job runs and retries | Attempt 1 throws (retry; the exceptions are not in `KsefRetryClassifierAdapter`); attempt 2 returns the existing failed record -> `outcome:'ok'` although nothing was issued | unit + integration | P1 | `invoicing-issue.handler.ts:133-137`; `ksef-retry-classifier.adapter.ts:47-73` | 1 (FC-05); 3 (XB-15) | - |
| FC-03 | correction path | DEF-01 | Correction refused by the cross-border guard or NBP | Correct | Same in-doubt classification on the correction record | unit | P1 | `invoice.service.ts:1250-1270` | 1 (FC-06) | - |
| FC-04 | consumed number | DEF-01 | KSeF connection with numbering series | Trigger one of the three refusals | P_2 number is allocated before `adapter.issueInvoice`, so the in-doubt record holds a consumed number that never reached KSeF (gap in the series) | integration | P1 | `invoice.service.ts:740-762` | 3 (F1) | - |
| FC-05 | retry skip | DEF-01 | After any of the three refusals | `POST /invoices/retry` | Skipped "Not retry-eligible ... in-doubt"; `resumeExisting` returns the record untouched | e2e-API | P0 | `invoicing.controller.ts:566`; `invoice.service.ts:658-684` | 2 (F2); 3 (F1) | - |

## 21. MERGE - conflict-resolution behaviours named in the merge commit

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| MERGE-01 | guard narrowed | merge | - | Run XB-02, XB-04, XB-06 | Guard fires only when a line relies on the default rate | unit + e2e-API | P0 | guard `:47-49` | 2 (MRG-01) | see XB rows |
| MERGE-02 | NBP transport | merge | - | Run FX-14, FX-15, FX-17 | NBP via the connection-bound transport | unit | P1 | factory `:94-98` | 2 (MRG-02) | see FX rows |
| MERGE-03 | cancelledAt | merge | - | Run GATE-04 | `cancelledAt` honoured in the gate | unit + e2e-API | P0 | handler `:118` | 2 (MRG-03) | see GATE-04 |
| MERGE-04 | reason in GT / eparagony | merge | - | Run CORR-10..13 for subiekt-gt and eparagony, plus CORR-28 | Reason required in both added forms | unit + e2e-UI | P0 | flows | 2 (MRG-04) | see CORR rows |
| MERGE-05 | migration renumber | merge | - | Run MIG-01..05 | Migration renumbered to `1937370002000` | integration | P0 | migration file | 2 (MRG-05) | see MIG rows |
| MERGE-06 | ADR renumber | merge | - | Run DOC-01 | ADR-037 renamed to ADR-078 | manual-review | P2 | ADR README | 2 (MRG-06) | see DOC-01 |
| MERGE-07 | rate model dropped | merge | - | Run RATE-01..05 | Per-line rate model, PS inference and branch ADR-035 dropped | e2e-API + unit | P1 | - | 2 (MRG-07) | see RATE rows |
| MERGE-08 | single-flight | merge | - | Run LEASE-01..05 | Main's #3365 kept | integration | P0 | service | 2 (MRG-08) | see LEASE rows |
| MERGE-09 | KOD II wording | merge | - | Run DOC-05, DOC-09 | Setup guide KOD II note corrected; FE lib header still stale | manual-review | P2 | setup-guide | 2 (MRG-09) | - |

## 22. REG - regression on main behaviour touched by the merge

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| REG-01 | KSeF golden path | regression | KSeF TEST | Auto-issue PLN B2C and B2B (with NIP) orders; run `fa3-fidelity.spec.ts` | Accepted; XML byte-identical to pre-merge except the `AdresL2` fold and annotation defaults; P_6 / P_8A / P_9A as before; preview renders; update selectors if address / QR markup changed assertions | e2e-API + e2e-UI + manual-KSeF-portal | P0 | `apps/e2e/tests/invoicing/fa3-fidelity.spec.ts` | 1 (RG-01, RG-02, RG-07); 2 (REG-01); 3 (REG-01) | `fa3-fidelity.spec.ts` (rerun) |
| REG-02 | reconcile | regression | KSeF TEST | Reconcile sweep after submit | `accepted` + KSeF number + UPO downloadable; no `clearanceDetail` | e2e-API | P0 | reconciliation | 1 (RG-03); 3 (REG-04) | - |
| REG-03 | offline | regression | KSeF outage simulated (5xx) | Issue; resubmit + recovery sweep (#1700-#1703) | `pending-submission`; NBP (if EUR) resolved before the outage path; resubmission works and is paced | integration | P1 | adapter `resubmit` (~`:855`) | 1 (RG-04); 2 (REG-04); 3 (REG-03) | - |
| REG-04 | pending recovery | regression | Crash after submit | Recovery sweep | `POST /invoices/query/metadata` not paced, works | integration | P2 | adapter `:597` | 2 (REG-05) | - |
| REG-05 | numbering | regression | Numbering series configured | Issue 3 invoices + 1 correction | P_2 from the series; KOR P_2 from the correction series (#1575 / #1692); `recordId` path updates the claimed row | unit + e2e-API | P0 | `invoice.service.ts:1182-1335` | 1 (RG-05); 2 (REG-02); 3 (REG-06) | pre-existing adapter spec |
| REG-06 | issuance instant | regression | EUR invoice | Issue | Single issuance instant (#1692) and series allocation unchanged; NBP resolution between allocation and build does not change P_1 / P_2 | unit + e2e-API | P1 | adapter `:291-313` | 3 (REG-02) | - |
| REG-07 | corrections.spec | regression | - | Run `apps/e2e/tests/invoicing/corrections.spec.ts` (KOR + correction-of-correction, reason supplied) | Passes | e2e-API | P0 | `corrections.spec.ts:105-140` | 1 (RG-06); 2 (REG-03); 3 (REG-05) | `corrections.spec.ts` (rerun) |
| REG-08 | manual issue | regression | Admin | `POST /invoices` without the new flags | Byte-identical command apart from the address fold; `clearSalesDocumentBlock` still called | unit + e2e-API | P0 | controller `:372-470` | 1 (RG-08); 2 (REG-06); 3 (REG-07) | - |
| REG-09 | taxRateEra | regression | Pre-rollout order | Manual issue | `taxRateEra` still honoured alongside the new flags | unit | P2 | controller `:460` | 1 (RG-09) | - |
| REG-10 | validator rules | regression | - | KSeF payment / skonto / env / invoiceDefaults validation | Unchanged errors | unit | P1 | shape validator | 1 (RG-13); 3 (REG-11) | `ksef-connection-config-shape-validator.adapter.spec.ts` |
| REG-11 | provider corrections | regression | Providers: ksef (see REG-07), infakt, subiekt-nexo, subiekt-gt, eparagony; live sandbox / bridge per provider | Full correction flow in the UI / API with a reason | Issued (201, or the sandbox toast for eparagony) | e2e-UI + e2e-API | P1 | each flow; `infakt-provider.spec`; `apps/e2e/tests/subiekt` | 1 (RG-14, RG-15, RG-16, RG-17); 3 (REG-18, REG-19, REG-20) | - |
| REG-12 | FA3 view | regression | Existing `ksef-fa3-view` cases (non-KSeF-number docs, correction "before" rows, payment section) | Run | Pass; QR section does not break the parse-error fallback | unit | P1 | `ksef-fa3-view.test.tsx` | 1 (RG-18); 3 (REG-15) | `ksef-fa3-view.test.tsx` |
| REG-13 | detail section | regression | - | UPO preview / download, FA(3) view / download, Pending number, with the new connection prop | Unchanged | unit + e2e-UI | P1 | `ksef-invoice-detail-section.tsx` | 1 (RG-19); 2 (REG-14); 3 (REG-16) | `ksef-invoice-detail-section.test.tsx` |
| REG-14 | setup form | regression | - | Create a KSeF connection end to end with a valid NIP, seller profile, payment | Works; fixtures switched to `1189981779` | unit + e2e-UI | P1 | `ksef-setup-form.test.tsx` | 1 (RG-20); 2 (REG-13); 3 (REG-17) | `ksef-setup-form.test.tsx` |
| REG-15 | web type-check | regression | - | `pnpm --filter @openlinker/web type-check` (`tsc -b`) + lint (dependency-direction) for `shared/ui/index.ts` | Clean | integration | P1 | `shared/ui/index.ts` | 1 (RG-21); 3 (REG-14) | - |
| REG-16 | quality gate | regression | Merged tree | `pnpm lint` (incl. `check:invariants`: cross-context imports, service interfaces, workspace deps), `pnpm type-check`, `pnpm test` (api, core, ksef, web, worker) | All green | integration | P0 | CLAUDE.md quality gate | 1 (RG-22); 2 (REG-16); 3 (MIG-12, MIG-13) | all shipped specs |
| REG-17 | integration suites | regression | - | `pnpm test:integration` (invoicing, migrations parity) | Green | integration | P0 | - | 1 (RG-23); 2 (REG-16) | - |
| REG-18 | OrderRecord | regression | - | API responses that spread / serialise `OrderRecord` | New `status` getter does not shadow `recordStatus` / `paymentStatus` nor change payloads | unit | P2 | `order-record.entity.ts:660` | 1 (RG-24); 2 (REG-09); 3 (REG-13) | `order-record.entity.spec.ts` |
| REG-19 | reconcile guard | regression | Terminal record | Reconcile | Untouched (race guard) | unit | P2 | reconciliation spec | 1 (RG-28) | `regulatory-status-reconciliation.service.spec.ts` |
| REG-20 | buyer e-mail | regression | - | `InvoiceEmailSender` flows | E-mail still threaded (`BuyerProfile` arg 5 unchanged) | unit | P2 | mapper `:226-233` | 1 (RG-29) | - |
| REG-21 | bulk shape | regression | - | Existing bulk spec | Same shape plus `total` | e2e-API | P1 | controller `:650` | 2 (REG-07) | - |
| REG-22 | InvoiceRecord ctor | regression | - | Type-check every `new InvoiceRecord(...)` with the new trailing `clearanceDetail` parameter | Compiles; repository `toDomain` maps it | unit | P1 | repository `:669` | 2 (REG-10) | - |
| REG-23 | BuyerProfile | regression | - | Legacy 5-arg `BuyerProfile` calls | Unchanged; `isB2B` logic unaffected | unit | P2 | entity | 2 (REG-11) | - |
| REG-24 | connection wizards | regression | - | Create PS, Allegro, Woo, inFakt, Subiekt, eparagony, KSeF connections (golden path S1-S4) | 201; no unexpected warnings | e2e-UI | P1 | controller | 2 (REG-12) | - |
| REG-25 | other detail sections | regression | - | inFakt, Subiekt, eparagony invoice detail pages | Unaffected (connection prop already existed) | e2e-UI | P2 | `invoice-detail-page.tsx:282-289` | 2 (REG-15) | - |
| REG-26 | correction snapshot | regression | Correction with `originalDocument` present | Issue correction | `issuedLineSnapshot` still written (now requires `correctionBuyer` truthy) | unit | P1 | `invoice.service.ts:1289-1311` | 3 (REG-21) | - |
| REG-27 | auto mapper | regression | Auto-issue without flags | `toIssueInvoiceCommand` | BuyerProfile flags undefined; `assertLinesSumToTotal` unchanged | unit | P1 | mapper `:131-136` | 3 (REG-22) | `order-to-issue-invoice-command.mapper.spec.ts` |
| REG-28 | worker import | regression | - | Build the worker with the new `IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN` import | Builds under `isolatedModules` / `consistent-type-imports` lint | integration | P2 | `invoicing-issue.handler.ts:66` | 3 (MIG-14) | - |

## 23. UI - UI state matrix per touched component

Each row: unit (vitest) for the logic plus one e2e-UI smoke per component.

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| UI-01 | `KsefFa3View` QR | #1579 | Accepted invoice | Check loading / empty / error / read-only states | Loading: no QR until SHA-256 resolves, no spinner, no layout jump. Empty: no NIP / date -> no section. Error: parse error -> null + parent "Preview failed"; hash failure (DEF-15) -> no section + console error. Same render for all roles, but wrong host for operator (DEF-02) | unit + e2e-UI | P1 | `ksef-fa3-view.tsx` | 2 (UI-01); 3 (§20 row 1) | `ksef-fa3-view.test.tsx` |
| UI-02 | `KsefInvoiceDetailSection` | #1579 / #1581 / #1582 | KSeF invoice in each status | Same | "Loading..." on View / UPO buttons (unchanged); not-applicable status and no number -> section hidden, "Pending" number; `viewError` / parse fail -> "Preview failed", toast on UPO / FA(3) failure; buttons disabled while loading; viewer and operator see detail, copy, QR, rejection row | unit + e2e-UI | P1 | `ksef-invoice-detail-section.tsx` | 2 (UI-02); 3 (§20 row 2) | `ksef-invoice-detail-section.test.tsx` |
| UI-03 | rejection row | #1582 | - | Same | Hidden when `clearanceDetail` null; visible to all read roles | unit + e2e-UI | P2 | `:173-190` | 2 (UI-03) | `ksef-invoice-detail-section.test.tsx` |
| UI-04 | correction flows | #1582 | Providers: ksef, infakt, subiekt-nexo, subiekt-gt, eparagony | Same | Loading: content query -> manual line rows; empty reason / no lines -> inline errors (line first, then reason); API 400 / 422 -> toast (unchanged); textarea + fields + submit disabled while pending; not reachable for non-admin; demo lock | unit + e2e-UI | P1 | five flows | 2 (UI-04); 3 (§20 row 4) | five `*-invoice-correction-flow.test.tsx` |
| UI-05 | KSeF setup / edit NIP | #1595 | - | Same | Empty allowed; format / checksum messages; save blocked while invalid; submit disabled while creating; edit hidden / read-only for read roles; demo lock | unit + e2e-UI | P2 | `ksef-setup.schema.ts`; `ksef-connection-config.ts` | 2 (UI-05); 3 (§20 row 3) | `ksef-setup-form.test.tsx` |
| UI-06 | `QrCode` | #1579 | - | Same | `value=''` -> null; theme-fixed colours | unit | P2 | `qr-code.tsx` | 2 (UI-06); 3 (§20 row 5) | `qr-code.test.tsx` |
| UI-07 | `CopyableId` (108g) | #1581 | - | Same | No number -> "Pending"; clipboard denied -> feedback; works read-only | unit + e2e-UI | P2 | `CopyableId` | 2 (UI-07) | - |
| UI-08 | connections create / edit warnings | #1594 | - | Same | Warning never rendered (DEF-21) | e2e-UI | P2 | no FE consumer | 3 (§20 row 6) | - |
| UI-09 | invoices list bulk issue | #1594 | Admin | Same | `isConfirming` state; banner on error; button disabled while pending; admin only; no progress / `total` | e2e-UI | P2 | `invoices-list-page.tsx:357` | 3 (§20 row 7) | - |

## 24. ROLE - roles and permissions on touched endpoints and surfaces

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| ROLE-01 | connections write | #1594 / #1595 | admin, operator, viewer, demo viewer | `POST /connections`, `PATCH /connections/:id` (warnings, NIP checksum) | admin 201 / 200 / 400; operator, viewer, demo viewer 403; the warning (which names the NIP) never reaches operators | e2e-API | P1 | `connection.controller.ts:153,210-211` | 1 (ROLE-01, ROLE-02, SN-09); 2 (ROLE-01, WRN-09); 3 (PERM-07) | - |
| ROLE-02 | connection read config | #1579 | Same roles | `GET /connections/:id` | 200 for all; admin and demo viewer get full config; operator and non-demo viewer get `config:{}` -> QR env lost (DEF-02); no `warnings` key | e2e-API | P0 | `connection-response.dto.ts:137-138`; controller `:193` | 1 (ROLE-03); 2 (ROLE-02) | - |
| ROLE-03 | manual issue | #1580 / #1595 | Same roles | `POST /invoices` (JST/GV, buyer NIP checksum) | admin 2xx; others 403 | e2e-API | P1 | `invoicing.controller.ts:372` | 1 (ROLE-04); 2 (ROLE-03); 3 (PERM-01) | - |
| ROLE-04 | bulk issue | #1594 | Same roles | `POST /invoices/bulk-issue` (`total`, pacing) | admin 2xx; others 403 | e2e-API | P1 | `:630` | 1 (ROLE-05); 2 (ROLE-04); 3 (PERM-03) | - |
| ROLE-05 | correct | #1582 | Same roles | `POST /invoices/:id/correct` (reason, override) | admin 2xx; others 403 | e2e-API | P0 | `:846` | 1 (ROLE-06); 2 (ROLE-05); 3 (PERM-02) | - |
| ROLE-06 | resend | #1582 | Same roles | `POST /invoices/:id/resend-to-ksef` (clears detail) | admin per CLR-10 / CLR-12; others 403 | e2e-API | P2 | `:1022` | 1 (ROLE-07); 2 (ROLE-06); 3 (PERM-04) | - |
| ROLE-07 | invoice reads | #1582 | Same roles | `GET /invoices/:id`, `GET /invoices`, `GET /orders/:id/invoice` (`clearanceDetail`) | 200 for all | e2e-API | P1 | `:1241,1300,1804` | 1 (ROLE-08); 2 (ROLE-07); 3 (PERM-05) | - |
| ROLE-08 | source document | #1579 | Same roles | `GET /invoices/:id/document?kind=source` (QR input) | 200 for all | e2e-API | P1 | `:1680` | 2 (ROLE-07); 3 (PERM-06) | - |
| ROLE-09 | FE read roles | #1579 / #1581 / #1582 | operator, viewer | Open KSeF invoice detail | See KSeF section incl. rejection detail, QR, copy; no correction submit | e2e-UI | P1 | - | 1 (ROLE-09); 3 (PERM-10) | - |
| ROLE-10 | FE correction gating | #1582 | operator, viewer, demo | Order sales-document panel / invoice page | Correction entry point hidden or locked (`ReadOnlyLock`) as before; API admin-only | e2e-UI | P1 | `sales-document-panel.tsx:934-960`; controller `@Roles('admin')` `:846` | 1 (RS-16); 2 (RSN-29); 3 (PERM-08) | - |
| ROLE-11 | demo lock | #1582 | Demo mode | Correction submit with a reason; issue | Blocked by the demo lock, no API call; QR + copy still work | e2e-UI | P2 | `ReadOnlyLock` | 1 (ROLE-10); 2 (ROLE-08); 3 (PERM-09) | - |

## 25. DOC - documentation and ADRs

| ID | Area | Ref | Precondition | Steps | Expected | Level | Prio | Source | Found by | Existing coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| DOC-01 | ADR-078 | #1580 / merge | - | Check ADR-078 file, README index row, status, links | Number unique (no ADR-037 collision), status Accepted, README row present, links to ADR-026 / ADR-063 resolve | manual-review | P2 | `docs/architecture/adrs/077-*.md`; `adrs/README.md:171` | 1 (DOC-01, RG-32); 2 (ADN-08); 3 (ADN-15, MIG-08) | - |
| DOC-02 | ADR-035 | #1586 / merge | - | Check ADRs and overview | Branch ADR-035 absent; main's ADR-035 (CTC offline) untouched; ADR-063 / overview carry no reference to the dropped phase plan | manual-review | P2 | `docs/architecture/adrs/035-*` | 1 (DOC-04); 2 (RATE-02); 3 (MIG-09) | - |
| DOC-03 | setup guide | #1578 | - | Read KSeF setup guide | NBP timing / holiday caveat, Art. 108g, MF root CA, revocation, least-privilege, whitelist deferral, QR + KOD II / #3620 wording consistent with code (watch DEF-07, DEF-14, DEF-03, DEF-17) | manual-review | P1 | `libs/integrations/ksef/docs/setup-guide.md` | 1 (DOC-02) | - |
| DOC-04 | FA3 notes | #1586 / #1580 | - | Read `FA3_IMPLEMENTATION_NOTES.md` | Remove the stale PrestaShop `order_details` rate-inference claim (`:83-89`) and the "JST / GV hard-coded to 2" bullet (`:271`) - DEF-16 | manual-review | P1 | `libs/integrations/ksef/src/infrastructure/fa3/FA3_IMPLEMENTATION_NOTES.md` | 1 (DOC-03); 2 (RATE-03); 3 (GTU-09, MIG-10) | - |
| DOC-05 | verification header | #1579 | - | Read `ksef-verification.ts` header | Fix "OL never issues offline" (`:10`), which contradicts the corrected setup-guide KOD II note | manual-review | P2 | `apps/web/src/plugins/ksef/lib/ksef-verification.ts:9-10` | 2 (F17); 3 (MIG-10) | - |
| DOC-06 | crypto README | #1589 AC4 | - | Read crypto README | Matches code (order of checks, error codes); operator steps for `OL_KSEF_MF_ROOT_CA_PATH` | manual-review | P2 | crypto `README.md` | 1 (DOC-05); 2 (CRT-14); 3 (SEC-21) | - |
| DOC-07 | tutorial | #1589 AC4 | - | Read tutorial | Least-privilege note present | manual-review | P2 | `tutorial.md` | 1 (DOC-06); 2 (CRT-14); 3 (SEC-21) | - |
| DOC-08 | style guide / license | #1579 | - | Check `frontend-ui-style-guide.md` and the dependency | `qrcode-generator` row present; MIT, no transitive deps | manual-review | P2 | `docs/frontend-ui-style-guide.md` | 1 (DOC-07); 3 (MIG-11) | - |
| DOC-09 | QR docs | #1579 AC3 | - | Setup guide and FA3 notes | Describe KOD I; KOD II limitation names #3620 | manual-review | P2 | setup-guide | 2 (QR-31) | - |
| DOC-10 | FX docs | #1581 AC2/AC4 | - | Setup guide "Resolution timing" | Source (NBP table A), timing, holiday walk-back, failure posture documented; "snapshot-equivalent" correction claim is false (DEF-07) - fix | manual-review | P2 | setup-guide | 2 (FX-31); 3 (FX-28) | - |
| DOC-11 | Art. 108g doc | #1581 AC4 | - | Setup guide "Art. 108g payment-title" bullet | Reflects resolved status and the pre-clearance caveat (DEF-14) | manual-review | P2 | setup-guide | 3 (A108-07) | - |
| DOC-12 | flow docblocks | #1582 | - | Read headers of KSeF, inFakt, nexo correction flows | Still say "optional free-text reason" - update | manual-review | P2 | `ksef-invoice-correction-flow.tsx:7` | 2 (RSN-25) | - |

## 26. REACH - reachability matrix

Matrix rows, not prioritised test cases. "Dead seam" = no producer anywhere in the product; the behaviour is reachable only by a unit test or by editing code.

| ID | Behaviour | UI | API only | Auto path | Dead seam / not reachable | Notes | Found by |
|---|---|---|---|---|---|---|---|
| REACH-01 | Live order-status gate | n/a | n/a | yes (worker `invoicing.issue`) | manual issue, bulk issue, fiscal receipts have no gate | GATE-17, GATE-18 | 2 (§14); 3 (§21) |
| REACH-02 | Seller NIP checksum | yes (wizard + edit) | yes (config validator) | n/a | - | stored with separators if sent via API (DEF-12) | 2 (§14) |
| REACH-03 | Buyer NIP checksum | no (FE never sends `buyerTaxId`) | yes (`pl-nip` scheme only, `POST /invoices`, correction override) | no (order-derived NIP never checked) | - | NIP-38 | 1 (REACH-03); 2 (§14) |
| REACH-04 | JST / GV flags | no | `POST /invoices` (`buyerIsPublicSectorEntity`, `buyerIsVatGroupMember`); correction `buyerOverride.*` | no (auto, bulk, retry never set them) | - | lost on correction (DEF-08) | 1 (REACH-01); 2 (§14); 3 (§21) |
| REACH-05 | Buyer override on correction | no | `POST /invoices/:id/correct` (needs >= 1 line delta) | n/a | pure buyer-only correction | honoured by KSeF only (DEF-09); `Podmiot2K` missing (DEF-23) | 1 (REACH-02); 2 (§14); 3 (§21) |
| REACH-06 | Adnotacje operator flags (P_16, P_17, P_18A, P_23, PMarzy, `exemptionLegalBasis`) | no | no | no | **yes - dead seam** | ADN-11 | 1 (REACH-04); 2 (§14); 3 (§21) |
| REACH-07 | Adnotacje line-derived (P_18 `oo`, Zwolnienie `zw`) | indirect (shop product rate) | indirect | yes (ADR-063 rates) | - | P_19C placeholder (DEF-22) | 1 (REACH-06); 2 (§14); 3 (§21) |
| REACH-08 | GTU / Procedura | no | no | no | **yes - dead seam** | GTU-06 | 1 (REACH-05); 2 (§14); 3 (§21) |
| REACH-09 | NBP / KursWaluty / P_14_xW | indirect (EUR order) | yes | yes | - | KOR rate mismatch (DEF-07) | 2 (§14); 3 (§21) |
| REACH-10 | Art. 108g copy | yes | n/a | n/a | - | wrong value before clearance (DEF-14) | 2 (§14) |
| REACH-11 | Cross-border guard | indirect (foreign buyer + rate-less line) | yes | yes | - | recorded in-doubt (DEF-01) | 2 (§14); 3 (§21) |
| REACH-12 | `allowCrossBorder` | raw JSON config editor only | PATCH config | n/a | no form field, undocumented, unvalidated | XB-20 | 1 (REACH-07); 2 (§14); 3 (§21) |
| REACH-13 | QR KOD I | yes (FA(3) preview, accepted only) | source XML via `kind=source` only | n/a | PDF / print / e-mail export (none exists) | wrong host for operator (DEF-02) | 1 (REACH-08); 2 (§14); 3 (§21) |
| REACH-14 | Rejection detail | yes (KSeF section, rejected only) | `GET /invoices/:id` | written by reconcile | - | - | 1 (REACH-09); 2 (§14); 3 (§21) |
| REACH-15 | Resend clears detail | inFakt only | `resend-to-ksef` | n/a | KSeF: 501 | CLR-12 | 1 (REACH-15) |
| REACH-16 | Correction reason required | yes (5 flows) | yes | n/a | - | no 256 cap (DEF-25) | 2 (§14); 3 (§21) |
| REACH-17 | Shared-NIP warning | no | create / update response | n/a | - | DEF-21 | 1 (REACH-10); 2 (§14); 3 (§21) |
| REACH-18 | Bulk `total` | no | bulk response | n/a | - | DEF-21 | 1 (REACH-11); 2 (§14); 3 (§21) |
| REACH-19 | Pacer | indirect (bulk) | implicit | implicit | - | per process (DEF-06) | 2 (§14); 3 (§21) |
| REACH-20 | MF root CA chain | env var `OL_KSEF_MF_ROOT_CA_PATH` + restart (ops only) | indirect | indirect | off by default | MF-20 | 1 (REACH-13); 2 (§14); 3 (§21) |
| REACH-21 | Revocation (OCSP / CRL) | - | - | seam only (`NullRevocationChecker`) | live OCSP / CRL | MF-14 | 1 (REACH-14); 2 (§14); 3 (§21) |
| REACH-22 | 403 permission hint | connection test rarely reaches it | log only | log only; record says "timed out" | - | DEF-17, DEF-01 | 2 (§14); 3 (§21) |
| REACH-23 | Address fold | yes | yes | yes | - | - | 2 (§14) |
| REACH-24 | #1596 AC2 post-issuance cancellation flag | no | no | no | **not implemented** | GATE-20 | 1 (REACH-12); 3 (§21) |

## Acceptance-criteria status after the merge

| Issue / PR | AC | Status after merge | Tests |
|---|---|---|---|
| #1578 epic | Children reviewed; ADRs written | ADR-078 accepted (renumbered from ADR-037); branch ADR-035 dropped, ADR-063 (main) governs rates | DOC-01, DOC-02 |
| #1579 / PR #1602 | QR for every cleared invoice rendered outside KSeF | On-screen FA(3) preview for `accepted` only; host / path doubtful (DEF-03); wrong host for operator (DEF-02) | QR-26..32 |
| #1579 | FE preview + PDF / print show QR | Preview yes; no PDF / print export exists | QR-46, REACH-13 |
| #1580 / PR #1605 | Address includes city + postcode | Implemented (`AdresL2 = postal city`) | ADDR-* |
| #1580 | Operator can flag JST / GV | API manual issue + correction override only; no FE; lost on correction (DEF-08) | JSTGV-* |
| #1580 / PR #1607 | Adnotacje reflect real status | Line-derived `oo` -> P_18 and `zw` -> Zwolnienie reachable; operator flags dead seam (DEF-20) | ADN-* |
| #1581 / PR #1610 | Non-PLN emits KursWaluty + P_14_xW | Implemented; NBP read via the connection transport; KOR rate mismatch (DEF-07) | FX-* |
| #1581 | Rate source / timing documented | Documented; correction-timing claim false (DEF-07) | DOC-10 |
| #1581 | KSeF number copyable for Art. 108g | Implemented; wrong value before clearance (DEF-14) | A108G-* |
| #1582 / PR #1627 | Empty / whitespace reason rejected or never emitted empty | DTO required + trimmed; FE x5 (eparagony and Subiekt GT added by the merge); builder omits; validator rejects; no 256 cap (DEF-25) | CORR-* |
| #1582 | Rejection detail persisted + surfaced | Adapter, reconcile, apply, migration `1937370002000`, DTO, KSeF FE | CLR-*, MIG-* |
| #1582 | Buyer identity correctable | API `buyerOverride`, honoured by KSeF only, needs a line delta, no `Podmiot2K` | BUYOV-* |
| #1586 / PRs #1604 #1611 | Mixed-rate split; cross-border correct band or clear refusal | Split works via ADR-063 rates; guard narrowed; refusal recorded in-doubt (DEF-01) | RATE-*, XB-* |
| #1586 | Operator can configure + emit GTU / Procedura | Not met - dead seam | GTU-06 |
| #1589 / PR #1601 | Chain to pinned MF root | Mechanism shipped; no MF root bundled; skipped unless `OL_KSEF_MF_ROOT_CA_PATH` set | MF-* |
| #1589 | OCSP / CRL revocation | Seam only (`NullRevocationChecker`); not met live | MF-14 |
| #1589 | Token scope check or documented conclusion | Documented; distinct 403 exception; connection-test detection claim false (DEF-17) | PERM-* |
| #1594 / PR #1603 | Bulk paces against documented ceilings | Per-process token bucket keyed by seller NIP; can exceed the ceiling (DEF-05, DEF-06) and break the lease (DEF-04) | PACE-01..23, LEASE-08..09 |
| #1594 | Progress / partial completion | Per-id results + new `total`; FE does not render it | PACE-24..29 |
| #1594 | Second connection on same NIP warns | API response only; no NIP normalisation | PACE-30..41 |
| #1595 / PR #1600 | Checksum-invalid seller / buyer NIP rejected | Seller: FE + config validator; buyer: API DTO for `pl-nip` only; auto path unchecked | NIP-* |
| #1595 | Whitelist decision documented | Documented as deferred | NIP-40 |
| #1596 / PR #1598 | Cancelled / refunded before the job runs -> no invoice | Implemented in the worker; adjusted to honour `cancelledAt` | GATE-01..15 |
| #1596 | Cancelled after issuance -> operator flag | Not implemented | GATE-20 |

## Superseded acceptance criteria

| AC | Superseded by | Reason | Tests kept |
|---|---|---|---|
| #1582 AC5 / PR #1627 part 4 - unconditional CAS lease for corrections | main #3365 (correction fallback key + `claimForIssue`) | Main already shipped a single-flight design; the merge kept main's and only renamed `pending.id` -> `recordId` | LEASE-01..05, LEASE-07 |
| #1586 AC1 / PR #1611 - `OrderItem` / `IncomingOrderItem` carry a per-line tax rate; PrestaShop infers it from `order_details` | main ADR-063 (shop-catalogue rate) | ADR-063 forbids inferring a rate from order prices; the branch fields and the inference code were dropped | RATE-01..06 |
| #1586 ADR (branch ADR-035 phase plan) | ADR-063 on main; main's own ADR-035 (CTC offline) is unrelated | Number collision and decision superseded; ADR dropped by the merge | DOC-02 |
| #1586 AC3 - cross-border always refused | merge narrowing | Guard now refuses only when a line relies on the connection default rate; a fully shop-rated foreign order is issued at the shop's rate | XB-02, XB-04, XB-06 |
| #1580 ADR-037 (annotation ADR) | ADR-078 | Renumbered because main already uses 037 | DOC-01 |
| #1582 migration `1818000000008-add-invoice-clearance-detail` | `1937370002000-add-invoice-clearance-detail` | Timestamp collided with main's `1818000000008-add-email-confirmation-tokens` | MIG-01..08 |
| #1581 NBP read through a bare `fetch` | connection-bound transport (`host.http.forConnection`) | Merge routed NBP through the connection limiter and outbound log | FX-14..17 |
| #1579 docs "OL never issues offline" (KOD II out of scope) | setup-guide KOD II note naming #3620 | Main now issues offline (#1700); the setup guide was corrected, the FE lib header was not | QR-35, DOC-05 |

## Test-harness prerequisites

| # | Prerequisite | Needed by | Found by |
|---|---|---|---|
| H-01 | Add a `buyerCountryIso` option to `apps/e2e/src/support/order-synthesis.ts` (country is hard-coded `PL` at `:295`) | XB-02, XB-04, XB-11, XB-14, XB-17 | 2 (harness notes) |
| H-02 | PrestaShop order-cancel helper (POST to `order_histories` with state "Canceled") for the live-status race; plus a way to pause / delay the worker | GATE-01, GATE-02 | 2 (harness notes); 1 (LS-09) |
| H-03 | Make `IssueCorrectionInput.reason` required in `apps/e2e/src/api/api.types.ts:834` | CORR-29, every e2e correction | 1 (RG-31); 2 (harness notes) |
| H-04 | Fix `apps/e2e/tests/sales-documents/routing-full-path.spec.ts` F2 to fill the correction reason | CORR-28 | 1 (RG-30); 2 (RSN-28) |
| H-05 | EUR order synthesis via the existing `SynthesizeOrderOptions.currencyId` (see `tests/order-ingestion/order-currency.spec.ts`) | FX-27, FX-28, FX-22, FX-37 | 2 (harness notes); 3 (FX-01) |
| H-06 | A QR decoder in the e2e toolchain (screenshot + jsQR) | QR-27, QR-28 | 2 (QR-02); 3 (QR-02) |
| H-07 | A way to force a KSeF rejection (semantic error accepted locally, or a fake KSeF status 440) and to trigger `invoicing.regulatoryStatus.reconcile` on demand | CLR-13, CLR-14 | 2 (CD-01); 3 (RJD-01) |
| H-08 | Egress block for `api.nbp.pl` (or an injectable failing NBP) on the e2e stack | FX-29, FX-30 | 1 (FX-14); 3 (FX-22) |
| H-09 | Fake-clock harness for `KsefRateLimiter` driven through `InvoiceService` with two workers / concurrent issuances | LEASE-08, LEASE-09, PACE-10, PACE-19 | 2 (RL-10); 3 (RL-08) |
| H-10 | A fake KSeF (or proxy) that counts session opens per hour across api + worker | PACE-19, PACE-22 | 2 (RL-12) |
| H-11 | A KSeF TEST token generated without "wystawianie faktur" | PERM-03, PERM-04 | 1 (PD-03); 2 (PRM-01); 3 (SEC-16) |
| H-12 | The real MF TEST root CA bundle (who issues it is UNCERTAIN) | MF-19 | 1 (MF-18); 2 (CRT-02); 3 (SEC-02) |
| H-13 | Shop products with `zw`, `oo`, `0-wdt` catalogue rates in the e2e PrestaShop | ADN-13, ADN-14, XB-17 | 1 (AN-11); 3 (ADN-02) |
| H-14 | Add `total` to `BulkIssueInvoicesResponse` in `apps/e2e/src/api/api.types.ts` if asserted | PACE-24 | 1 (BULK-04) |

## Environment checks

| # | Check | Why | Found by |
|---|---|---|---|
| E-01 | On every environment that ever ran the epic branch (demo / staging), look in the migrations table for `AddInvoiceClearanceDetail1818000000008`; then confirm `AddEmailConfirmationTokens1818000000008` (main) was actually applied (its table exists) | Same timestamp `1818000000008`; TypeORM may consider it applied and skip main's email-confirmation-tokens migration | 1 (CD-15); 2 (MIG-03); 3 (MIG-03) |
| E-02 | On those environments, run `migration:show` / `migration:run` and confirm `1937370002000` runs as a no-op and is recorded | Column already exists from the branch migration | 1 (CD-13); 2 (MIG-03); 3 (MIG-03) |
| E-03 | List KSeF connections whose stored `seller.nip` fails the mod-11 checksum or contains separators | They can no longer save config (DEF-19) / they emit dashes in `Podmiot1/NIP` (DEF-12) | 1 (NIP-17); 3 (F13) |
| E-04 | List KSeF connections invoicing foreign buyers with strict mode off and orders whose lines rely on the default rate | Those issuances (and corrections) are refused after deploy (DEF-18) | 1 (CB-12); 3 (XB-13) |
| E-05 | Confirm whether staging / demo is served over plain HTTP from a non-localhost origin | Web Crypto unavailable -> QR missing (DEF-15) | 1 (QR-20); 2 (QR-17) |
| E-06 | Decide and set `OL_KSEF_MF_ROOT_CA_PATH` per environment, restart api + worker | Chain-of-trust is skipped (fail-open) by default | 1 (MF-19); 3 (SEC-01) |
| E-07 | Count api + worker replicas issuing to KSeF on the same seller NIP | Each process has its own bucket (DEF-06) | 1 (RL-18); 2 (F7); 3 (F3) |

## Resolution (2026-10-22, branch `1578-ksef-legal-completeness-ready`)

Principle applied throughout: **OpenLinker suggests, the operator decides.** A guard
that is a reading of the law became a warning the operator confirms
(`acknowledgeWarnings`) or a connection setting; only what KSeF or the XSD would
reject anyway blocks before the call.

Live e2e = `apps/e2e/tests/ksef-legal/*.spec.ts` (project `ksef-legal`), run one
worker at a time against **KSeF TEST** on a clone of the ol-demo-fresh database
(seller NIP 9151704181). All 19 tests pass. Screenshots are under
`apps/e2e/screenshots/ksef-legal/<area>/` (gitignored). "unit" = covered by unit
specs only, with the reason given.

| DEF | Fix (commit) | Live e2e | Screenshot | Note |
|---|---|---|---|---|
| 01 | 89859f39b | cross-border | cross-border/02 | Refusals carry `failureMode: 'rejected'`; the live rejection path itself is unit (no rate-less product on the stack) |
| 02 | 2e30ddf66, 60fb55603 | qr, roles | qr/01 | `publicConfig.env` for every role; link built server-side |
| 03 | 60fb55603 (server link from main #3648) | qr | qr/01 | Host `qr-test`, NIP, date, Base64URL(SHA-256) checked; QR decoded from pixels |
| 04 | 6ed92115b | unit | - | Whole round reserved; wait capped at 20 s, then penalty-free deferral |
| 05 | 6ed92115b | unit | - | Sliding-window log (fake clock) |
| 06 | 6ed92115b | unit | - | Redis ZSET + Lua, in-process fallback |
| 07 | 89859f39b | fx | - | KOR repeats the original's NBP rate |
| 08 | 51387054c | corrections | - | `BuyerProfile.fromSnapshot`; e-mail and JST/GV kept |
| 09 | 51387054c | unit | - | inFakt / eparagony not live on this stack |
| 10 | 51387054c | corrections | - | Same key returns the same correction |
| 11 | 89859f39b | nip | - | Dashed buyer NIP reaches FA(3) as 10 digits |
| 12 | 89859f39b | nip | - | Dashed seller NIP, Podmiot1 digits only |
| 13 | 51387054c | - | - | `routing-full-path.spec.ts` F2 fills the reason |
| 14 | 60fb55603 | ksef-number | ksef-number/01, 02 | "Pending" and no Art. 108g hint before clearance |
| 15 | 60fb55603 | - | - | The browser no longer hashes, so there is no insecure-context path |
| 16 | 2f63ca116 | - | - | FA3 notes + setup guide |
| 17 | 6ed92115b, 9ce0a8a52 | - | - | Probe reads the token's own permissions (`GET /tokens/{ref}`); the grants query wrongly reported a working owner token as lacking InvoiceWrite |
| 18 | 2e30ddf66, 35b4c4c8b | cross-border | cross-border/01 | Boolean-only, form checkbox, corrections exempt |
| 19 | 89859f39b | nip | - | Unchanged legacy NIP no longer blocks an unrelated save |
| 20 | 2e30ddf66, 35b4c4c8b, 391061270 | fa3-content | fa3-content/01, 02 | Connection defaults + per-invoice KSeF options (split payment, triangulation, Podmiot3, GTU / Procedura per line) |
| 21 | 35b4c4c8b | bulk-pacing | bulk-pacing/01, 02 | "Issued X of N"; save warnings stay on screen |
| 22 | 2e30ddf66, 35b4c4c8b | unit | - | Exemption basis configurable; a placeholder warns. No `zw` product on the stack |
| 23 | 51387054c, 5da1a3960 | corrections | - | Same NIP: Podmiot2K; NIP change asks first, then issues |
| 24 | 51387054c | corrections | - | Buyer-only KOR: TypKorekty 1, no FaWiersz, cleared by KSeF |
| 25 | 51387054c, 21ae710a7 | corrections | corrections/02 | 256 code points, in the form and at the API |
| 26 | 51387054c, 5da1a3960, 02d341311 | gate | gate/01-04 | Manual issue asks (409) then issues; partial refund after issue is flagged |
| 27 | 89859f39b | unit | - | Table A then B over a date range |
| 28 | 2e30ddf66, 35b4c4c8b | nip | nip/01 | Warns, never blocks |
| 29 | 60fb55603 | fa3-content | fa3-content/02 | Preview shows annotations and other parties |
| 30 | 2e30ddf66, 5da1a3960 | fa3-content | - | JST=1 with no Podmiot3 asks first; **KSeF TEST accepted it** once confirmed |
| 31 | 2e30ddf66 | fa3-content | - | Margin: P_PMarzy + P_13_11, no per-line P_12; KSeF TEST accepted |
| 32 | 51387054c, 21ae710a7 | corrections | corrections/01 | Recommended, warns once; a KOR with no reason was cleared |
| 33 | 89859f39b | unit | - | Issuer's calendar day (Europe/Warsaw) |
| 34 | 2e30ddf66 | unit | - | Empty basis trimmed to absent |
| 35 | 2e30ddf66 | unit | - | - |
| 36 | 89859f39b | unit | - | Non-JSON 200 wrapped |
| 37 | 89859f39b | unit | - | - |
| 38 | 51387054c | unit | - | Prefix-tolerant check |
| 39 | 89859f39b | unit | - | - |

### Found during the live run (not fixed here; for a decision)

1. **A foreign buyer charged no VAT is invoiced at 23%.** A German buyer paid the
   net price (PrestaShop applied no Polish VAT), but the order line carries the
   CATALOGUE rate `23`, so the cross-border guard steps aside (by design since
   ADR-063: a shop-stated rate means the band was chosen in the catalogue) and
   KSeF accepted an invoice stating 23% VAT on that sale. The catalogue rate is
   the product's Polish rate, not what this order was charged. Needs an ADR-063
   decision: should a line use the rate the shop actually charged on the order?
2. **A source with no destination clogs the realtime lane.** With KSeF invoicing
   and a shop master but no destination shop (a legitimate invoicing-only
   setup), every `marketplace.order.sync` stores the order and then throws "No
   OrderProcessorManager destinations available", spending its whole retry
   ladder in the realtime lane. 118 such retries delayed new orders by minutes.
3. **Re-syncing a cancelled PrestaShop order drops the line's VAT rate** and
   briefly returns the record to "awaiting product mapping"; an issue landing in
   that window answers 422 "buyer details are unavailable".
4. **The Sales document column overflows a 1280 px window** when the FA(3)
   preview is open: `.detail-section` is a grid with no `minmax(0, 1fr)` column,
   so the preview's table sets the panel width. The same CSS is on `main`.
5. The order header shows the "CANCELLED" badge twice.
6. After a successful bulk issue the failed rows stay listed as FAILED until the
   page is reloaded.

### Stack facts worth knowing before a re-run

- The cloned KSeF token was dead (status 450); a fresh TEST token was supplied
  for NIP 9151704181 and stored only in the clone.
- The shop had Germany switched off; it was switched on for the run (restore:
  `UPDATE ps_country SET active=0 WHERE id_country=1`).
- PrestaShop stores PLN's conversion rate as 4.3 (relative to EUR) while PLN is
  the default currency; `ksefOrder` only converts for a non-default currency.
- "E2E Pricing" products carry price rules the cart does not apply; `ksefOrder`
  skips any product whose computed price disagrees with its base price.
