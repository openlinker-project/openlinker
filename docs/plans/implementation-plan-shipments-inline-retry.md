# Implementation Plan: Shipments list — inline retry from a failed row + carrier-message role visibility

**Date**: 2026-07-28
**Status**: Ready — passed `/pre-implement` gate (READY, 5 minor corrections applied)
**Estimated Effort**: 2–3 days
**Issue**: #1826

---

## 1. Task Summary

**Objective**: Add inline recovery to `/shipments` (`apps/web/src/pages/shipments/shipments-page.tsx`) — a per-row expand toggle opening an accordion with the failure detail and a recovery action, a cause-first triage strip for shared-cause failures, and role-based redaction of the raw carrier `errorMessage` for the `viewer` role. Deep-link recovery into the order-scoped `GenerateLabelForm`.

**Context**: PR #1821 (#1800) already surfaces `errorMessage` + `failedAt` in the status cell, but the only recovery path today is: open the order → shipment panel → regenerate. This closes that loop directly from the list. Full design history (grill-me + 2 rounds of 3 independent `/tech-review` passes) lives in the issue body and the mockup at https://claude.ai/code/artifact/ddfd4843-9514-4924-a56d-472cd05761a6 — this plan translates those resolved decisions into concrete files, and separately verifies them against the **current** `main` (which has moved since the mockup was built — the live `/shipments` page already has a `Processor` column, a `cardView`, and a `processor` URL filter that predate this issue).

**Classification**: Frontend (Interface layer, `apps/web`), plus one small CORE change (`libs/core/src/users` — a missing `shipments:write` permission) and one small Interface-layer BE change (`ShipmentResponseDto` gains `deliveryIntent`).

---

## 2. Scope & Non-Goals

### In Scope
- Per-row leading toggle (`DataTable`'s real `expandable`) + accordion carrying failure detail and recovery actions, replacing/extending the current status-cell-only failure hint.
- A unified `Provider` column (dispatch connection, `ConnectionDot`-styled) — see §Columns below for how this reconciles with the **already-shipped** `Processor` + `Connection` columns.
- Deep-link retry: `/orders/:orderId?retryShipmentId={shipmentId}` → order-detail auto-expands `<OrderShipmentPanel>` and opens `<GenerateLabelForm>` with the recipient pre-filled (existing behaviour) and the failed shipment's `paczkomatId` pre-filled (new — see §5, parcel-dims finding).
- Cause-first triage strip: groups ≥2 failed rows on the loaded page sharing a normalised `errorMessage`.
- Viewer-role redaction of the raw `errorMessage` on all 3 surfaces it appears (status-cell text, its `title` tooltip, the accordion) + hiding the triage strip entirely for viewer.
- A `Cancel` accordion action for `generated` rows, as its **own** action (own confirm dialog, own mutation) — not combined with re-issue (round-2 tech-review finding).
- FE `Shipment` type gains `sourceDeliveryMethodId` (already in the BE DTO — FE-only change) and `deliveryIntent` (needs a small BE DTO addition first).
- Adding the missing `shipments:write` permission (CORE + FE mirror) so viewer-gating has a real permission to key off, matching every other domain's `{domain}:write` pattern.
- Mobile card view: severity in `summary`, failure detail + redaction behind `collapsibleDetail`.
- Tests for all of the above.

### Out of Scope
- Bulk retry (explicitly deferred in the issue; `/shipments` has no row selection today).
- A real `providerCode` column / structured carrier-error taxonomy (triage strip uses normalised free-text `errorMessage` — a known, stated limitation, not fixed here).
- Persisting parcel dimensions/weight on `Shipment` so they can be pre-filled on retry — **not persisted today** (see §5); pre-fill is limited to `paczkomatId`.
- A "carrier resolution" second line under Provider (courier-of-record for brokered connections) — stays order-detail-only, as today.
- `FilterBar` — does not exist in the codebase; the existing toolbar (`Select`-based) is reused as-is, not rebuilt.
- Any change to `DataTable`'s `expandable` beyond what it already supports (see §5 — the "colour the chevron by severity" idea from the mockup needs new primitive surface; **deferred**, this plan uses the toggle uncoloured).
- A "resolved carrier" hue palette change to `ConnectionDot` — its existing hash-based hue is used as-is.

### Constraints
- `DataTable`'s `expandable` takes precedence over `rowHref` and disables `virtualize` — the page currently uses `rowHref` for row-click navigation to the order; this PR removes it in favour of the `EntityLabel` name-link (per the issue's resolved decision), consistent with the `orders-list-page.tsx` (#1620) precedent which never pairs the two.
- No BE schema migration in this PR beyond one nullable DTO field (`deliveryIntent`) that already exists on the domain/ORM entity — zero schema change.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/web/src/pages/shipments`, `apps/web/src/features/shipments`, `apps/web/src/features/orders`) for the bulk of the work; CORE (`libs/core/src/users/domain/types/role.types.ts`) for the permission; Interface (`apps/api/src/shipping/http/dto/shipment-response.dto.ts`) for the `deliveryIntent` DTO field.

**Capabilities Involved**: None new — this is a pure presentation-layer change over existing `Shipment` read data and existing mutations (`useGenerateLabelMutation`, `useCancelShipmentMutation`).

**Existing Services Reused**:
- `useGenerateLabelMutation`, `useCancelShipmentMutation`, `useLabelDownload`, `useNotifyDispatchedMutation` — all five already exist, invalidate `shipmentsQueryKeys.all` (and `ordersQueryKeys.all` where relevant) on success, and are wired today only into `apps/web/src/features/orders/components/*` (order-detail). This PR is their **first** consumption from `/shipments`.
- `<ShipmentActionButtons>` and its `CAN_GENERATE`/`CAN_CANCEL`/`CAN_NOTIFY_DISPATCHED`/`CAN_DOWNLOAD_LABEL` status-gating sets — reused verbatim inside the new accordion rather than reimplemented.
- `<GenerateLabelForm>` — reused via the deep-link, extended with one new optional prop (see Phase 1 below).
- `ConnectionDot` (`apps/web/src/features/orders/components/connection-dot.tsx`) — reused for the Provider column (cross-feature import from `shipments` → `orders`; see §Validation for the barrel-export requirement this implies).
- `usePermission` (`apps/web/src/shared/auth/use-permission.ts`) — reused idiom for gating the new `shipments:write` check.
- `data-table.tsx`'s `expandable` + existing `cardView` (`title`/`subtitle`/`meta` are already wired on this page) — extended with `detail` + `collapsibleDetail` for mobile.
- `carrier-tracking-url.ts`'s `buildCarrierTrackingUrl` — reused for the `omp` row's tracking display (returns `null` when no carrier, exactly the branch-1 case).
- `CopyableId` (`apps/web/src/shared/ui/copyable-id.tsx`) — reused for the `omp` row's read-only tracking-number display (per the mockup's round-2 fix), not a bespoke copy button.

**New Components Required**:
- `ShipmentRowDetail` (accordion body) — new component, `apps/web/src/features/shipments/components/shipment-row-detail.tsx`.
- `ShipmentTriageStrip` — new component, `apps/web/src/features/shipments/components/shipment-triage-strip.tsx`, plus a pure grouping helper `apps/web/src/features/shipments/lib/group-failed-shipments-by-cause.ts`.
- `useCancelShipmentAndDeepLink` — no, not needed; Cancel reuses `useCancelShipmentMutation` directly (see Phase 3).
- One new optional prop on `GenerateLabelFormProps` (`initialPaczkomatId?: string`) to support the deep-link pre-fill.
- One new query-param effect on `apps/web/src/pages/orders/order-detail-page.tsx` (`retryShipmentId`) to auto-expand the shipment panel + form.
- `shipments:write` permission — `libs/core/src/users/domain/types/role.types.ts` (`PermissionValues` + `ROLE_PERMISSIONS`), mirrored in `apps/web/src/shared/auth/session.types.ts`.

**Core vs Integration Justification**: The `shipments:write` permission addition touches `libs/core/src/users` (CORE) because that's where `PermissionValues`/`ROLE_PERMISSIONS` are the single source of truth mirrored to the FE — it is a pure additive enum entry, not new domain logic, and does not touch the existing `@Roles('admin', 'operator')` BE guards (already correctly restrictive; this only widens the `GET /me` `permissions[]` array so the FE can key its own visibility logic off something real instead of inventing an ad hoc check).

---

## 4. External / Domain Research

### Internal Patterns (from live-repo research, this worktree, fresh off `main`)

**The mockup's assumed starting point has drifted from `main` — reconcile before coding:**
- Current live columns are `Status · Processor · Created · Order · Customer · [Method · Paczkomat if capability] · Connection · Tracking` — **not** the `Status · Provider · Method · Created · Order · Customer · Action` the issue describes. `Processor` (derived `omp`/`carrier`/`pending` badge, `features/shipments/lib/processor.ts`) and `Connection` (`ConnectionEntityLabel`, plain name, no dot) are two separate existing columns. The issue's single "Provider" column folds `Connection`'s identity into `ConnectionDot`'s coloured-disc treatment; `Processor` stays as its own column (it answers "which of 3 fulfilment branches", a different question than "which connection dispatched it" — collapsing them would lose the `pending` bucket, which has no connection to show). **Decision**: keep `Processor` as-is; replace the `Connection` column's cell renderer with `ConnectionDot` + name (no other column removed). `Method`/`Paczkomat` stay as their own existing columns (already correctly capability-gated) — the issue's "Method" and this page's existing "Method" column are the same thing.
- A `?processor=` URL filter already exists and predates this issue — untouched by this plan.
- `cardView` is already wired (`title`/`subtitle`/`meta`) — this plan only *adds* `detail` + `collapsibleDetail`, it does not build `cardView` from scratch as the issue's Phase framing might suggest.
- The Order column today is `<EntityLabel id={s.orderId} to={`/orders/${s.orderId}`} showId />` with **no `name` prop** — so it currently renders "Unknown" as the link text (the `resolvedName ? ... : <Unknown>` branch in `entity-label.tsx`), and `rowHref` (not this link) is what actually navigates today. Removing `rowHref` per the issue's decision means this `EntityLabel` call **must** gain a real `name` (the shipment has no order-ref string to show, so `name={s.orderId}`, `showId={false}` — mirrors the mockup's resolved `EntityLabel` correction) or navigation silently breaks.
- **`usePermission`/`useWriteAccess` today gates zero content on `/shipments` or the order-detail shipment panel** — `order-shipment-panel.tsx` renders `<ShipmentActionButtons>` to every role unconditionally; the only current enforcement is the BE `@Roles('admin', 'operator')` guard (a viewer's mutation attempt 403s server-side, but the FE shows an actionable-looking button today). This confirms the issue's "no precedent for role-based data hiding" claim and means this PR is establishing the pattern for shipments generally, not just for `/shipments`.
- **No `shipments:write` permission exists anywhere** (`PermissionValues` in `libs/core/src/users/domain/types/role.types.ts` has `shipments:read` only). Every other write-capable domain (`orders`, `products`, `inventory`, `listings`, `connections`, `invoices`, `users`, `integrations`, `sync`, `content`) has a `{domain}:write` entry. This is a real gap, not an oversight to route around — adding it is the correct fix (see §3).
- **`GenerateLabelForm` has no query-param or pre-fill entry point today** — `order-detail-page.tsx` has zero `useSearchParams` usage (it reads `useParams` + `useLocation().hash` for the existing `#shipment` anchor-scroll, #1713). The deep-link is genuinely new plumbing, confirming the issue's own domain fact.
- **`Shipment` does not persist parcel dimensions or weight** — the full FE `Shipment` interface (`shipments.types.ts:78-108`) has no such field, and neither does the BE domain/ORM entity (confirmed by cross-referencing `GenerateLabelInput`, which is a *request* shape, not the persisted `Shipment` read-model). The issue's own hedge ("pre-fill parcel dims... **if persisted**") resolves to: **they are never persisted**, so this pre-fill is out of scope as stated. What *is* persisted and can be forwarded: `paczkomatId`. This is called out explicitly so the PR doesn't ship a form that silently no-ops on a promised field.
- **`sourceDeliveryMethodId` is FE-only work** — already serialized by `ShipmentResponseDto` (`apps/api/src/shipping/http/dto/shipment-response.dto.ts:44-48,94`) and the domain entity; only the FE `Shipment` type/UI is missing it.
- **`deliveryIntent` needs a small BE DTO change** — it exists on the domain entity (`shipment.entity.ts:77`) and ORM entity (`shipment.orm-entity.ts:69`) and is persisted, but `ShipmentResponseDto.fromDomain` never assigns it. This is a **correction to the issue's classification** ("BE-only today... add to FE type, same-file touch") — it is not a same-file FE-only touch; it needs one `@ApiProperty` field + one assignment line in the BE DTO first.
- `DataTable`'s `expandable` (`data-table.tsx:96-100`) is exactly `{ renderDetail, toggleLabel? }` — no `toggleClassName`/tone hook exists to colour the chevron by severity (the mockup's polish idea). **Deferred** per Non-Goals; the toggle renders in its default, uncoloured `.data-table__expand-toggle` style.
- `usePermission('permission'): boolean` is the exact idiom to reuse (`use-permission.ts:20`); `useWriteAccess` (demo-relaxed disabled-but-visible) is a **considered-and-rejected** alternative for the write actions specifically — see §7.

---

## 5. Questions & Assumptions

### Open Questions (carried from the issue, not blocking implementation)
- Whether the sender-postcode redaction is proportionate given the operator may see the same address unredacted on `/connections/:connectionId` — flagged in the issue as a non-blocking follow-up, not resolved here. **Assumption for this PR**: redact as specified in the issue; if the connection-detail page turns out to already show it to viewer, that's a separate, later consistency fix, not a reason to change this PR's behaviour.
- Whether an idle, un-submitted `draft` row (post-cancel, pre-regenerate) is commonly observable — doesn't affect this PR's implementation, only whether QA will find naturally-occurring examples during review.

### Assumptions
- `shipments:write` is granted to `admin` and `operator`, withheld from `viewer` — mirrors the BE controller's existing `@Roles('admin', 'operator')` guard exactly.
- The triage-strip's "Fix sender address" link routes to `/connections/:connectionId` (the connection's own edit page) — no dedicated sender-address anchor exists today, so this is a plain navigation, not an anchor-scroll.
- `Cancel` on a `generated` shipment row reuses the **existing** `useCancelShipmentMutation` + a `<ConfirmDialog>` with the same copy as `shipment-action-buttons.tsx` (`"The label will be voided with {carrier}. This cannot be undone — to ship this order again you'll need to generate a new label."`) — no new mutation is created, consistent with the round-2 tech-review finding that no combined cancel+create mutation exists in the BE.
- Row-level query invalidation (not manual DOM patching) is the only mechanism used — `useGenerateLabelMutation`/`useCancelShipmentMutation` already invalidate `shipmentsQueryKeys.all`, so a plain refetch naturally produces both "the row updates in place" (pre-waybill retry) and "a new row appears" (post-cancel re-issue) outcomes with zero bespoke client state.

### Documentation Gaps
- None blocking — `docs/frontend-architecture.md` and `docs/frontend-ui-style-guide.md` fully cover the patterns needed (state ownership, `DataTable` conventions, permission gating).

---

## 6. Proposed Implementation Plan

### Phase 0: CORE + BE prerequisite (small, do first)

**Goal**: Make the FE gate and the FE type additive-only, no downstream surprises.

**Steps**:
1. **Add `shipments:write` permission**
   - **File**: `libs/core/src/users/domain/types/role.types.ts`
   - **Action**: Add `'shipments:write'` to `PermissionValues`; add it to `ROLE_PERMISSIONS.admin` (automatic, since `admin: PermissionValues`) and `ROLE_PERMISSIONS.operator`; leave out of `ROLE_PERMISSIONS.viewer`.
   - **Acceptance**: `role.types.spec.ts`'s existing `expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([...PermissionValues].sort())` assertion continues to pass unmodified (it derives from the same array). Add one new assertion: `ROLE_PERMISSIONS.viewer` does not include `'shipments:write'`.
   - **Dependencies**: None.
2. **Mirror the permission on the FE**
   - **File**: `apps/web/src/shared/auth/session.types.ts`
   - **Action**: Add `'shipments:write'` to `PermissionValues` at the same array position as the BE (alphabetical/domain-grouped, matching existing convention).
   - **Acceptance**: Type-checks; no runtime behaviour change until a call site uses it (Phase 2).
3. **Add `deliveryIntent` to the BE response DTO**
   - **File**: `apps/api/src/shipping/http/dto/shipment-response.dto.ts`
   - **Action**: Add `@ApiProperty` field for `deliveryIntent` (nullable, matches the domain entity's `DeliveryIntent | null`); assign it in `fromDomain` (mirrors how `sourceDeliveryMethodId` is already wired at lines 44-48/94).
   - **Acceptance**: One unit test asserting `fromDomain` maps `deliveryIntent` through unchanged (including `null`).
   - **Dependencies**: None — zero schema/migration change (column already exists).

### Phase 1: FE type + reusable pieces

**Goal**: Ground truth types and small reusable components before touching the page.

**Steps**:
1. **Add `sourceDeliveryMethodId` + `deliveryIntent` to the FE `Shipment` type**
   - **File**: `apps/web/src/features/shipments/api/shipments.types.ts`
   - **Action**: Add both fields to the `Shipment` interface (`sourceDeliveryMethodId: string | null`, `deliveryIntent: DeliveryIntent | null` — `DeliveryIntent` is already defined in this same file at line 63, reuse it).
   - **Acceptance**: Type-checks; no consumer breaks (additive fields).
   - **Dependencies**: Phase 0 step 3 (BE must serialize `deliveryIntent` or the FE field is always `undefined` from the real API, though tests can still mock it).
2. **Pure triage-grouping helper**
   - **File**: `apps/web/src/features/shipments/lib/group-failed-shipments-by-cause.ts`
   - **Action**: `normaliseErrorMessage(message: string): string` (lowercase, trim, strip digit runs) + `groupFailedShipmentsByCause(shipments: Shipment[]): Map<string, Shipment[]>` (only `status === 'failed' && errorMessage`, keyed by the normalised string) + a selector for "groups with ≥2 members, on the current page only" (the caller passes only the current page's rows — no new BE call).
   - **Acceptance**: Unit tests: two DPD messages differing only by an order number normalise to the same key; a single failed row produces no group; a non-failed row is excluded; case/whitespace variants collapse.
   - **File**: `apps/web/src/features/shipments/lib/group-failed-shipments-by-cause.test.ts`
   - **Dependencies**: None.
3. **`ShipmentTriageStrip` component**
   - **File**: `apps/web/src/features/shipments/components/shipment-triage-strip.tsx`
   - **Action**: Presentational component taking a `{ cause: string; shipments: Shipment[] }`, rendering the warning-toned strip ("N failed shipments share one cause — …") with a "Fix sender address" link to `/connections/:connectionId` (connectionId from the first shipment in the group — all share a connection since the cause is carrier-specific). Copy scales "2 failed…" → "N failed…" via a template, not hardcoded plural.
   - **Acceptance**: Unit test: renders singular-safe copy at 2 and at 5 rows; link href is correct.
   - **Dependencies**: Step 2.
4. **`ShipmentRowDetail` component (accordion body)**
   - **File**: `apps/web/src/features/shipments/components/shipment-row-detail.tsx`
   - **Action**: Props `{ shipment: Shipment; canWrite: boolean }`. Branches on `shipment.status` mirroring `CAN_GENERATE`/`CAN_CANCEL`/`CAN_NOTIFY_DISPATCHED`/`CAN_DOWNLOAD_LABEL` from `shipment-action-buttons.tsx` (reuse those exported sets rather than re-deriving):
     - `failed`: raw `errorMessage` (redacted if `!canWrite`) + `failedAt` + a "Fix sender address" link (routes to the connection) + "Regenerate label" → deep-link (see Phase 2 step 3). No action rendered if `!canWrite`.
     - **Payment-gate correction (found during implementation, not caught by the plan or the `/pre-implement` gate):** `PAYMENT_BLOCKS_DISPATCH` needs a `PaymentStatus`, which lives only on `OrderRecord.orderSnapshot` (parsed via `parseOrderSnapshot`) — `/shipments`' `Shipment` rows carry no payment data, and fetching every failed row's parent order just to pre-compute this gate is an unjustified N+1. Resolution: `/shipments`' accordion does **not** attempt to reproduce the payment gate — Regenerate is always a plain deep-link. The already-existing, already-tested `ShipmentActionButtons` on the order-detail page (which *does* have `paymentStatus` in scope) is the single source of truth for the gate and renders the correct disabled button + reason once the operator lands there via the deep-link. No duplicate gating logic, no extra fetch.
     - `draft` / `cancelled` (generate-eligible per `CAN_GENERATE`): "Generate label" → same deep-link.
     - `generated`: "Mark dispatched" (reuses `useNotifyDispatchedMutation` + its own confirm copy) / "Download label" (`useLabelDownload`) / "Cancel" (own `<ConfirmDialog>`, `useCancelShipmentMutation`, copy identical to `shipment-action-buttons.tsx`'s existing dialog).
     - `delivered` / `dispatched` / `in-transit`: "Track parcel" (via `buildCarrierTrackingUrl`, hidden if `null`) / "Download label".
     - `omp` shipping method (branch-1, read via `shippingMethod === 'omp'`, mirroring the existing early-return in `shipment-action-buttons.tsx`): if `trackingNumber` is set, render it via `<CopyableId id={trackingNumber} label={trackingNumber} />`; otherwise a plain "Fulfilled by the destination — no tracking yet" message. No write actions ever (there is genuinely nothing to write).
   - **Acceptance**: One `it` per status branch confirming the right actions/redaction render; a `canWrite={false}` pass over `failed` confirms no Regenerate/Cancel/Mark-dispatched controls render.
   - **File**: `apps/web/src/features/shipments/components/shipment-row-detail.test.tsx`
   - **Dependencies**: Phase 0 step 1 (the concept of `canWrite`); reuses existing mutations.
5. **Export `CAN_GENERATE`, `CAN_CANCEL`, `CAN_NOTIFY_DISPATCHED`, `CAN_DOWNLOAD_LABEL` from `shipment-action-buttons.tsx` — AND re-export them from the `orders` feature's public barrel** (`PAYMENT_BLOCKS_DISPATCH` is exported too, for symmetry/future reuse, but is **not** barrel-exported or consumed from `shipments` — see the payment-gate correction above; it needs a `PaymentStatus` `/shipments` doesn't have).
   - **Action**: These four `Set` constants (status-only, no order-snapshot dependency) were module-private (confirmed at `/pre-implement` gate time — no `export` keyword). Two steps, both required: (a) add `export` to each in `shipment-action-buttons.tsx`; (b) add all four to `apps/web/src/features/orders/index.ts`'s barrel export list — step (a) alone is not sufficient for `ShipmentRowDetail` (in the `shipments` feature) to import them the barrel-compliant way this plan's `ConnectionDot` step also commits to. `orders/index.ts` already re-exports `ordersQueryKeys` for `shipments`' own reverse consumption (see its header comment) — this follows the same, already-established pattern.
   - **Acceptance**: No behaviour change to `shipment-action-buttons.tsx` itself; `shipment-row-detail.tsx` imports all four from `'../../orders'` (the barrel), not from a deep path.
   - **Note (found at `/pre-implement` gate)**: the ESLint cross-feature deep-import ban (`.eslintrc.js`, the `apps/web/src/features/**` block) does not currently enumerate `orders` in its deny-glob list — a deep import into `orders/components/**` would not fail lint today. Follow the barrel path anyway per `docs/frontend-architecture.md` convention; a reviewer should check this by eye since lint won't catch a regression here.
   - **Dependencies**: None — pure export addition.

### Phase 2: Deep-link plumbing (order-detail side)

**Goal**: `/orders/:orderId?retryShipmentId={shipmentId}` auto-opens the right form, pre-filled.

**Steps**:
1. **Read `retryShipmentId` on order-detail mount**
   - **File**: `apps/web/src/pages/orders/order-detail-page.tsx`
   - **Action**: Add `useSearchParams()`; on mount, if `retryShipmentId` is present, pass it down to `<OrderShipmentPanel>` as a new prop (e.g. `autoOpenForShipmentId`). Do not remove the param from the URL automatically (keeps the link shareable/re-openable — matches the issue's stated rationale for choosing a query param over router `state`).
   - **Acceptance**: Test: mounting the page with `?retryShipmentId=X` calls through to the panel prop; without the param, behaviour is unchanged (no `useSearchParams` regression for the existing `#shipment` hash-scroll, #1713, which stays independent).
   - **Dependencies**: None.
2. **Auto-expand the panel + form**
   - **File**: `apps/web/src/features/orders/components/order-shipment-panel.tsx`
   - **Action**: New optional prop `autoOpenForShipmentId?: string`. On mount, if it matches one of the order's shipments (via `useOrderShipmentsQuery`), set `formOpen = true` (same local state the existing empty-state CTA and `ShipmentActionButtons`'s `onGenerateLabelClick` already flip) and pass that shipment's `paczkomatId` through to `<GenerateLabelForm initialPaczkomatId={...}>`.
   - **Acceptance**: Test: given a matching `autoOpenForShipmentId`, the form renders open with the paczkomat pre-selected; given a non-matching id (stale/foreign link), the panel renders its normal collapsed state (no error, no crash).
   - **Dependencies**: Step 1.
3. **`initialPaczkomatId` pre-fill on the form**
   - **File**: `apps/web/src/features/orders/components/generate-label-form.tsx`
   - **Action**: New optional prop `initialPaczkomatId?: string`, threaded into the form's default values only when the resolved delivery method is `paczkomat` (parcel dimensions/weight remain operator-typed — not persisted, see §5).
   - **Acceptance**: Test: passing `initialPaczkomatId` pre-selects that locker in the paczkomat picker; omitting it behaves exactly as today (regression guard).
   - **Dependencies**: Step 2.
4. **Build the deep-link URL at the call site**
   - **File**: `apps/web/src/features/shipments/components/shipment-row-detail.tsx` (from Phase 1)
   - **Action**: "Regenerate label" / "Generate label" links render as `<Link to={`/orders/${shipment.orderId}?retryShipmentId=${shipment.id}`}>`, not a mutation call from `/shipments` itself — the mutation still only ever fires from the order-detail form, per the issue's resolved decision.
   - **Acceptance**: Covered by Phase 1 step 4's tests (assert the link href).
   - **Dependencies**: Phase 1 step 4.

### Phase 3: `/shipments` page wiring

**Goal**: Assemble the toggle, accordion, Provider column, triage strip, and redaction into the live page.

**Steps**:
1. **Add the `expandable` prop to `<DataTable>`**
   - **File**: `apps/web/src/pages/shipments/shipments-page.tsx`
   - **Action**: `expandable={{ renderDetail: (s) => <ShipmentRowDetail shipment={s} canWrite={canWrite} />, toggleLabel: (s, expanded) => `${expanded ? 'Collapse' : 'Expand'} details for shipment ${s.id}` }}`. Remove `rowHref` (see Constraints). Add `detail`/`collapsibleDetail` to the existing `cardView` object for mobile parity (reusing the same `<ShipmentRowDetail>`).
   - **Acceptance**: Existing "row click navigates to order" tests are removed/replaced with "row click expands the accordion" tests; a new `EntityLabel`-name-link-navigates test replaces the old `rowHref` coverage.
   - **Note (found at `/pre-implement` gate)**: `DataTableSkeleton` (`apps/web/src/shared/ui/data-table-skeleton.tsx`) has no `expandable` concept — its `columns` prop is just a count/array with no leading-toggle-column awareness. Pass a column count that accounts for the new toggle column so the loading skeleton doesn't render one column narrower than the real table; check visually during implementation.
   - **Dependencies**: Phase 1 step 4.
2. **Fix the Order column's `EntityLabel`**
   - **Action**: Change `<EntityLabel id={s.orderId} to={`/orders/${s.orderId}`} showId />` to `<EntityLabel id={s.orderId} name={s.orderId} to={`/orders/${s.orderId}`} showId={false} />` — `name` carries the navigable link text now that `rowHref` is gone (mirrors the `orders-list-page.tsx` fallback idiom of naming with the raw id when no formatted ref exists).
   - **Acceptance**: Test: the order-id text is a real `<a href="/orders/...">`, not the previous "Unknown" placeholder.
   - **Dependencies**: Step 1 (must land together — removing `rowHref` without this leaves the page with no row-to-order navigation at all).
3. **Provider column**
   - **Action**: Replace the existing `Connection` column's cell (`<ConnectionEntityLabel connectionId={s.connectionId} linkToDetail={false} showId={false} />`) with a `ConnectionDot` + connection name composite — reuse `useConnectionsQuery` (already fetched on this page for the filter dropdown) to resolve `{ name, platformType }` for `s.connectionId` instead of `ConnectionEntityLabel`'s own internal query, avoiding a duplicate fetch. Header stays "Connection" or renames to "Provider" per the issue — rename to **"Provider"** for consistency with the issue's resolved column list, but keep it as the *same* column position (not a new column), i.e. `Processor` and `Provider` coexist as two columns, matching the reconciliation in §4.
   - **Acceptance**: Test: a shipment with a known connection renders the coloured dot + name; a shipment with no connection (shouldn't occur for non-`omp` rows, but defensively) renders whatever `ConnectionDot`'s generic-grey fallback shows.
   - **Dependencies**: Cross-feature import — `ConnectionDot` lives in `features/orders/components/`; importing it from `features/shipments` requires it be exported from the `orders` feature's public barrel (`apps/web/src/features/orders/index.ts`) per `docs/frontend-architecture.md` § Feature Public Surface. **Action**: add `export { ConnectionDot } from './components/connection-dot';` to that barrel if not already exported (confirmed absent in research — barrel grep returned nothing).
4. **Triage strip mount**
   - **Action**: Compute `groupFailedShipmentsByCause(query.data?.items ?? [])` once per render; render one `<ShipmentTriageStrip>` per qualifying group (≥2 members) above the table, gated on `canWrite` (hidden entirely for viewer, not redacted — per the issue's resolved decision).
   - **Acceptance**: Test: two failed rows sharing a normalised cause render the strip; viewer role (no `shipments:write`) never sees it even when the condition would otherwise qualify.
   - **Dependencies**: Phase 1 steps 2–3.
5. **Status-cell + tooltip redaction**
   - **File**: `ShipmentStatusCell` (same file, existing function)
   - **Action**: Gate the existing `errorMessage`/`title` rendering on `canWrite` — `!canWrite` renders a fixed string ("Shipment failed — details hidden for this role") in place of both the visible text and the `title` attribute (an earlier design pass missed the `title`; this plan fixes both at once since they're the same JSX expression).
   - **Acceptance**: The existing `describe('ShipmentsPage — failed-shipment hint (#1800)')` test block (lines 302–374) is extended with viewer-role variants asserting the redacted string appears and the raw message does not (checked via `queryByText`, not just `getByTitle`, since both the text node and the attribute must be absent).
   - **Dependencies**: Phase 0 step 2 (permission must exist to read).
6. **Wire `canWrite` once, pass down**
   - **Action**: `const canWrite = usePermission('shipments:write');` once at the top of `ShipmentsPage`, threaded into `ShipmentStatusCell`, the triage-strip gate, and `expandable.renderDetail`'s `<ShipmentRowDetail canWrite={canWrite} />`. **Not** `useWriteAccess` with demo-relaxation — see §7 for why.
   - **Acceptance**: Covered by the tests in steps 4–5.
   - **Dependencies**: Phase 0 step 2.

---

## 7. Alternatives Considered

### Alternative 1: Reuse `useWriteAccess('shipments:write', demoMode)` instead of plain `usePermission`
- **Description**: `useWriteAccess` is the established pattern for demo-relaxed write gating elsewhere (`orders-list-page.tsx`) — it renders a disabled-but-visible affordance for a public-demo viewer, advertising the capability exists.
- **Why Rejected**: The issue's resolved decision is explicit that viewer sees **no** Regenerate/Cancel control at all, not a disabled one — and the content being gated here (a redacted carrier message) is sensitive in a way a generic "disable this button" case isn't. Pairing a disabled action button next to already-redacted text would be a confusing, leaky-looking combination. Plain `usePermission` (hide entirely) matches the issue's explicit decision.
- **Trade-off**: A public-demo deployment loses the "advertise this capability exists" affordance for shipment recovery specifically — an acceptable, deliberate exception given the sensitive content, not an oversight.

### Alternative 2: Collapse `Processor` and the new `Provider` column into one
- **Description**: The issue's column list names only `Provider`, implying `Processor` might be replaced.
- **Why Rejected**: `Processor` (`omp`/`carrier`/`pending`) and `Provider` (which connection dispatched it) answer different questions — a `pending` shipment has no connection to show as a `Provider` disc, and collapsing them would either lose the `pending` bucket or force `Provider` to render a meaningless placeholder for it. The existing `Processor` column and its URL filter already shipped (pre-dating this issue) and are left untouched; `Provider` is additive by replacing `Connection`'s cell renderer only.
- **Trade-off**: Six columns instead of the issue's five-plus-status list — accepted, since correctness (not losing the `pending` signal) outranks matching an issue-body column count that was written before `Processor` existed on `main`.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Dependency direction respected: `shipments` feature imports from `orders` feature's public barrel only (`ConnectionDot`, `GenerateLabelForm` types if needed) — no deep imports.
- ✅ No CORE/Integration boundary touched beyond the additive `shipments:write` permission enum entry.
- **Reference**: `docs/architecture-overview.md`, `docs/frontend-architecture.md` § Feature Public Surface.

### Naming Conventions
- ✅ `use-*.ts` for hooks (none new — all reused), `*.types.ts`, `kebab-case.tsx` components, `*.test.tsx`/`*.test.ts` colocated. All new files follow the existing `features/shipments/{components,lib}` layout exactly.

### Existing Patterns
- ✅ Verified against `orders-list-page.tsx` (#1620) for the `expandable`-drops-`rowHref` precedent and the `name`-as-navigable-fallback idiom.
- ✅ Verified against `shipment-action-buttons.tsx` for the status-gating `Set`s (reused, not re-derived) and the exact `ConfirmDialog` copy for Cancel.

### Risks
- **`ConnectionDot` barrel export**: if it turns out to already be exported and the research grep missed it, the barrel-export step is a no-op — safe either way.
- **`DataTableSkeleton` + `expandable`**: confirm the skeleton component tolerates the new column set without a special `expandable`-aware loading row (likely fine — skeleton renders columns generically, no code seen coupling it to `expandable`). Verify during implementation, not blocking the plan.
- **Cross-page test churn**: removing `rowHref` will break any existing test asserting row-click navigation; Phase 3 step 1 explicitly calls out replacing rather than just adding tests.

### Edge Cases
- A `failed` shipment with `errorMessage === null` (shouldn't happen per #1800's persistence guarantee, but the existing `showError` guard already handles it) — accordion renders no raw-message block, just `failedAt` if present.
- A shipment whose `connectionId` no longer resolves to a live connection (deleted connection) — `ConnectionDot` already handles `name === null` with its generic-grey fallback; no new handling needed.
- Triage strip with exactly 2 groups of different causes on the same page — render one strip per group, stacked (not a single merged strip), since "Fix sender address" routes to a specific connection per group.

### Backward Compatibility
- ✅ `sourceDeliveryMethodId`/`deliveryIntent` are additive fields — no breaking change to existing `Shipment` consumers.
- ⚠️ Removing `rowHref` **is** a behaviour change for anyone relying on row-click-to-order-navigate muscle memory — mitigated by the `EntityLabel` name-link remaining the equivalent, one-click-away navigation path, and called out in the PR description.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `group-failed-shipments-by-cause.test.ts` — normalisation, grouping, threshold.
- `shipment-triage-strip.test.tsx` — copy scaling, link href.
- `shipment-row-detail.test.tsx` — one branch per status × `canWrite` true/false.
- `role.types.spec.ts` — extended assertion for `shipments:write` role membership.
- `shipment-response.dto.spec.ts` (or wherever the existing DTO mapping test lives) — `deliveryIntent` passthrough.

### Integration/Component Tests (existing patterns, `renderWithProviders` + `createMockApiClient`)
- `shipments-page.test.tsx` — extend the existing `#1800` describe block with viewer-role redaction across status-cell text, `title`, and (new) accordion; add: toggle expands/collapses the accordion; `EntityLabel` name-link navigates; Provider column renders `ConnectionDot`; triage strip appears/hides correctly per role and per group size.
- `order-detail-page.test.tsx` / `order-shipment-panel.test.tsx` — extend with `?retryShipmentId=` auto-open + paczkomat pre-fill, and the non-matching-id no-op case.
- `generate-label-form.test.tsx` — extend with `initialPaczkomatId` pre-selection.

### Mocking Strategy
- Session/permission: `renderWithProviders(<ShipmentsPage />, { sessionAdapter: createAuthenticatedSessionAdapter({ ...user, role: 'viewer', permissions: [...] }) })` for viewer-role cases; default `DEFAULT_TEST_USER` (role `admin`) for the write-enabled path — note `DEFAULT_TEST_USER` will need `shipments:read`/`shipments:write` added to its `permissions` array alongside the other domains already listed there, or tests must override per-case.
- API: `createMockApiClient` with `shipments.list` returning fixture rows covering every status + the two-shared-cause triage scenario.

### Acceptance Criteria
- [ ] Each `failed` row's leading toggle (not a second control) opens an accordion with `errorMessage` + `failedAt` (or the viewer's redacted string) and the recovery action; severity text is non-interactive; row shows `cursor: pointer`; `rowHref` is gone in favour of the `EntityLabel` name link.
- [ ] Regenerate/Generate-label deep-links to `/orders/:orderId?retryShipmentId={id}`, pre-filling recipient (existing) + `paczkomatId` (new); parcel dims are never pre-filled (not persisted).
- [ ] `Cancel` on a `generated` row is its own action with its own confirm dialog and mutation — never combined with re-issue.
- [ ] Provider column renders `ConnectionDot` + name; `Processor` column is untouched.
- [ ] Triage strip groups ≥2 failed rows on the loaded page by normalised `errorMessage`; hidden entirely (not redacted) for viewer.
- [ ] Viewer redaction covers all 3 surfaces (status-cell text, its `title`, the accordion) and the triage strip is hidden.
- [ ] `omp` rows show a read-only `CopyableId` tracking number when present, no write actions ever.
- [ ] `shipments:write` permission exists (CORE + FE), granted to admin/operator only.
- [ ] FE `Shipment` type has `sourceDeliveryMethodId` + `deliveryIntent`; BE DTO serializes `deliveryIntent`.
- [ ] Mobile `cardView` gains `detail`/`collapsibleDetail` mirroring the desktop accordion.
- [ ] `pnpm lint && pnpm type-check && pnpm test` all green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — reuses all 4 existing mutations, `ShipmentActionButtons`'s gating sets, `ConnectionDot`, `CopyableId`, `usePermission`
- [x] Idempotency considered — no new mutations introduced; existing ones already idempotent per their own specs
- [x] Event-driven patterns — n/a (pure FE read/write over existing REST endpoints)
- [x] Rate limits & retries — n/a
- [x] Error handling comprehensive — existing mutation error handling reused unchanged
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## 11. Post-implementation review round (3 independent `/pr-review` passes)

Three independent review passes ran against the finished diff. Findings and how
each was resolved — several were real defects the plan had not anticipated:

**Blocking**

1. **Viewer redaction only covered `/shipments`.** `OrderShipmentPanelBody`
   rendered the raw `errorMessage` with no gate, and this change's own Order-
   column fix made that panel one click from the redacted row. Fixed: threaded
   `usePermission('shipments:write')` → `canWrite` into the panel body, same
   placeholder copy. (AC-105's "all three surfaces" + AC-111's "and the
   order-detail shipment panel" were both unmet.)
2. **The deep-link auto-open bypassed the payment (#928) and dead-route
   (#1799) gates, and re-fired on refetch.** The effect keyed on the found
   shipment's *object identity*, so a post-submit / post-cancel refetch handed
   it a new object with the same id and silently re-opened a dismissed form;
   and it never checked the eligibility `ShipmentActionButtons` enforces, so a
   payment-blocked order opened a live submittable form behind the disabled
   button. Fixed with a `useRef` latch keyed on shipment id plus a
   `CAN_GENERATE` + payment + live-route gate. Four regression tests added.

**Important**

3. **Four AC items were silently unimplemented.** Added: the Action column with
   a plain non-interactive severity label (`Fix`/`Finish`/`Send`/`View`),
   `stickyLeftColumns={1}` (frozen Status anchor), a call-site `truncateOrderId`
   helper mirroring `shortenId` (AC-103 — `EntityLabel` never truncates `name`,
   so the raw 41-char id was rendering as link text), and the card `summary`
   slot carrying the severity label. `Blocked` is documented as deliberately
   *not* derivable here (needs the order's payment status, which `/shipments`
   rows don't carry).
4. **Redaction was FE-only against an un-gated endpoint.** `GET /shipments`
   and `GET /shipments/:id` carry no `@Roles`, so a viewer could read the raw
   message straight off the JSON. Fixed at the real boundary:
   `ShipmentResponseDto.fromDomain` takes a `canWrite` flag the controller
   resolves from `@CurrentUser()` via `ROLE_PERMISSIONS`. The FE gate stays
   (it also drives write-affordance visibility) but is no longer the only
   enforcement.
5. **Triage-strip grouping ignored `connectionId`.** Two connections
   misconfigured the same way collapsed into one group whose single "fix" link
   pointed at whichever row sorted first — the operator would fix half a batch.
   Grouping is now keyed on `(connectionId, cause)` with `connectionId` on the
   group.
6. **"Fix sender address" was hardcoded for every cause.** The grouping is a
   free-text match, so the shared cause could be anything the carrier rejects
   on. Copy is now cause-neutral ("Review connection settings") and the strip
   renders the representative raw cause so the operator knows what to look for.
7. **`normaliseErrorMessage` trimmed before stripping digits**, so a digit run
   at a message boundary or inside quotes left residue that split one cause
   into separate groups (`sender postcode "22-213" invalid` vs `"22213"`).
   Reordered + punctuation residue collapsed; both counterexamples are now
   regression tests.
8. **`initialPaczkomatId` precedence was inverted.** For the Allegro flow the
   field renders *read-only* labelled "Buyer-selected", but a retry deep-link
   was overwriting it with the previous failed shipment's locker id — showing
   an uneditable wrong value under a label claiming it was the buyer's choice.
   Now `snapshot.pickupPoint?.id ?? initialPaczkomatId ?? ''`.
9. **Mobile lost order navigation.** Dropping `rowHref` left cards with a
   `customerId` no path to their order. `cardView.title` is now unconditionally
   the order `EntityLabel`.
10. **The accordion could open empty** for a common transitional state
    (`dispatched` with no `labelPdfRef`/`carrier`). Added a muted fallback.
11. **Test gaps closed:** `title`-attribute redaction (both directions),
    Cancel + Mark-dispatched confirm-dialog→mutation flows, four mobile
    card-mode tests, payment-blocked and route-blocked deep-links,
    `aria-expanded` transitions, operator-role and anonymous permission
    boundaries, third-member and divergent-connection grouping.
12. **`CAN_*` sets lived in the wrong feature.** They're keyed on
    `ShipmentStatus`, which `shipments` owns, but were exported from the
    `orders` barrel — one `export` away from a real cycle. Moved to
    `features/shipments/lib/shipment-action-eligibility.ts`; both consumers now
    depend on the owner.

**Suggestions applied:** Provider column doc-comment corrected (an `omp` row's
`connectionId` is the destination *shop*, not a carrier) with `variant` derived
accordingly; the dot `aria-hidden` so the connection name isn't announced twice;
`DEFAULT_TEST_USER.permissions` derived from `PermissionValues` instead of a
hand-listed array that had already drifted; `shipment-row-detail`'s CSS moved
off the `orders-detail__*` classes onto a shared rule set with its own names;
toggle copy aligned with `/orders` ("Expand/Collapse"); `useMemo` on the
grouping call; `deliveryIntent` now actually rendered in the accordion
("Requested as") rather than shipping as an unconsumed type field.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue #1826, design mockup: https://claude.ai/code/artifact/ddfd4843-9514-4924-a56d-472cd05761a6
