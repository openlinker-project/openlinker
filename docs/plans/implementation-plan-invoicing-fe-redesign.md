# Implementation Plan: Invoicing FE Redesign + Gap-Fill (KSeF + Subiekt + Common Base)

**Date**: 2026-06-25
**Status**: Draft — feeds `/frontend-design:frontend-design`
**Estimated Effort**: ~3 waves; A ≈ 4–6 d, B ≈ 4–6 d, C ≈ backend-gated (FE ≈ 3–4 d once seams land)

> **Process note.** This plan is the engineering roadmap. The next step is
> `/frontend-design:frontend-design` per screen, which produces the visual
> design. **All `/frontend-design` output (design docs, mockups, copy,
> annotations, component/file names) MUST be in ENGLISH.** No new GitHub issues
> are created for this program (user directive) — existing issues are reused;
> work lands across the in-flight KSeF FE branch + one new neutral-base PR (see
> §11 Reconciliation & Delivery).

---

## 1. Task Summary

**Objective**: Redesign and complete the operator-facing invoicing UI in
`apps/web` as a cohesive surface built on a **thick neutral base + thin
per-provider slots**, covering both invoicing providers (KSeF direct-transmit;
Subiekt-via-bridge) plus the missing screens (invoice detail, status timeline,
re-issue/correction, sanitized failure reasons, batch ops, doc-type config).

**Context**: The neutral invoicing FE merged today (#1211: `OrderInvoicePanel`,
`/invoices` list, Subiekt connection settings) is a thin first cut. KSeF FE is
mid-flight as a draft stack (#1191, #1232–#1235) built off a **pre-#1211**
baseline that re-implements parallels (a second `/invoices`, a second panel).
This program unifies all of it on one neutral base, completes the gap screens,
and re-homes the KSeF work onto provider slots.

**Classification**: Frontend (design + implementation). Backend changes are
explicitly **out of scope** here and handed off as separate tasks (§9); the FE
is designed to the target core contract.

---

## 2. Scope & Non-Goals

### In Scope (full A + B + C)
- **Wave A — Neutral base**: redesign `OrderInvoicePanel` + `/invoices` list;
  new invoice **detail page** (`/invoices/:invoiceId`); status **timeline**
  (static stepper); sanitized **failure-reason** display; empty/loading/error
  polish; batch operations (multi-select issue/retry).
- **Wave B — Per-provider slots**: KSeF connection wizard + seller profile;
  UPO preview/download; FA(3) visualization; KSeF-number surfacing; Subiekt
  parity (regulatory badge once its reader lands).
- **Wave C — Backend-gated FE**: re-issue (state-dependent) + per-provider
  **correction** flow; with/without-tax-id list filter; per-provider
  **document-type config**.
- **One new FE plugin slot**: `PlatformContribution.invoiceDetailSection` +
  a per-provider **correction-flow** slot (see §3, §6).

### Out of Scope
- All backend changes (handed off as separate tasks — §9). FE designs to the
  target contract and feature-gates affordances whose seam is absent.
- New GitHub issues for this program (reuse existing).
- Bulk export, invoice template/mapping editor, regulatory-webhook UI,
  separate analytics dashboard.
- **Receipts / fiscalization** (paragony, fiscal printers → MF fiscal system).
  KSeF carries only structured FA(3) **invoices** (B2B/B2G); receipts are a
  separate fiscal path. The UI issues **invoices only** — there is **no
  document-type picker** anywhere. Core's open-world `DocumentType` keeps
  `receipt`/others for the future, but no surface offers them. (The simplified-
  invoice nuance — paragon with NIP ≤ 450 zł — is also out of scope.)
- Closing/superseding the in-flight KSeF FE PRs — they are **reworked in
  place** (§11).

### Constraints
- ZERO `platformType === 'x'` literals outside `apps/web/src/plugins/`
  (ESLint-enforced). Per-provider variance flows through `usePlatform()` slots
  and `connection.supportedCapabilities.includes(...)` capability gates.
- FE dependency rules (`app → pages → features → shared`; `shared` ⊄ features).
- Resource-constrained dev machine: never run the full pre-commit hook; scope
  checks to `apps/web` (`pnpm --filter @openlinker/web lint|type-check|test`).

---

## 3. Architecture Mapping

**Target layer**: App/Frontend only — `apps/web/src/{features/invoicing,
pages/invoicing,plugins/{ksef,subiekt},shared/plugins}`.

**Contracts consumed (neutral core, ADR-026)** — verified on `origin/main`:
- `InvoiceStatus` = `pending | issued | failed`.
- `RegulatoryStatus` = `not-applicable | submitted | cleared | accepted |
  rejected` — **FE `invoicing.types.ts` already matches core verbatim** (no
  drift; an earlier diagnosis note was a misreport).
- `DocumentType` open-world (`invoice|receipt|credit-note|corrected|proforma|
  prepayment`), POST field stays `string`.
- HTTP API (merged #1203/#1174): `POST /invoices`, `GET
  /orders/:orderId/invoice?connectionId=`, `GET /invoices` (filters
  status/connectionId/regulatoryStatus/issuedFrom/issuedTo, limit/offset).
- `InvoiceRecordResponseDto` OMITS `errorMessage` (PII) and `idempotencyKey`.

**Existing FE assets reused**:
- `features/invoicing/` barrel: `OrderInvoicePanel`, `useOrderInvoiceQuery`,
  `useIssueInvoiceMutation`, `useInvoicesQuery`, `invoicingQueryKeys`,
  transport types. Internal: `invoice-status-badge`, `regulatory-status-badge`,
  `invoice-pdf-link`, `document-type-select`, `resolveIssueErrorMessage`.
- `pages/invoicing/invoices-list-page.tsx`.
- `plugins/subiekt/` (structured section, credentials panel, setup route,
  `subiekt-capability-descriptors.ts`).
- Plugin contract `shared/plugins/plugin.types.ts` — slots
  `StructuredConfigSection`, `CredentialsPanel`, `ConnectionActions`,
  `setupCard`, `capabilityDescriptors`, `OfferValidationContribution`, etc.
- Shared UI: `StatusBadge` (7 tones, `pulse`), `DataTable`, `Dialog`/
  `ConfirmDialog`, `FormField`, `PageLayout`, `KeyValueList`, `Tabs`,
  `SetupStepper`, `EmptyState`/`ErrorState`/`LoadingState`, `BulkActionBar`.

**New FE components required** (see §6 for the slot/neutral split):
- `PlatformContribution.invoiceDetailSection?: ComponentType<{ invoice:
  InvoiceRecord; connection: Connection }>` — content-only, `usePlatform`-
  resolved, capability-gated by the caller. Reused by panel + list-row +
  detail page.
- `PlatformContribution.invoiceCorrectionFlow?` — per-provider correction
  form/modal (different steps per integration; see §6/D-Q user decision).
- `plugins/ksef/` plugin folder (does not exist on main).
- Neutral: invoice detail page + route, status timeline, failure-reason
  surface, batch action bar wiring, a `use-invoice-query` (detail) +
  `use-regulatory-document` (UPO/FA(3)) hook.

**Core vs Integration**: 100% frontend. The neutral↔provider split is the FE
mirror of ADR-026 — no new ADR required for the architecture (the existing
ADR-026 governs it). The two new FE plugin slots are additive, mirroring the
established `StructuredConfigSection`/`bulkOfferRowSection` precedent, so they
do not warrant a standalone ADR. (A backend ADR may be warranted for the
sanitized-failure-code enum — that decision belongs to the backend task, §9.)

---

## 4. External / Domain Research

### Provider posture (drives slot variance)
- **KSeF** (`ksef.publicapi.v2`, draft #1189): OL transmits directly →
  implements `RegulatoryTransmitter`. Connection config: `env`
  (`test|demo|prod`, required) + nested `seller{nip,name,address}` (required at
  issue). Credentials: `authType` (`ksef-token|qualified-seal`) + `secretRef`.
  Doc types: `invoice`, `corrected` (KOR). Surfaces: KSeF number, UPO download,
  FA(3) XML.
- **Subiekt** (`subiekt.invoicing.v1`, merged): bridge-transmits to KSeF
  natively → today implements `InvoicingPort` only; `RegulatoryStatusReader`
  lands via **#1230**. Config: `bridgeBaseUrl` (SSRF-guarded) + optional
  `timeoutMs`; credentials: optional `bridgeToken`. Doc types: `invoice` (FV),
  `receipt` (PA). Corrections via bridge: **#1229** (bridge KOR endpoint =
  bridge-repo issue #6). Bridge now exposes a **real PDF endpoint** (bridge PR
  #4/#5) → `pdfUrl` can be populated.
- **⚠️ Verify before live-data wiring**: the OL Subiekt adapter calls
  `/api/invoices`, `/api/customers/upsert`, `/api/invoices/{id}/status`; the
  .NET bridge historically exposed `/api/faktury`, `/api/kontrahenci/upsert`,
  `/api/faktury/{id}/status`. The bridge's hexagonal refactor (PR #1/#5) may
  have reconciled this. Backend/bridge concern — does not block FE design, but
  E2E on Subiekt is blocked until confirmed.

### Capability-driven rendering
Regulatory affordances render off `connection.supportedCapabilities` +
provider `capabilityDescriptors` (the `'Show KSeF status badge'` label is
already provider-supplied for Subiekt). KSeF auto-gets the regulatory section
via its `RegulatoryTransmitter` capability; Subiekt gets it once #1230 ships.

---

## 5. Questions & Assumptions

### Resolved (grill-me, locked)
- Deliverable = design + FE impl; backend separate. Architecture = thick
  neutral base + thin per-provider slots. Scope = full A+B+C. Re-issue =
  state-dependent (Retry for failed/pending; Correction for issued). Timeline =
  static stepper. Correction form = **per-provider slot** (different steps per
  integration — "a form for everything = a form for nothing"). Reconciliation =
  rework in-flight KSeF PRs in place; separate PR for merged base; minimize new
  issues; create nothing yet.

### Open (need confirmation before the relevant wave; do not block A)
- **D-Q1 (detail-page seam)**: no `GET /invoices/:invoiceId` exists (only
  `getForOrder` + `list`). Assumption: add a backend seam (§9); interim,
  detail page can hydrate from `list` filtered by id or from `getForOrder`.
- **D-Q2 (re-issue/correction trigger seam)**: `POST /invoices` 409s on issued.
  Correction needs a backend trigger (KSeF KOR #1151 / Subiekt #1229).
  Assumption: per-provider correction slot calls a provider-specific endpoint;
  FE designs the form, backend exposes the trigger.
- **D-Q3 (failure-code seam)**: DTO omits `errorMessage`. Assumption: backend
  adds a PII-free `failureCode` enum + optional `failureReason`; FE renders
  `failureCode → localized copy`. Until then, failure-reason display shows the
  existing generic copy (graceful degradation).
- **D-Q4 (batch endpoint)**: no bulk issue/retry endpoint. Assumption: backend
  adds one; FE multi-select degrades to per-row sequential calls if absent.

### Documentation gaps
- None blocking. `docs/frontend-architecture.md` slot reference will need a row
  added for `invoiceDetailSection` + `invoiceCorrectionFlow` when they land.

---

## 6. Proposed Implementation Plan

> Each wave is independently shippable. Wave A is pure FE with no backend
> dependency (except the detail-page seam D-Q1, which has an interim path).
> The neutral/slot split per screen is the §6.0 table.

### 6.0 Neutral base vs per-provider slot — per-screen ownership

| Surface | Ownership | Mechanism |
|---|---|---|
| `OrderInvoicePanel` | **Neutral** + optional provider extras | `invoiceDetailSection` slot, capability-gated |
| `/invoices` list (+ per-row KSeF#/UPO action) | **Neutral** | `invoiceDetailSection` (row variant) / `usePlatform` per row |
| Invoice **detail** page shell | **Neutral** + provider extras | `invoiceDetailSection` slot |
| Status **timeline** (stepper) | **Neutral** | none. Success terminal = `accepted` (KSeF maps `200 → accepted`); `cleared` is reserved for split-clearance regimes and no current provider emits it |
| **Issuance state machine** (`pending` / `issuing` / `issued` / `failed·rejected` / `in-doubt`) | **Neutral** | reads `status` + `failureMode` from the DTO. `issuing` (live lease) and `in-doubt` → **no blind Retry** |
| Failure / in-doubt display | **Neutral** | `rejected` → directive error + Retry (nothing issued); `in-doubt` → warning + "check provider / mark resolved", **never auto-retry** (duplicate-document risk, #1200) |
| Connection-health affordance (`needs_reauth` / `error`) | **Neutral** | reads `connection.status`; surfaces a re-authenticate CTA instead of hiding the panel |
| Batch ops (retry only `rejected`) | **Neutral** | `BulkActionBar` — skips `issued` and `in-doubt` rows |
| Connection wizard + seller profile | **Per-provider slot** | `setupCard` + `StructuredConfigSection` + `CredentialsPanel` |
| UPO preview/download | **Neutral hook** + provider slot | `use-regulatory-document` (neutral) + `invoiceDetailSection` affordance |
| FA(3) visualization | **Per-provider slot** | `invoiceDetailSection` (KSeF) |
| Correction form | **Per-provider slot** | `invoiceCorrectionFlow` slot |
| Document-type config | **Per-provider slot** | new connection-edit slot, driven by `getSupportedDocumentTypes()` |

### Wave A — Neutral base (no backend dependency; start immediately)

**A0. Add the `invoiceDetailSection` slot to the plugin contract**
- **File**: `apps/web/src/shared/plugins/plugin.types.ts` (+ doc row in
  `docs/frontend-architecture.md`).
- **Action**: Add `invoiceDetailSection?: ComponentType<{ invoice:
  InvoiceRecord; connection: Connection }>` to `PlatformContribution`
  (content-only; mirrors `bulkOfferRowSection`). Resolve via
  `usePlatform(connection.platformType)`; the host caller owns the capability
  gate. **Note** the `shared/plugins` feature-import allow-list: `InvoiceRecord`
  must be importable — re-export the type from `features/invoicing` and, if the
  ESLint allow-list disallows it, hoist `InvoiceRecord` to a `shared/types`
  boundary (follow the `EditConnectionFormValues` exemption precedent).
- **Acceptance**: type-check passes; an absent slot renders nothing.

**A1. Redesign `OrderInvoicePanel` + `/invoices` list (visual + IA pass)**
- **Files**: `features/invoicing/components/order-invoice-panel.tsx`,
  `features/invoicing/components/invoice-status-badge.tsx`,
  `features/invoicing/components/regulatory-status-badge.tsx`,
  `pages/invoicing/invoices-list-page.tsx`.
- **Action**: Apply the `/frontend-design` output: clearer status hierarchy,
  regulatory affordance placement, connection-picker UX when an order has >1
  invoicing connection, consistent badge tones, render `invoiceDetailSection`
  for provider extras. Binds only to neutral core types. Specifically:
  - **Full issuance state machine** on the panel: `pending`, `issuing` (live
    lease — locked, no action), `issued`, `failed·rejected` (Retry), and
    `in-doubt` (warning, **no Retry** — "check provider / mark resolved").
    Gate Retry on `failureMode === 'rejected'` only.
  - **Connection-health**: when the resolved invoicing connection is
    `needs_reauth`/`error`, render a re-authenticate affordance instead of
    issue/status (don't silently hide the panel).
  - **`/invoices` list**: add a **Connection/provider column** (`providerType` /
    `connectionId`), a `needs-review` row treatment for `in-doubt`, and the
    bulk-retry confirm that skips `issued`/`in-doubt`.
- **Acceptance**: panel + list render all `InvoiceRecord` fields incl.
  `status:'issuing'` + `failureMode`; an `in-doubt` invoice exposes **no
  one-click Retry**; existing tests updated; `pnpm --filter @openlinker/web
  test` green.

**A2. Invoice detail page (`/invoices/:invoiceId`)**
- **Files**: `pages/invoicing/invoice-detail-page.tsx` (new),
  `features/invoicing/hooks/use-invoice-query.ts` (new),
  `app/routes/invoices.route.tsx` (add child route + `handle.crumb`),
  `nav-registry` unchanged (detail is not a nav item).
- **Action**: Neutral detail shell — all `InvoiceRecord` fields, regulatory
  status, clearance reference, PDF link, document type, timestamps, timeline
  (A3), failure reason (A5), and the provider `invoiceDetailSection`.
  Data source per D-Q1 (interim: filter `list`/reuse `getForOrder`).
  Carries the same issuance state machine as A1 (incl. `in-doubt` with no blind
  retry) and the per-provider `invoiceCorrectionFlow` trigger for `issued`.
- **Acceptance**: route lazy-loaded (+ `route-lazy`/`route-handle` test counts
  bumped); renders **loading / not-found(404) / error** page states plus the
  per-invoice states.

**A3. Status timeline (static stepper)**
- **File**: `features/invoicing/components/invoice-timeline.tsx` (new).
- **Action**: Two-lane stepper — issuance `created → issued` (with `issuing`
  in-flight + `failed`/`in-doubt` error branches) over clearance `submitted →
  accepted` (terminal success label is **`accepted`**, not `cleared`). Highlight
  current state; show timestamps only where present (`issuedAt`,
  `createdAt`/`updatedAt`). No backend seam.
- **Acceptance**: renders for every status combination; unit-tested.

**A4. Empty / loading / error / skeleton polish**
- **Files**: all `features/invoicing` surfaces + `pages/invoicing`.
- **Action**: Unify feedback states per `docs/frontend-architecture.md § Async
  UX`; retryable errors, skeletons, deliberate empty states.

**A5. Failure-state model + sanitized failure reason**
- **Files**: `features/invoicing/lib/issue-error-message.ts`,
  `order-invoice-panel.tsx`, `invoice-detail-page.tsx`,
  `features/invoicing/api/invoicing.types.ts` (add `'issuing'` to the status
  union + `failureMode?: 'rejected' | 'in-doubt'` + optional sanitized
  `failureCode?`/`failureReason?` once the seam lands).
- **Action**: Drive the **rejected vs in-doubt** split off `failureMode`
  (#1200/#1214). `rejected` → directive error + Retry; `in-doubt` → warning,
  **no Retry**, "check provider / mark resolved" (fiscal-safety: a blind retry
  on an in-doubt row risks a duplicate document). Render neutral
  `failureCode → t()` copy (no PII; the DTO still omits `errorMessage`).
- **Blocked on the §9 DTO seam** (expose `status:'issuing'` + `failureMode`
  [+ optional `failureCode`]). Until then the FE shows generic copy and treats
  any non-`rejected` failure as in-doubt (fiscal-safe default).

### Wave B — Per-provider slots (KSeF; absorbs the in-flight stack)

**B1. KSeF plugin scaffold + connection wizard** — `plugins/ksef/index.ts`,
`plugins/ksef/ksef-setup.route.tsx`, `features/connections/components/
ksef-setup.schema.ts`, `plugins/ksef/components/ksef-structured-section.tsx`,
`ksef-credentials-panel.tsx`. Register in `plugins/index.ts`. **Reuses #1152 /
reworks PR #1191**. Salvage #1191's Zod schemas + NIP normalization.
Wizard fields: **Connection & access** (name, `env`, `authType`, write-only
token — the 4 required to connect) + the **neutral invoice trigger-model**
(`config.invoicing.triggerModel`: manual / auto-on-paid / auto-on-shipped — read
by #1120/#1206 for *every* invoicing connection, so KSeF carries it too, not
just Subiekt). KSeF success label is **`accepted`** everywhere (never `cleared`).

**B2. KSeF full seller profile in wizard** — extend B1 with nested
`config.seller.{nip,name,address}` + shared create/edit assembly helper.
**Reuses #1223 / reworks PR #1232**.

**B3. UPO preview + download (neutral hook + KSeF slot affordance)** —
`features/invoicing/hooks/use-regulatory-document.ts` (neutral blob fetch via
`requestBlob`/`ApiError`); KSeF `invoiceDetailSection` renders sandboxed-iframe
preview + download (salvage #1234's `sandbox=""`, object-URL lifecycle,
content-type allowlist). **Reuses #1221 / reworks PR #1234. DEPENDS-ON the
UPO/RegulatoryDocument backend seam (#1224 / PR #1231 — keep it).**

**B4. KSeF number + clearance reference surfacing** — render neutral
`regulatoryStatus`/`clearanceReference` in panel/list/detail; KSeF-specific
labels via `capabilityDescriptors` (no literal in shared UI). **Reuses part of
#1152 / absorbs #1235's KSeF columns**.

**B5. Full FA(3) visualization (HTML/PDF) + XML download** — KSeF
`invoiceDetailSection` rendering human-readable FA(3) + XML download, via the
B3 document hook extended to FA(3) doc kinds. **Reuses #1228. DEPENDS-ON the
FA(3) XML persistence backend seam (§9).**

**B6. Subiekt regulatory parity** — no extra FE work beyond ensuring the
regulatory badge/section is provider-agnostic + capability-gated; it lights up
for Subiekt once **#1230** (`getClearanceStatus`) ships.

### Wave C — Backend-gated FE

**C1. Re-issue / correction** — state-dependent affordance on panel + detail:
`failed/pending → Retry` (existing mutation, controller-owned dedup); `issued →
Issue correction` opening the **per-provider `invoiceCorrectionFlow` slot**
(new slot, per-provider steps). **Reuses #1220 / reworks PR #1233. DEPENDS-ON
the correction-trigger seam (#1151 KSeF KOR / #1229 Subiekt) + #1200.**

**C2. Batch operations** — multi-select on `/invoices` → bulk issue/retry via
`BulkActionBar`; neutral, capability-gated. **DEPENDS-ON a batch endpoint (§9);
degrades to sequential per-row calls if absent.**

**C3. With/without-tax-id list filter** — one filter control + URL param on
`/invoices`. **DEPENDS-ON #1202 (backend denormalization).**

**C4. (DROPPED — invoice-only scope).** Receipts are out of scope, so issuance
is always an invoice; no document-type picker or per-provider doc-type config
is needed. `getSupportedDocumentTypes()` still informs the (now fixed) "Invoice"
label but drives no UI choice.

### Implementation details
- **New components**: invoice detail page, `invoice-timeline`,
  `use-invoice-query`, `use-regulatory-document`, `plugins/ksef/*`, two new
  plugin slots (`invoiceDetailSection`, `invoiceCorrectionFlow`), doc-type
  config slot.
- **Config changes**: none (no new env vars).
- **Migrations**: none (FE only).
- **Events**: none.
- **Error handling**: `ApiError` normalization (existing); capability-disabled
  discriminator via `CapabilityErrorBody` (existing); failure-code copy table.

---

## 7. Alternatives Considered

- **Cienka baza, grube ekrany per-provider** (separate rich KSeF/Subiekt
  panels): rejected — duplicates list/panel/detail per provider, risks
  base↔provider drift, more code. Locked decision = thick neutral base.
- **Supersede the in-flight KSeF FE PRs (close + recreate)**: rejected by user
  — work not on main is reworked **in place** in its existing PR/branch;
  minimizes new artifacts and preserves review history.
- **Force-supersede re-issue (one button overwriting an issued doc)**:
  rejected — fiscally unsound; corrections are the legal mechanism. Locked =
  state-dependent Retry/Correction.
- **Generic correction form for all providers**: rejected by user — per-
  provider slot with integration-specific steps ("a form for everything = a
  form for nothing").
- **Event-sourced timeline**: rejected — needs a new backend events table;
  static stepper chosen (core has no transition timestamps).

---

## 8. Validation & Risks

- **Architecture compliance** ✅ — neutral base + `usePlatform` slots, no
  `platformType` literals, FE dependency direction respected.
- **Naming** ✅ — `kebab-case.tsx` files, `use-*.ts` hooks, `*.route.tsx`,
  `*.test.tsx`; feature public barrel only.
- **Risks**:
  - *In-flight KSeF stack divergence* — PRs #1191/#1232–#1235 branched
    pre-#1211; reworking them onto post-#1211 main is a rewrite, not a rebase.
    Mitigation: rebase onto main, re-home onto `features/invoicing` +
    `plugins/ksef`, salvage reviewed logic (Zod/NIP/iframe/object-URL).
  - *Backend seams (D-Q1–4)* gate A5/B3/B5/C1–C3. Mitigation: each FE
    affordance feature-gates and degrades gracefully when its seam is absent;
    Wave A core ships without any seam.
  - *Subiekt bridge endpoint mismatch* — blocks Subiekt E2E (not design).
    Mitigation: verify/handoff to backend before live Subiekt testing.
  - *`shared/plugins` feature-import allow-list* — adding `InvoiceRecord` to
    the slot prop may require an ESLint allow-list edit or a `shared/types`
    hoist (precedent exists). Mitigation: A0 handles it explicitly.
- **Backward compatibility**: redesigned neutral components keep the same
  public barrel exports; the new slot is additive (absent ⇒ no render).

---

## 9. Backend Seams to Hand Off (separate tasks — design FE to target contract)

| Seam | Drives | Existing issue / status |
|---|---|---|
| `GET /invoices/:invoiceId` | A2 detail page | NEW (interim: `list`/`getForOrder`) |
| Issued-document **content** projection (seller, buyer/recipient, line items, net/VAT/gross, dates, payment) | A2 detail "Invoice contents" card | NEW — **not on `InvoiceRecord`** (no buyer/lines columns); from the order-snapshot invoice projection (#1224) or the provider document (FA(3)/Subiekt). FE renders it behind this seam; degrades to order-sourced preview if absent. |
| **Expose `status:'issuing'` + `failureMode` (`rejected`\|`in-doubt`) on the response DTO** | A1/A5 issuance state machine — the FE can't render the rejected-vs-in-doubt split (and therefore can't suppress the unsafe Retry) without these | #1200 / PR #1214 add the columns/logic; **the response DTO must surface them** (it currently exposes only `status` pending/issued/failed). Without it the FE treats every failure as in-doubt (fiscal-safe default) — degraded but correct. |
| PII-free `failureCode` (+`failureReason`) on response DTO | A5 | NEW (may warrant a small backend ADR) |
| Connection `status` (`needs_reauth`/`error`) on the connections read | A1 connection-health affordance | **EXISTS** — `ConnectionStatus` already carries these; FE just consumes `connection.status`. No new seam. |
| Neutral `config.invoicing.triggerModel` on the connection (KSeF + Subiekt) | B1/B2 wizard trigger-model | **EXISTS** — #1120/#1206 read it generically for every invoicing connection; FE writes it on the KSeF wizard too. No new seam. |
| UPO / `RegulatoryDocument` endpoint + order-snapshot projection | B3 | #1224 / PR #1231 (in flight — **keep**) |
| FA(3) XML persistence + fetch | B5 | #1228 (backend half) |
| Correction trigger (per provider) | C1 | #1151 (KSeF KOR), #1229 (Subiekt) — corrections cover quantity and price per line |
| Exactly-once (re-issue safety) | C1 | #1200 / PR #1214 |
| Batch issue/retry endpoint | C2 | NEW |
| Tax-id denormalization on `invoice_records` | C3 | #1202 |
| Subiekt `RegulatoryStatusReader.getClearanceStatus` | B6 | #1230 |
| Subiekt bridge endpoint-path reconciliation | Subiekt E2E | verify (bridge repo) |

---

## 10. Testing Strategy & Acceptance Criteria

- **Unit (Vitest + Testing Library)**, colocated `*.test.tsx`: redesigned
  panel/list/detail render states; timeline per status combination;
  failure-code copy resolution; `use-invoice-query`/`use-regulatory-document`
  hooks; KSeF wizard schema validation + NIP normalization; slot resolution via
  `usePlatform` (absent ⇒ no render). Mock the API client; never hit network.
- **Route contract**: bump `EXPECTED_LAZY_ROUTE_COUNT`
  (`route-lazy.test.ts`) + add `handle.crumb` (`route-handle.test.ts`) for the
  detail route.
- **Lint guard**: confirm zero `platformType` literals outside `plugins/`
  (existing ESLint rule).
- **Commands (scoped — never the full hook)**: `pnpm --filter @openlinker/web
  lint && pnpm --filter @openlinker/web type-check && pnpm --filter
  @openlinker/web test`.
- **Acceptance**:
  - [ ] All neutral screens bind only to core types; provider extras only via
    slots; no `platformType` literals outside `plugins/`.
  - [ ] KSeF affordances render exclusively through `plugins/ksef` slots +
    capability gates; one `/invoices` page, one `OrderInvoicePanel`.
  - [ ] Detail page, timeline, redesigned panel/list, batch select ship in A;
    KSeF wizard/UPO/FA(3) in B; re-issue/correction/filters in C.
  - [ ] Backend-gated affordances degrade gracefully when their seam is absent.
  - [ ] **Fiscal-safety**: an `in-doubt` (or unknown) failure never exposes a
    one-click Retry on panel, detail, or bulk; `issuing` is shown as a locked
    in-flight state; Retry is gated on `failureMode === 'rejected'`.
  - [ ] Clearance success renders as **`accepted`** (no `cleared` label for KSeF).
  - [ ] Invoice detail renders **loading / not-found / error** page states; the
    `/invoices` list shows a **connection/provider** column.
  - [ ] `/frontend-design` design artifacts are in English.
  - [ ] `apps/web` lint + type-check + test green.

---

## 11. Reconciliation & Delivery (PR strategy — no new issues)

- **On `main` already (#1211 neutral base + Subiekt plugin)** → redesign in a
  **NEW separate PR** (`feat(web): invoicing UI redesign — neutral base`).
  Carries A0–A5 + C2–C4 neutral parts. Reuses no new issue (or attaches to an
  existing umbrella if one is later designated).
- **NOT on `main` (KSeF FE stack #1191/#1232–#1235 on branch
  `1152-web-ksef-connection-upo`)** → rework the redesign **IN those existing
  PRs/branch** (rebase onto post-#1211 main, re-home onto `features/invoicing`
  + `plugins/ksef`). Carries B1–B5 + C1. Reuses issues
  #1152/#1220/#1221/#1222/#1223/#1228.
- **Keep** backend PR #1231 (#1224 UPO seam).
- **No new GitHub issues** created for this program (user directive); **create
  nothing yet** — this plan + `/frontend-design` first.

---

## 12. Alignment Checklist

- [x] Frontend-only; respects `app→pages→features→shared` + neutral/slot split
- [x] No `platformType` literals outside `plugins/` (capability-gated)
- [x] Reuses existing slot/registry patterns (one additive slot per new need)
- [x] Idempotency: re-issue is controller-owned dedup; correction is explicit
- [x] Async UX states (loading/empty/error/success) on every screen
- [x] Error handling: `ApiError` + sanitized failure-code copy
- [x] Testing strategy scoped to `apps/web` (resource-constrained machine)
- [x] Naming + file-structure conventions followed
- [x] Backend seams enumerated + handed off; FE degrades gracefully
- [x] `/frontend-design` output mandated in English
- [x] Plan saved as markdown

---

## Related Documentation
- `docs/architecture-overview.md` (Invoicing context, ADR-026 neutral core)
- `docs/frontend-architecture.md` (plugin slots, `usePlatform`, dependency rules)
- `docs/frontend-ui-style-guide.md` (visual vocabulary for `/frontend-design`)
- `docs/engineering-standards.md` (naming, types, testing)
