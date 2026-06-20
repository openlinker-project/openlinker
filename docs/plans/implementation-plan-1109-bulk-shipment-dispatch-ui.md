# Implementation Plan — #1109 bulk shipment dispatch UI

**Issue:** #1109 — `[IMPL] feat(web): bulk shipment dispatch UI (batch generate-labels + handover protocol)`
**Branch:** `1109-bulk-shipment-dispatch-ui`
**Layer:** Frontend only (`apps/web`). No backend/core/migration changes — the bulk endpoints are already wired.
**Effort:** S–M (FE-only, but the per-order-override dialog + eligibility pre-flight push it past trivial).

---

## 1. Understand the task

Surface the already-shipped bulk-fulfillment backend as an operator UI. Two endpoints exist and are consumed **as-is**:

- `POST /shipments/bulk/generate-labels` — body `{ sourceConnectionId, items: BulkDispatchItem[1..25] }`, returns **200** `{ results: PerOrderDispatchResult[] }` where each result is `{ kind: 'dispatched', orderId, shipment } | { kind: 'omp_fulfilled', orderId } | { kind: 'failed', orderId, error }`. Partial failure is normal (200 with mixed results).
- `POST /shipments/bulk/protocol` — body `{ shipmentIds: string[1..25] }`, returns **binary** (provider MIME) carrier handover protocol.

Each `BulkDispatchItem` is the single-order `GenerateLabelInput` minus `sourceConnectionId` — i.e. a full dispatch payload: derived `recipient`/`deliveryIntent`/`paczkomatId` + operator-supplied `parcel` (dims + weight) + optional `cod`.

**Non-goals (issue-stated):** backend changes; auto-dispatch/scheduling; bulk cancel.

### Decisions locked with the user (design fork)

1. **Entry point:** the **orders list page** (`apps/web/src/pages/orders/orders-list-page.tsx`) — dispatch starts pre-shipment, from orders.
2. **COD / manual-input orders:** **excluded from bulk** and surfaced as "dispatch individually" with a reason (never silently dropped). Bulk only handles orders whose payload is fully derivable from the snapshot + the shared parcel.
3. **Parcel:** **shared default + per-order override** — one L×W×H + weight pre-fills every selected order; each row can be tweaked before submit.

### Two connection axes (drives the multi-source + protocol decisions)

The endpoints expose **two distinct connection axes**, and the UX honors both:

- **Source connection** — `POST /shipments/bulk/generate-labels` takes one `sourceConnectionId` per request. **Decision: multi-source via fan-out.** The operator selects freely across sources; the FE **groups the selection by `sourceConnectionId` and fires one bulk request per group** (each group capped at 25), then merges the per-order results into one view. No backend change; no source-filter friction.
- **Carrier connection** — `POST /shipments/bulk/protocol` rejects mixed-carrier batches (asserts a single carrier `connectionId`). A dispatched batch can span carriers (different delivery methods route differently), so **Decision: one protocol download per carrier** — after dispatch, group dispatched shipments by their carrier `connectionId` and render one "Download {carrier} protocol" action per group.

The 25-cap is therefore **per source-group**, enforced at selection time (an order whose source-group is already at 25 shows a disabled checkbox with a "Max 25 per source" tooltip).

---

## 2. Research (done — key reuse map)

| Need | Reuse / precedent | Path |
|---|---|---|
| Multi-select on a list | `Set<string>` local state + header tri-state + 25 cap (no URL state) | `apps/web/src/pages/products/products-list-page.tsx` (#739) |
| Checkbox cell | `CheckboxCell` — **currently page-local in products**; lift to `shared/ui` | `shared/ui/` (new) |
| Bulk action bar | `BulkActionBar` (count + hint + actions, sticky, a11y) | `shared/ui/bulk-action-bar.tsx` |
| Per-order payload build | `buildGenerateLabelInput` + `detectMissingFields` + locker/courier classify — **currently private in the single form**; extract to `orders/lib` | `features/orders/components/generate-label-form.tsx` |
| Snapshot parse (recipient, address, pickupPoint, paymentStatus, shipping.method) | `parseOrderSnapshot` / `ParsedOrderSnapshot` | `features/orders/api/order-snapshot.schema.ts` |
| Binary download (imperative blob → `<a download>`) | `useLabelDownload` pattern (GET); protocol is POST-with-body via `requestBlob(path, init)` | `features/shipments/hooks/use-label-download.ts` |
| Modal / confirm | `ConfirmDialog`, `Dialog` (radix-wrapped) | `shared/ui/` |
| Result list | `StructuredErrorList` for failures + a compact success summary | `shared/ui/structured-error-list.tsx` |
| Toasts | `useToast()` | `shared/ui/toast-provider.tsx` |

API-client seam: `createShipmentsApi(request, requestBlob)` composed in `app/api/api-client.ts`; tests via `createMockApiClient({ shipments: {...} })` in `test/test-utils.tsx`.

---

## 3. Design

### 3.1 Data layer — `features/shipments`

- **`api/shipments.types.ts`**: add
  - `BulkDispatchItem = Omit<GenerateLabelInput, 'sourceConnectionId'>`
  - `BulkGenerateLabelsInput { sourceConnectionId: string; items: BulkDispatchItem[] }`
  - `PerOrderDispatchResult` union (`dispatched | omp_fulfilled | failed`) + `BulkDispatchResult { results: PerOrderDispatchResult[] }`
- **`api/shipments.api.ts`**: add to `ShipmentsApi`
  - `bulkGenerateLabels(input): Promise<BulkDispatchResult>` → `POST /shipments/bulk/generate-labels`
  - `downloadProtocol(shipmentIds: string[]): Promise<Blob>` → `requestBlob('/shipments/bulk/protocol', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ shipmentIds }) })`
- **`hooks/use-bulk-generate-labels-mutation.ts`**: `useMutation` → invalidates `shipmentsQueryKeys.all` **and** `ordersQueryKeys.all` (dispatch flips order fulfillment) on success.
- **`hooks/use-protocol-download.ts`**: imperative blob-download hook mirroring `useLabelDownload` (filename `ol-handover-protocol.{ext}`, same MIME→ext map — extract the map so it isn't triple-duplicated, or keep local per existing precedent; lean to a tiny shared `lib/label-download.ts` in shipments).
- **`index.ts`** barrel + **`test/test-utils.tsx`** mock: export the new hooks/types; add `bulkGenerateLabels` + `downloadProtocol` to the shipments mock.

### 3.2 Orders dispatch lib — `features/orders/lib/dispatch-input.ts` (new, pure)

Extract from the single form (and refactor the form to import these — anti-drift):
- `buildDispatchItem(order, snapshot, parcel, cod?): BulkDispatchItem` — the snapshot→payload derivation currently in `buildGenerateLabelInput` (recipient/address/deliveryIntent/paczkomat).
- `classifyDispatchEligibility(order): DispatchEligibility` — pure, returns
  - `{ eligible: true, deliveryIntent, paczkomatId? }`, or
  - `{ eligible: false, reason }` where reason ∈ `missing-recipient` (incomplete snapshot per `detectMissingFields`), `needs-paczkomat` (locker method, no buyer-resolved pickup point — would need manual typing), `cod` (COD order — per-order amount needed), `already-dispatched` (`fulfillmentState` dispatched/delivered), `omp-fulfilled`/`not-ready` (recordStatus), `payment-blocked` (snapshot paymentStatus in the #928 blocking set).
- Unit-tested in isolation (this is the risk-bearing logic).

The single `generate-label-form.tsx` keeps its own form UX but calls `buildDispatchItem` so single + bulk produce identical payloads.

### 3.3 Shared primitive — `shared/ui/checkbox-cell.tsx` (lift from products)

Move `CheckboxCell` (+ its CSS) to `shared/ui`; re-point products-list-page to the shared import. Keeps one selection-checkbox implementation.

### 3.4 Orders list page — multi-select + bulk bar

- Local `useState<Set<string>>` selection (not URL state), header tri-state checkbox. The **25-cap is per source-group**: a row whose `sourceConnectionId` group already holds 25 shows a disabled checkbox + "Max 25 per source" tooltip. Selection may span sources freely.
- Selection is offered only for **candidate** rows (not already dispatched/delivered). A selected order that turns out ineligible is still surfaced in the dialog (not blocked at the checkbox) so the reason is visible.
- `BulkActionBar` (count + per-source hint + "Dispatch N") → opens `BulkDispatchDialog`. No single-source guard — multi-source is supported via fan-out (3.5).

### 3.5 `features/orders/components/bulk-dispatch-dialog.tsx` (new)

A `Dialog` with three states:
1. **Compose** — shared parcel profile (L×W×H + weight, RHF + zod, reuse `generate-label-form.schema` parcel bits) at top; a per-order table: order id + recipient summary + **source pill** (the batch may span sources) + eligibility badge. Eligible rows show editable dims/weight pre-filled from the shared profile (override). Ineligible rows show the reason + a "dispatch individually" link to the order detail. Submit is enabled when ≥1 eligible order.
2. **Submitting** — `fieldset disabled`, progress note. The FE groups eligible items by `sourceConnectionId` and **fans out one `bulkGenerateLabels` call per source group** (capped at 25 each — the selection cap guarantees this), awaiting all via `Promise.allSettled` so one source's failure doesn't sink the others.
3. **Result** — merged per-order outcomes across all groups: dispatched (✓ + tracking-pending), omp_fulfilled (info), failed (`StructuredErrorList` with `error`). Dispatched shipments are **grouped by carrier `connectionId`**, rendering **one "Download {carrier} protocol" action per carrier group** (`downloadProtocol(shipmentIdsForThatCarrier)`).

Items posted = eligible orders only, each `buildDispatchItem(order, snapshot, perOrderParcel)`. The dialog owns the **group-by-source fan-out + group-by-carrier protocol** orchestration; the `bulkGenerateLabels` api method stays a thin single-request call matching the endpoint.

### 3.6 Styling

New CSS in `index.css` under a `/* ── Bulk dispatch dialog (#1109) ── */` section, tokens only; every new `--token` (none expected) mirrored to `tokens.ts`. Responsive: the per-order table collapses to stacked cards under `--bp` (reuse DataTable card precedent or a simple stacked layout).

---

## 4. Step-by-step

1. `shared/ui/checkbox-cell.tsx` — lift `CheckboxCell` + CSS from products; re-point products-list-page. *(AC: reuse; no behavior change — products tests still green.)*
2. `features/orders/lib/dispatch-input.ts` — extract `buildDispatchItem` + `classifyDispatchEligibility` (+ move `detectMissingFields`/classify helpers); refactor `generate-label-form.tsx` to import them. *(AC: single-form behavior unchanged; new unit tests pass.)*
3. shipments data layer (3.1) — types + api methods + 2 hooks + barrel + mock. *(AC: type-check; mock supports new methods.)*
4. `bulk-dispatch-dialog.tsx` (3.5) + schema + CSS. *(AC: compose→submit→result states; 25-cap; per-order results; protocol download; ineligible surfaced.)*
5. orders-list-page wiring (3.4) — selection state, checkbox column, single-connection guard, `BulkActionBar`, dialog mount. *(AC: multi-select + cap + bulk trigger.)*
6. Tests (3.7 below) + quality gate.

## 4b. Tests

- `dispatch-input.spec.ts` (unit) — eligibility classifier across all reasons; `buildDispatchItem` payload shape (paczkomat vs courier address derivation).
- `bulk-dispatch-dialog.test.tsx` — happy path (2 eligible → submit → 1 dispatched/1 failed result + protocol button enabled); ineligible order surfaced with reason; 25-cap message; empty-eligible disables submit. `createMockApiClient` for `bulkGenerateLabels` + `downloadProtocol`.
- `use-bulk-generate-labels-mutation` covered via the dialog test (invalidation) or a focused hook test.
- orders-list-page existing test stays green (selection additive).

---

## 5. Validate

- **Architecture:** FE-only; `pages → features → shared` respected (page consumes shipments+orders features; `CheckboxCell` moves *down* to shared). No `shared → features` edge. Server state via TanStack Query; selection + dialog state are local `useState`; parcel form via RHF+zod. ✓
- **Reuse over new:** BulkActionBar, useLabelDownload pattern, parseOrderSnapshot, ConfirmDialog/Dialog, StructuredErrorList all reused; the one extraction (dispatch-input) removes duplication rather than adding it. ✓
- **Contract surfaces:** no barrel removals; additive only (shipments barrel + api + mock). Bulk endpoints consumed as-is — no DTO drift risk since FE types mirror the response union. ✓
- **Honesty ACs:** 25-cap explicit (no silent truncation); ineligible/payment-blocked orders surfaced with reasons; partial-failure results shown per order. ✓
- **Security:** admin-guarded endpoints; no secrets in FE; no auth logic duplicated (payment gate is server-authoritative — FE eligibility is UX only). ✓
- **Responsive:** per-order table → stacked cards; bulk bar sticky. ✓

### Tech-review refinements (folded in)

- **Rejected fan-out group ≠ silent drop.** When a source-group's `bulkGenerateLabels` call rejects (network/5xx), the merge synthesizes a `failed` outcome for every order in that group (carrying the group error) — they must appear in the result table, never vanish. Unit-tested.
- **Per-source cap on "select all".** The 25-cap is per source-group, so the header tri-state toggle caps each source independently (not the first-25). Extracted as a pure `capSelectionPerSource` helper in `orders/lib`, unit-tested; the header all/some/none state reflects the multi-group selection.
- **Overrides reuse the shared zod rules.** Per-order dim/weight overrides validate with the same schema as the shared profile (no bypass that 422s mid-batch). Per-order state is one typed `useReducer`, not a loose map.
- **a11y:** per-order dim/weight inputs carry explicit `aria-label`s including the order id (mirrors the single form).
- **COD coverage:** excluding COD from v1 bulk is tracked as a fast-follow on #1109 (PL is COD-heavy).

### Risks / open items
- **Per-order-override surface** is the main scope risk — keep the per-order row minimal (dims+weight only; everything else derived/read-only).
- **Fan-out orchestration** (group-by-source dispatch + group-by-carrier protocol) is the second scope risk — keep it as pure grouping helpers in `orders/lib` (testable) with `Promise.allSettled` so a partial group failure degrades gracefully. This is the bulk of the M-effort.
- The MIME→extension map would be a third copy — extract a tiny shared helper in shipments `lib/` rather than duplicate.
