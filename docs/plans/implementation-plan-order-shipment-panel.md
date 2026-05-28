# Implementation Plan — Order-detail Shipment panel (Allegro Delivery + InPost) (#769 + #839-panel-scope)

**Branch:** `769-839-shipment-panel-allegro`
**Issues:** Closes #769 (in full); partially addresses #839 (panel-flavored AC items: AC-2 async pending Generate Label, AC-3 buyer pickup-point pre-fill, AC-5 capability-conditional terminology, AC-6 cancel+re-issue, AC-8 hide-when-no-capability). The `/shipments`-extension AC-7 work is intentionally deferred to your in-flight #834 cycle; the connection-settings extensions (#771) are out of scope.

---

## 1. Goal & scope

**Goal.** Ship the order-detail **Shipment panel** as the operator's single end-to-end surface to act on a shipment, regardless of which shipping provider (InPost ShipX or Allegro Delivery) the routing rule resolves to. Per the FE-architecture state-ownership rules: TanStack Query for shipment fetch, React Hook Form + Zod for the inline generate-label form, no general-purpose store.

**In scope (this PR):**

1. **BE: introduce `Shipment.carrier` end-to-end** — the actual carrier-of-record identity (distinct from the dispatcher), surfaced as a nullable column on `Shipment`, wired through the `TrackingSnapshot` port (Allegro adapter populates from `transportingInfo[].carrierId`; InPost adapter writes the literal `'inpost'`), backfilled by `ShipmentStatusSyncService` (#838) alongside `trackingNumber`, and surfaced on `ShipmentResponseDto`. Underpins the FE tracking-link UX (§3.7) and is a prerequisite consumed by three tracked follow-ups (#834 PS branch-1 read-back, the PS richer capability-B writes, #861 per-destination notify-state).
2. **BE micro-addition:** `POST /shipments/:id/notify-dispatched` HTTP endpoint wiring the existing `IShipmentDispatchNotificationService.notifyDispatched`. Without it, operators have no way to fire #837's source + dest projection — the service exists but is unreachable from outside the worker (and the worker has no handler that calls it yet either).
3. **FE: mutations** in `features/shipments/api/` for the three already-shipped BE endpoints (`POST /shipments/generate-label`, `POST /shipments/:id/cancel`) plus the new `POST /shipments/:id/notify-dispatched`, with TanStack Query mutation hooks that invalidate the order's shipment list on success.
4. **FE: `<OrderShipmentPanel orderId={...} />`** embedded in the order-detail page. Capability-gated on `supportedCapabilities.includes('ShippingProviderManager')`. Renders:
   - status badge (reuse the shipped `ShipmentStatusBadge`),
   - paczkomat id (display-only — picker is out of scope, see §1.3),
   - tracking number + carrier-keyed public-tracker link (or copy-text fallback for unknown / null-carrier values),
   - operator action buttons under a strict status-gate matrix (§3.4),
   - inline `Alert` for failures.
5. **FE: `<GenerateLabelForm />`** sub-component (React Hook Form + Zod) that captures parcel dimensions + weight and submits via `useGenerateLabelMutation`. Shipping connection, source delivery method, and recipient are resolved from the order; paczkomat selection is pre-filled from the order when present (Allegro Delivery path — buyer-selected, AC-3) and displayed read-only (InPost own-contract path defers to the picker modal, §1.3 follow-up).
6. **Capability-conditional terminology** — when no connection in the user's environment declares `ShippingProviderManager`, the panel renders nothing (AC-8). When at least one does but no Allegro Delivery connection exists, no Allegro-flavored copy appears.
7. **Tests:** mapper + adapter spec updates for the new `TrackingSnapshot.carrier` field; status-sync spec extension for the carrier-write path; controller unit + int-spec for the new HTTP endpoint; component tests for `<OrderShipmentPanel />` (capability-gating, status-matrix button enablement, async-pending UX, error surfacing, carrier-keyed URL switch) and `<GenerateLabelForm />` (validation, submit).

**Explicitly out of scope (filed as follow-ups, not blocking this PR):**

| Out of scope | Why deferred | Follow-up issue |
|---|---|---|
| Paczkomat picker modal (search-by-city, results, status badges per result) | Significant standalone UX surface; #769's AC says the panel renders a picker modal — splitting it keeps this PR reviewable and lets the picker land with cache-v2 work (#849). Today's InPost paczkomat path requires the operator to know the paczkomat-id; documented as a known limitation in panel copy. | New issue — `feat(web,shipping): paczkomat picker modal (#769-picker)` |
| `/shipments` page extension (processor column, PS-fulfilled rows, filters) | AC-7 of #839. Directly overlaps with **#834 PS branch-1 read-back** which is in flight in parallel; building the FE column before the BE row shape is locked would mean double-revising. Wait for #834 to land. | Re-open #839 once #834 ships; scope-narrow to `/shipments` only. |
| InPost connection settings (#771: ShipX OAuth + PS module dropdown + trigger config + webhook runbook) | Independent FE vertical; not on the panel's critical path. Connections are usable today via the raw-JSON settings fallback. | Keep #771 as-is. |
| Label-PDF download endpoint + button | No BE `GET /shipments/:id/label.pdf` endpoint exists today; the `labelPdfRef` field (`shipx:label:{id}`, `allegro-delivery:label:{id}`) is opaque. The download seam needs its own design (auth, cross-provider download abstraction, PDF caching). | New issue — `feat(shipping): label-PDF download endpoint + cross-provider LabelDocumentReader port` |
| Parcel-dimensions persistence (saving the form's last-used values) | The form re-prompts every Generate-label; persistence is a small UX win, not a correctness gate. | Optional follow-up after operators give feedback. |

**Non-goals:** changing the dispatch-orchestration BE; adding new ports/capabilities; touching the routing-config UI; localization beyond the existing inline English strings (i18n seam is in place but unused for FE-001).

---

## 2. Layer classification + architecture compliance

| Concern | Layer | Module |
|---|---|---|
| `TrackingSnapshot.carrier` field | Core / Domain (`libs/core/src/shipping/domain/types/`) | `tracking-snapshot.types.ts` |
| `Shipment.carrier` field | Core / Domain + Infra (`libs/core/src/shipping/domain/entities/`, `infrastructure/persistence/entities/`) | `shipment.entity.ts`, `shipment.orm-entity.ts`, repo update method |
| `Shipment.carrier` migration | Infra (`apps/api/src/migrations/`) | new TypeORM migration adding the nullable column |
| Allegro Delivery adapter carrier extraction | Integration (`libs/integrations/allegro/src/infrastructure/`) | `allegro-shipment.mapper.ts`, `allegro-delivery-shipping.adapter.ts` |
| InPost adapter carrier literal | Integration (`libs/integrations/inpost/src/infrastructure/`) | the ShipX adapter's `getTracking` |
| Status-sync carrier write | Core / Application (`libs/core/src/shipping/application/services/`) | `shipment-status-sync.service.ts` (extends #838's diff to include `carrier`) |
| `Shipment.carrier` on HTTP response | Interface (`apps/api/src/shipping/http/dto/`) | `shipment-response.dto.ts` |
| New HTTP endpoint (`notify-dispatched`) | Interface (`apps/api/src/shipping/http/`) | `ShipmentController` |
| FE API client + types | Frontend (`apps/web/src/features/shipments/api/`) | `shipments.api.ts`, `shipments.types.ts` (add `carrier` + the new mutation signatures) |
| FE mutations | Frontend (`apps/web/src/features/shipments/hooks/`) | three new `use-*-mutation.ts` files |
| FE panel + form + tracking-link helper | Frontend (`apps/web/src/features/orders/components/`) | reuses orders-feature surface (panel is order-scoped) |
| FE carrier → URL map | Frontend (`apps/web/src/features/shipments/lib/`) | new `carrier-tracking-url.ts` helper + per-carrier URL constants |
| FE panel wiring | Frontend (`apps/web/src/pages/orders/order-detail-page.tsx`) | one-line composition edit |

**Dependency direction (FE):** `pages → features → shared`. The panel lives under `features/orders/components/` because it's order-scoped composition; the `features/shipments` feature owns the API client + mutation hooks (its public barrel re-exports what `features/orders` needs). Cross-feature import goes through the `features/shipments/index.ts` barrel only — never deep into `features/shipments/api/` or `features/shipments/hooks/` (per `docs/frontend-architecture.md` § Feature Public Surface, enforced by ESLint `no-restricted-imports`).

**Capability gate:** direct `connection.supportedCapabilities.includes('ShippingProviderManager')` — same pattern `pages/shipments/shipments-page.tsx` already uses (no plugin-level shipping surface). No `PlatformContribution` extension is needed; shipping is capability-driven, not platform-specific.

**Backend rules:** the controller addition obeys the same Symbol-token + interface-injection pattern every existing `ShipmentController` method uses (`IShipmentDispatchNotificationService` already injected at line 67 of `shipment.controller.ts` is currently unused — we're activating it).

---

## 3. Design

### 3.0 Connection + carrier terminology

Three distinct identities appear on a shipment row; the panel keys each UI affordance on the right one. Conflating them is the most common failure mode for this kind of FE work — pinning the vocabulary up front:

| Identity | Field | What it answers |
|---|---|---|
| **Source connection** | `OrderRecord.sourceConnectionId` | "Which marketplace did this order come from?" Used for the order's source-side badge / link in the order Summary panel. **Never used by the Shipment panel.** |
| **Shipping (processor) connection** | `Shipment.connectionId` (resolved via `FulfillmentRoutingRule.processorConnectionId` at dispatch time) | "Which OL connection dispatched this shipment?" Drives capability-conditional rendering (`platformType === 'allegro'` → Allegro-Delivery copy; `'inpost'` → InPost own-contract copy) and the paczkomat caption ("buyer-selected" vs "operator-selected" — a property of the dispatch flow, not the carrier). |
| **Actual carrier-of-record** | `Shipment.carrier` (introduced in this PR, populated from `TrackingSnapshot.carrier` by the adapter and backfilled by `ShipmentStatusSyncService` alongside `trackingNumber`) | "Which courier is physically moving the parcel?" Drives the public tracker URL. For InPost own-contract: always `'inpost'`. For Allegro Delivery: one of the `KnownCarrierValues` (see below) depending on which carrier Allegro brokered to. |

Why three: Allegro Delivery is a **brokerage** (spec #732 §3.2) — the dispatcher (`platformType === 'allegro'`) is distinct from the carrier-of-record (`'inpost' / 'dpd' / …`). PS-fulfilled rows (#834) will surface the same shape: dispatcher `'prestashop'`, carrier determined by PS's `order_carriers.id`. Keying tracking-URL composition on the dispatcher works for InPost own-contract by coincidence; it breaks for every broker. Keying on the carrier-of-record is durable. See [the original analysis exchange in this PR's grill-me transcript].

**Vocabulary shape — closed-core, open-runtime (per #576 precedent).** Core ships a closed `KnownCarrierValues` `as const` runtime array + derived `KnownCarrier` union type (per `engineering-standards.md § Union Types: as const Pattern (Default)`); the field accepts `KnownCarrier | string` at the BE registry boundary so plugin adapters can register new carrier values without core PRs:

```ts
// libs/core/src/shipping/domain/types/tracking-snapshot.types.ts
export const KnownCarrierValues = [
  'inpost',
  'dpd',
  'dhl',
  'orlen',
  'allegro-one-box',
  'allegro-one-punkt',
  'allegro-one-kurier',
  'poczta-polska',
  'ups',
  'packeta',
] as const;

export type KnownCarrier = (typeof KnownCarrierValues)[number];
// Field type: `KnownCarrier | string` — open at the registry boundary.
```

**Asymmetric openness.** The BE accepts any string (plugin adapter could register `'shopify-shipping'` tomorrow); the FE renders a deep-link URL **only for values in `KnownCarrierValues`** and gracefully falls back to monospace copy-text for any other value. This is the same shape `architecture-overview.md` documents for `CoreCapability | string` — closed at the type, open at the runtime boundary, closed again at the consuming UI surface (which is allowed to know only what it knows). A freshly-deployed plugin can populate `Shipment.carrier = 'shopify-shipping'` and the panel renders cleanly with no broken-link UX.

**When the field is null.** A freshly-dispatched Allegro Delivery shipment has `carrier === null` until the first status-sync poll backfills it (same async-arrival shape as `trackingNumber`). The FE treats null the same as unknown — "no public tracker available, show waybill as copy-text".

### 3.1 BE endpoint shape

```ts
// apps/api/src/shipping/http/shipment.controller.ts (new method)

@Post(':id/notify-dispatched')
@HttpCode(HttpStatus.OK)
@ApiOperation({
  summary:
    'Manually fire #837 dispatch-notify orchestration: source mark-shipped + ' +
    'destination OMP fulfillment-update + advance Shipment.status to dispatched',
})
@ApiResponse({ status: 200, type: NotifyDispatchedResponseDto })
@ApiResponse({ status: 404, description: 'Shipment not found' })
async notifyDispatched(@Param('id') id: string): Promise<NotifyDispatchedResponseDto> {
  const result = await this.notification.notifyDispatched({ shipmentId: id });
  if (result.outcome === 'shipment-not-found') {
    throw new NotFoundException(`Shipment not found: ${id}`);
  }
  return NotifyDispatchedResponseDto.fromResult(result);
}
```

**Response DTO** mirrors the existing `ShipmentDispatchNotificationResult` shape (`outcome | source | destinations[]`) — so the FE can show "Notified source + 2 destinations" or "Skipped — already past `generated`".

**Auth:** `@UseGuards(JwtAuthGuard)` — same as every other shipment endpoint. (Class-level guard already present at line 60.)

**Error mapping:** the service returns a result type rather than throwing for the gate-skipped case (`'skipped-not-generated'`) — return 200 with the result so the FE can render a `tone="info"` Alert rather than treating it as a failure. Only `shipment-not-found` becomes a 404. Underlying source/destination 5xx propagate through (per #837's design).

### 3.2 FE API + hook surface

```ts
// apps/web/src/features/shipments/api/shipments.api.ts (extend)

interface ShipmentsApi {
  list(filters?: ShipmentFilters, pagination?: ShipmentPagination): Promise<PaginatedShipments>;
  getById(id: string): Promise<Shipment>;
  getActiveByOrderId(orderId: string): Promise<Shipment | null>;
  generateLabel(input: GenerateLabelInput): Promise<DispatchResult>;
  cancel(id: string): Promise<Shipment>;
  notifyDispatched(id: string): Promise<NotifyDispatchedResult>;
}

// apps/web/src/features/shipments/hooks/

useOrderShipmentsQuery(orderId: string)            // GET /shipments?orderId=
useGenerateLabelMutation()                         // POST /shipments/generate-label
useCancelShipmentMutation()                        // POST /shipments/:id/cancel
useNotifyDispatchedMutation()                      // POST /shipments/:id/notify-dispatched
```

**Cache-key invariants.** Every mutation invalidates `shipmentsQueryKeys.list({ orderId })` for the affected order; the order's detail page already re-renders on data change. `useOrderShipmentsQuery` is a thin wrapper over `useShipmentsQuery({ orderId })` for ergonomic call sites; no new query key.

**Why a wrapper hook for `useOrderShipmentsQuery`?** The order-detail call site only wants shipments for one order; the wrapper hides the filter shape, keeps the query-key consistent across panel + mutations, and gives one place to add order-shipments-specific options (e.g. `refetchInterval` if we later poll for async-dispatch progress).

### 3.3 Component shape

**Primitive composition.** The panel is a single dense card built from the shared/ui primitive catalog — no custom layout primitives, no decorative chrome:

| Slot | Primitive | Notes |
|---|---|---|
| Outer container | `<section class="detail-section">` | Same primitive every order-detail panel uses (Summary, Sync Status, etc.) |
| Header | `<h3>` + `<ShipmentStatusBadge>` (right-aligned via flexbox) | Heading "Shipment", badge to the right |
| Field rows (tracking / carrier / paczkomat / dispatched-at) | `<KeyValueList>` | `120px auto` grid, mono values where useful, hover-only copy buttons per the primitive |
| Pre-flight warning | `<Alert tone="warning">` | Only when prerequisites are missing (e.g. no parcel dimensions yet) |
| Most-recent mutation error | `<Alert tone="error">` | Inline at panel bottom |
| Empty state (no shipment row) | `<EmptyState>` | Headline + description + primary CTA — see §3.8 sketch |
| Top-level fetch error | `<ErrorState>` | If `useOrderShipmentsQuery` itself fails — distinct from mutation errors |
| Action row | `<Button>` × 3 | Status-gated per §3.4 |
| Cancel confirmation | `<ConfirmDialog tone="danger">` | Destructive — wraps `@radix-ui/react-dialog` |
| Mark-dispatched confirmation | `<ConfirmDialog tone="default">` | Manual override — confirm, not warn |
| Generate-label entry | **Inline expansion within the panel** — NOT a Dialog | See "Modal vs inline" below |

**Why not Tabs / DetailDrawer / Timeline-section.** Tabs would advertise multi-shipment-per-order that doesn't exist in v1. DetailDrawer is the slide-in-from-right pattern; the panel is embedded. Timeline is for activity history (which lives in the existing Activity Timeline panel below this one).

**Sizing + spacing.** All values from `apps/web/src/index.css :root`; no raw px/rem in component CSS (per `frontend-ui-style-guide.md § CSS Implementation Standard`):

| Slot | Token | Rationale |
|---|---|---|
| Panel section padding | `var(--space-5)` (24 px) | Matches existing `.detail-section` per style guide § Spacing And Shape ("panel padding: `var(--space-4)` to `var(--space-5)`") |
| Header → body gap | `var(--space-3)` (12 px) | Tight cockpit density |
| Body → action-row gap | `var(--space-4)` (16 px) | Slightly larger to separate semantic regions |
| Card radius | `var(--radius-lg)` (10 px) | Inherits per style guide § Spacing And Shape ("cards (KPI/metric, feedback-state, table container): `var(--radius-lg)` — 10 px") |
| Action buttons (active-shipment state) | `Button size="sm"` (28 px) | Section-internal actions — match toolbar-button density per § Density & Row Heights |
| Primary action (Generate Label) | `Button tone="primary"` (signal-orange) | Per #775 "primary CTA is signal orange" — used sparingly, this is one of the allowed sites |
| Cancel button | `Button tone="danger"` | Destructive per § MVP Primitives Standard |
| Mark-dispatched button | `Button tone="secondary"` | Manual override, not destructive enough for danger |
| Empty-state CTA | `Button tone="primary" size="md"` (32 px) | Sole CTA in empty state earns the larger size per § Density & Row Heights ("Button md: default for page-header actions and forms") |

**Modal vs inline — Generate Label opens inline.** The form is a 4-field forward-CTA, not destructive and not irreversible. Style guide § Forms reserves `Dialog`/`ConfirmDialog` for "destructive resets or irreversible actions." Generate Label is neither. Inline expansion within the panel:
- Keeps order context visible (operator often cross-references the order's addresses + line items while filling parcel dimensions)
- Lighter on mobile (no full-screen Dialog takeover for a 4-field form)
- Clearer cancel UX (the panel toggles back to compact view; no overlay to dismiss)

Cancel + Mark Dispatched DO use `<ConfirmDialog>` because they're destructive / manually override an automatic flow.

**Responsive layout (§ Responsive parity matrix).**

| Breakpoint | Action row | Dimension input row (Generate Label form) | KeyValueList |
|---|---|---|---|
| ≥ 1024 px (desktop anchor) | 3 buttons inline, right-aligned | 3 inputs in one row (composite "Dimensions (mm)") | `120px auto` 2-col grid |
| 768 – 1023 px (tablet) | identical to desktop | identical to desktop | identical to desktop |
| ≤ 767 px (mobile) | `flex-wrap: wrap` — buttons wrap to multi-row if needed; **never hide**. Each button ≥ 36 px touch height (sm-size auto-grows per existing `.btn--sm` token rule) | `grid-template-columns: repeat(auto-fit, minmax(80px, 1fr))` — auto-stacks below 480 px without media queries | unchanged (value column shrinks naturally) |

No "open on desktop to edit" hint — this form is small enough to stay interactive on mobile (per the style guide's "Interactive editing on mobile is out of scope" rule, which targets complex editors like category mappings; a 4-field form doesn't qualify).

**File shape.**

```
features/orders/components/
├── order-shipment-panel.tsx            (NEW — top-level panel)
├── generate-label-form.tsx              (NEW — inline expansion body for "Generate label")
├── shipment-tracking-link.tsx           (NEW — carrier-aware link helper)
└── shipment-action-buttons.tsx          (NEW — status-gated action row)

features/shipments/
├── api/shipments.api.ts                (EXTEND — add mutations)
├── api/shipments.types.ts              (EXTEND — input/output types)
├── api/shipments.query-keys.ts          (no change — list-by-orderId already keyed)
├── lib/carrier-tracking-url.ts          (NEW — carrier → URL map + pure helper)
├── hooks/use-order-shipments-query.ts  (NEW — wrapper)
├── hooks/use-generate-label-mutation.ts (NEW)
├── hooks/use-cancel-shipment-mutation.ts (NEW)
├── hooks/use-notify-dispatched-mutation.ts (NEW)
└── index.ts                            (EXTEND — public-barrel re-exports)
```

### 3.4 Status-gated action matrix

Operator actions are enabled **only** in states where they're meaningful:

| Shipment.status | Generate label | Cancel | Mark dispatched (#837 notify) |
|---|---|---|---|
| _(no shipment row for this order yet)_ | enabled | — | — |
| `draft` | enabled (retry) | — | — |
| `generated` | — (only one active shipment per order; need cancel-first) | enabled | enabled |
| `dispatched` | — | — (past the cancellable window — provider rejects) | — (already past gate) |
| `in-transit` | — | — | — |
| `delivered` / `failed` / `cancelled` | enabled (new shipment for the same order) | — | — |

**Re-issue** (#769 AC-6) is composed from two clicks: **Cancel** → status becomes `cancelled` → **Generate label** opens the form again. No new endpoint, no compound BE flow.

The "only one active shipment per order" gate is enforced BE-side (`findActiveByOrderId` + the dispatch service rejects when an active shipment exists); the FE just disables the button + tooltips why.

### 3.5 Capability-conditional rendering

Two layers (per §3.0's terminology):

**Layer 1 — panel-render gate (AC-8 — global "no shipping configured at all" hide).** Checks whether any connection in the user's environment declares the shipping capability:

```ts
const { data: connections } = useConnectionsQuery();
const hasShippingCapability = connections?.some((c) =>
  c.supportedCapabilities.includes('ShippingProviderManager'),
);
if (!hasShippingCapability) return null;
```

**Layer 2 — copy-flavor gate (AC-3 — "buyer's pickup point pre-filled" caption).** Keyed on the **shipping (processor) connection's `platformType`** for the row in question — `Shipment.connectionId` → look up via the connections collection already fetched in Layer 1:

```ts
const shippingConnection = connections?.find((c) => c.id === shipment.connectionId);
const isAllegroDelivery = shippingConnection?.platformType === 'allegro';
const paczkomatCaption = isAllegroDelivery
  ? 'Paczkomat (buyer-selected via Allegro)'  // buyer chose at checkout — Allegro brokered
  : 'Paczkomat (operator-selected)';           // InPost own-contract — operator set via picker (or, in this PR, via API)
```

Why processor-keyed and not source-keyed: the paczkomat-selection semantics ("buyer chose" vs "operator picked") are a property of the dispatch flow that wrote the row, not the order's marketplace origin. A PrestaShop-sourced order routed to Allegro Delivery (via #832 routing) still gets "buyer-selected via Allegro" because the dispatch flow itself is Allegro-brokered. Source-marketplace identity (`OrderRecord.sourceConnectionId`) is not consulted here.

### 3.6 Async-pending UX (AC-2)

Allegro Delivery's `generateLabel` is asynchronous (BE polls the `/shipment-management/.../create-commands` command-status until terminal, see `pollUntilTerminal` in `allegro-delivery-shipping.adapter.ts`). The BE returns a `DispatchResult` synchronously when the poll completes; if the bounded budget exhausts while the command is still `IN_PROGRESS`, the BE throws `AllegroShipmentPendingException` — which the FE must surface as "Dispatch pending — Allegro is still processing, retry to check status" rather than a generic error.

The FE pattern (refined for a 10–30s wait, per `frontend-ui-style-guide.md § Async UX Conventions`):

1. **`useGenerateLabelMutation` uses the standard `isPending` flag** for the in-flight HTTP request state. Mutation hook surface is plain TanStack Query; no custom orchestration layer.
2. **The whole form is disabled during `isPending`**, not just the submit button. Prevents accidental re-submits (operator might click twice when a request feels slow). Implementation: a top-level `<fieldset disabled={mutation.isPending}>` wrapping the form body.
3. **Submit button copy carries an explicit duration cue** — `Generating label… (~30s)` — so operator knows it's a slow path, not a hung request. The fixed estimate is fine; Allegro's actual range is ~10–30s and operators read this as "expect a delay" not "exactly 30s."
4. **After 5s, show an inline `<LoadingState>` primitive** below the form fields with copy "Allegro is processing your label. This typically takes 10–30 seconds." Implementation: `const [showSlow, setShowSlow] = useState(false); useEffect(() => { if (!isPending) { setShowSlow(false); return; } const t = setTimeout(() => setShowSlow(true), 5000); return () => clearTimeout(t); }, [isPending]);`. Cocks immediately on cancel, won't fire if the request resolves under 5s.
5. **The LoadingState message is wrapped in `<div role="status" aria-live="polite">`** so screen readers announce the slow-wait copy as it appears. Mirrors the a11y patterns in §3.9.
6. **`<Toast tone="success">`** on completion: `"Label generated. Tracking number will appear within ~5 minutes."` — explicit about the tracking-arrival async because the carrier waybill comes via #838's status-sync, not synchronously from generate-label.
7. **`<Alert tone="info">`** inside the panel (not the form) on `AllegroShipmentPendingException`: `"Dispatch pending — Allegro is still processing. Refresh in ~30s, or check the Activity Timeline below."` Operator has actionable guidance, not a generic error.
8. **`extractPlatformErrors` plugin extractor** (existing) handles the exception → readable message mapping. Verify the Allegro extractor knows `AllegroShipmentPendingException` (one-line add if not — flagged as risk #8 in §6).

**No FE-side polling.** The BE poll bounds the wait; the FE doesn't need its own polling layer. (A future enhancement when async commands are operator-visible: a `usePollShipmentStatus(shipmentId)` hook that re-fetches every 5 s while the shipment is in a transient state — but that's `pending` UX polish, not a correctness gate.)

### 3.7 Tracking link composition

Keyed on `Shipment.carrier` (the carrier-of-record introduced in this PR), NOT on `Shipment.connectionId`'s `platformType` (the dispatcher). Rationale: Allegro Delivery is a brokerage that subcontracts to ~9 distinct carriers per spec §3.2 — a `platformType === 'allegro'` shipment might physically be an InPost waybill, an ORLEN waybill, a DPD waybill, etc. Linking to `allegro.pl/moje-allegro/…` would (a) hit Allegro's seller-auth wall and (b) not even be the right page when the operator wants the carrier-of-record's public tracker. See §3.0 for the underlying terminology + the `Shipment.carrier` field.

```ts
// apps/web/src/features/shipments/lib/carrier-tracking-url.ts

const CARRIER_TRACKING_URLS: Record<string, (waybill: string) => string> = {
  'inpost':                 (n) => `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(n)}`,
  'dpd':                    (n) => `https://tracktrace.dpd.com.pl/findParcel?p1=${encodeURIComponent(n)}`,
  'dhl':                    (n) => `https://mojadhl.dhl.com.pl/?awb=${encodeURIComponent(n)}`,
  'orlen':                  (n) => `https://nadaj.orlenpaczka.pl/?numer=${encodeURIComponent(n)}`,
  'allegro-one-box':        (n) => `https://allegro.pl/moje-allegro/zakupy/szczegoly-przesylki?numerListu=${encodeURIComponent(n)}`,
  'allegro-one-punkt':      (n) => `https://allegro.pl/moje-allegro/zakupy/szczegoly-przesylki?numerListu=${encodeURIComponent(n)}`,
  'allegro-one-kurier':     (n) => `https://allegro.pl/moje-allegro/zakupy/szczegoly-przesylki?numerListu=${encodeURIComponent(n)}`,
  'poczta-polska':          (n) => `https://emonitoring.poczta-polska.pl/?numer=${encodeURIComponent(n)}`,
  'ups':                    (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  'packeta':                (n) => `https://tracking.packeta.com/?id=${encodeURIComponent(n)}`,
};

export function buildCarrierTrackingUrl(shipment: Shipment): string | null {
  if (!shipment.trackingNumber || !shipment.carrier) return null;
  return CARRIER_TRACKING_URLS[shipment.carrier]?.(shipment.trackingNumber) ?? null;
}
```

**Graceful degradation.** When `carrier === null` (status-sync hasn't backfilled yet, freshly-dispatched Allegro Delivery), when `trackingNumber === null` (no waybill yet), or when the carrier value isn't in the map (unknown / future carriers), the helper returns `null`. The panel falls back to displaying the tracking number as monospace text with a copy button — no broken-link UX, no auth wall, no second-guessing.

**Allegro One sub-categories.** The three `'allegro-one-*'` carrier values all map to the same Allegro seller-side URL because Allegro One is Allegro's own first-party network — no underlying carrier exists, the tracking surface is genuinely Allegro's. This is the one case where the Allegro-seller-auth caveat is unavoidable; for every other carrier value (InPost / DPD / DHL / ORLEN / etc.), we deep-link to the public courier tracker and bypass the auth entirely.

**Anchor attributes.** Rendered as `<a target="_blank" rel="noopener noreferrer">` to neutralise reverse-tabnabbing on every external link.

**Map keys come from `KnownCarrierValues` (§3.0).** The map keys correspond 1:1 with the `KnownCarrierValues as const` array in `tracking-snapshot.types.ts`. A unit test (Step 5's helper test) asserts coverage: every value in `KnownCarrierValues` has a corresponding URL builder, and the panel renders copy-text fallback for any value NOT in the map (string-typed escape hatch for plugin-registered values like `'shopify-shipping'`). Adding a new known carrier is a two-line edit: append to `KnownCarrierValues` (core) + add an entry to the map (FE). The test fails until both sides are wired.

**Where the carrier value comes from.** §3.0 establishes the field. The status-sync service (#838) writes it to the `Shipment` row alongside `trackingNumber` whenever a snapshot's `carrier` is non-empty and the row's existing `carrier` is null (same null→value backfill discipline as `trackingNumber`). InPost own-contract dispatches get `'inpost'` written at `getTracking` time. Allegro Delivery dispatches get the brokered carrier id (normalized via the mapper from Allegro's `transportingInfo[].carrierId`).

**Promotion seam — when, not if.** With 10 known carriers in the static map today, this file already sits at the documented "hard-coded glue at the leaf is acceptable below 3 carriers" threshold. The placement holds for v1 only because (a) both InPost and Allegro plugins consume the same map (no per-plugin URL logic), and (b) the URL builders are trivial template literals. **Concrete promotion trigger:** when #834 (PS branch-1 read-back) lands, PS-fulfilled rows will surface PS-specific carrier names (whatever the operator configured under `order_carriers` — e.g. "DHL Express Worldwide", "UPS Standard PL") that aren't in `KnownCarrierValues` today. At that same PR — **not as a follow-up** — promote URL composition to a per-plugin `PlatformContribution.buildCarrierTrackingUrl(carrier: string, waybill: string) => string | null` slot, with the host providing the static map for the canonical-name carriers as a default fallback. Static map stays as the seed; plugins layer on top.

### 3.8 What the panel looks like (ASCII sketch)

Allegro-Delivery-brokered shipment, carrier resolved to InPost (typical case):

```
┌─ Shipment ──────────────────────────────── [Status badge ────────] ┐
│                                                                    │
│  Tracking number   6800000001    [copy]   ▶ inpost.pl/track       │
│  Carrier           InPost                                          │
│  Paczkomat         POZ08A — Stary Browar  (buyer-selected via Allegro) │
│  Dispatched at     —                                                │
│                                                                    │
│  [ Generate label ]   [ Cancel ]   [ Mark dispatched ]              │
│                                                                    │
│  ⚠ Pre-flight: parcel dimensions required to generate a label.     │
└────────────────────────────────────────────────────────────────────┘
```

InPost own-contract shipment (operator-selected paczkomat, same carrier `'inpost'`, same tracker URL):

```
│  Tracking number   6800000002    [copy]   ▶ inpost.pl/track       │
│  Carrier           InPost                                          │
│  Paczkomat         WAW123 — Plac Defilad  (operator-selected)      │
```

Freshly-dispatched Allegro Delivery row before status-sync has backfilled:

```
│  Tracking number   —                                                │
│  Carrier           —  (awaiting Allegro Delivery)                   │
```

When no shipment row exists for the order yet, the panel renders the `<EmptyState>` shared/ui primitive (NOT a custom inline block):

```
┌─ Shipment ────────────────────────────────────────────────────────┐
│                                                                   │
│                    No shipment yet                                │  ← <EmptyState title=...>
│         Generate a label to dispatch this order.                  │  ← <EmptyState description=...>
│                                                                   │
│                  [ Generate label ]                               │  ← <EmptyState action={...}>
│                                                                   │     Button tone="primary" size="md"
└───────────────────────────────────────────────────────────────────┘
```

The empty state uses `<EmptyState title="No shipment yet" description="Generate a label to dispatch this order." action={<Button tone="primary" size="md">Generate label</Button>} />` — three props, no custom layout. Clicking the action toggles into the inline-expansion Generate Label form (§3.3 "Modal vs inline"). Signal-orange `tone="primary"` is one of the explicitly-allowed accent sites per #775 ("primary buttons"); the larger `size="md"` (32 px) reflects its role as the sole CTA.

When the panel's own query fails (network error, server 5xx — distinct from a mutation error), it renders `<ErrorState>` instead with retry affordance — same primitive every other order-detail panel uses.

When `useOrderShipmentsQuery(orderId)` is loading first time, it renders a `<Skeleton>` matching the panel's row structure (status badge placeholder + 4 grayed field rows + grayed button). See Step 6 for the skeleton primitive decision (introduce if missing).

### 3.9 Accessibility

Per `frontend-ui-style-guide.md § Accessibility` ("keyboard navigable shell and filters, visible focus states, sufficient contrast, badges that do not rely only on color, field-level error association, accessible tables and status labels"). The panel's a11y obligations:

| Concern | Implementation |
|---|---|
| **Focus return — Cancel + Mark Dispatched `<ConfirmDialog>`** | Handled automatically by `@radix-ui/react-dialog` (wrapped by the `Dialog` primitive). On close, focus returns to the trigger button. No manual ref needed. |
| **Focus management — Generate Label inline expansion** | Manual: `const triggerRef = useRef<HTMLButtonElement>(null);` On expansion open, `useEffect` moves focus to the first form field. On collapse (cancel or success), `triggerRef.current?.focus()` returns focus to the Generate Label trigger. ~8 lines of code. |
| **Pending state announcement (Generate Label)** | Wrap the "Allegro is processing your label…" copy in `<div role="status" aria-live="polite">`. Screen readers announce when the slow-state copy appears (5s after submit) without interrupting the user. |
| **StatusBadge `aria-label`** | Verify the existing `ShipmentStatusBadge` sets `aria-label` like `"Shipment status: Dispatched"` (per § Status Badge "always include status text — colour and dot are reinforcement, not substitutes"). If missing, one-line fix on the badge component, NOT the panel. |
| **Copy-to-clipboard button** | `aria-label="Copy tracking number"` on the button; success announcement comes from the existing `<Toast>` primitive's ARIA region. |
| **External tracking link** | `<a href target="_blank" rel="noopener noreferrer" aria-label="Track shipment on {Carrier display name} (opens in new tab)">{trackingNumber} <ExternalLinkIcon aria-hidden /></a>` — visible icon + clear aria-label. The icon is a small `<svg aria-hidden>` (16×16, mono stroke, no decorative animation). |
| **Form field wiring** | `<FormField>` primitive already provides label/control/description/error wiring with `aria-invalid` and `aria-describedby` per shared/ui catalog. |
| **Color is never the only signal** | StatusBadge `withDot` ensures dot + text both convey status; the `pulse` modifier adds motion but text remains the primary affordance. Pre-flight warning uses `<Alert tone="warning">` which combines tone + icon + text. |
| **Keyboard reachability** | All interactive elements reachable via tab order in source-order: status badge (focusable for `aria-label` read-out), field-row copy buttons (when present), action buttons left-to-right, then form fields (when expanded). No `tabIndex` overrides. |
| **Visible focus rings** | All buttons inherit `--accent-focus` ring per § Theme Tokens. No `:focus { outline: none }` overrides anywhere — this would fail § Accessibility's "visible focus states" requirement. |

---

## 4. Step-by-step implementation

Each step ends with the smallest verifiable check.

### Coding rules every new file must satisfy

These apply to every file introduced or substantially edited in §4; called out once here rather than repeated in each step.

- **File header** — per `engineering-standards.md § File Headers`, every new `.ts` / `.tsx` file opens with a `/** … */` header naming the file's purpose + 2–4 lines of context + `@module` tag. For service implementations also add `@implements {IFoo}`; for components add `@module features/<name>/components`.
- **Types in separate `*.types.ts`** — no inline `type`/`interface` declarations in component / service / DTO files. New domain enumerated values follow the `as const` + derived union pattern (per `engineering-standards.md § Union Types`).
- **No `any`** — use `unknown` + narrowing when a type genuinely can't be expressed.
- **Logging via `@openlinker/shared/logging`** — never `console.*`. Class-scoped `private readonly logger = new Logger(ClassName.name)`.
- **Naming** — components `kebab-case.tsx` with `PascalCase` named export, hooks `use-*.ts`, tests `*.test.tsx` / `*.spec.ts`. Test names follow `should [behavior] when [condition]`.
- **Cross-feature imports** — through the feature's public barrel only (`features/shipments/index.ts`). The ESLint pattern groups for `features/orders → features/shipments` must already be enabled across the five canonical sub-dirs (`api`, `hooks`, `components`, `lib`, `types`); confirm at Step 4.

**Step 0 — BE: introduce `Shipment.carrier` end-to-end (the §3.0 + §3.7 prerequisite)** _(medium, ~half-day)_
   1. **Port + carrier vocabulary** — in `libs/core/src/shipping/domain/types/tracking-snapshot.types.ts`:
      ```ts
      export const KnownCarrierValues = [
        'inpost', 'dpd', 'dhl', 'orlen',
        'allegro-one-box', 'allegro-one-punkt', 'allegro-one-kurier',
        'poczta-polska', 'ups', 'packeta',
      ] as const;
      export type KnownCarrier = (typeof KnownCarrierValues)[number];
      ```
      Add `carrier?: KnownCarrier | string` to `TrackingSnapshot` (the `| string` allows plugin adapters to register new values without core PRs — per `architecture-overview.md § Future Capability Ports` "open at the registry boundary" pattern). JSDoc on the field explains the brokerage rationale + the closed-core / open-runtime / closed-FE asymmetry (cross-references §3.0). Same `as const` shape every other status-vocabulary type in core follows (`ShipmentStatusValues`, `ConnectionStatusValues`, `CoreCapabilityValues`).
   2. **Allegro adapter** — `extractCarrierWaybill` already walks `transportingInfo`; add a sibling `extractCarrierId` that pulls `transportingInfo[].carrierId` (Allegro's wire-shape enum) and a tiny `normalizeAllegroCarrierId` that maps Allegro's `INPOST` / `DPD` / `ALLEGRO_ONE_BOX` / … to the canonical lowercase-kebab form. `getTracking` populates `carrier` from `extractCarrierId(resource)`. Mapper spec + adapter spec gain coverage for each carrier mapping + the unknown-carrier passthrough (let unknown values flow through unmapped — falls back to "no link" in the FE).
   3. **InPost adapter** — `getTracking` populates `carrier: 'inpost'` (one-line literal in the existing return statement).
   4. **Domain entity** — add `carrier: string | null` to `Shipment` (`shipment.entity.ts`) as a new readonly constructor field at the end (avoid mid-position to keep call-site ordering stable for the existing repository).
   5. **ORM entity** — add `@Column({ type: 'text', nullable: true }) carrier!: string | null` to `shipment.orm-entity.ts` with an index (matches `trackingNumber`'s existing shape).
   6. **Migration** — `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddShipmentCarrier` to generate the additive nullable column + index. Confirm filename + class timestamp match per the migration-naming invariant.
   7. **Repository** — `ShipmentRepository.toDomain` + `toOrm` map the new field; `update` accepts `carrier` in `UpdateShipmentInput`; mapper-private `buildUpdatePayload` includes it.
   8. **Status-sync write path** — `ShipmentStatusSyncService.buildPatchAndMaybePush` (the #838 service) extends the null→value backfill pattern: when `shipment.carrier === null && snapshot.carrier` is a non-empty string, include `carrier` in the patch. Same gate as `trackingNumber` — they always backfill together for Allegro Delivery. **Once-written-never-overwritten invariant**: same discipline as `trackingNumber`. If Allegro mid-routes a shipment to a different carrier (rare but possible — e.g. an InPost-bound paczkomat shipment that Allegro re-routes to ORLEN mid-flight), the operator workflow is cancel + re-issue the shipment, not mutate `carrier` on the existing row. The status-sync service explicitly skips the write when `shipment.carrier !== null`. Unit spec for the service gains two cases (carrier-backfilled-when-null, carrier-overwrite-blocked-when-already-set).
   9. **HTTP DTO** — `ShipmentResponseDto.carrier` field (typed `string | null` since the DTO is the wire shape, where the open-string-set escape hatch lives) + `fromDomain` mapping. **Bonus surfacing:** because `ShipmentResponseDto` is also the row shape returned by `GET /shipments` (list) — not just `GET /shipments/:id` — the FE's existing `useShipmentsQuery` consumers automatically read the new `carrier` field. When the deferred AC-7 `/shipments` column extension lands (alongside #834), no further BE work is needed: the column is BE-side ready from this PR.
   10. **Controller specs + int-spec** — existing shipment-read int-spec extended to assert `carrier` round-trips; existing dispatch-notification int-spec extended to assert `carrier === 'inpost'` after dispatch through the stub carrier (helper carrier stub returns `carrier: 'inpost'` in `getTracking`).
   11. **Check:** `pnpm lint && pnpm type-check && pnpm test`; `pnpm --filter @openlinker/api migration:show` shows the new migration as pending; `pnpm test:integration` covers the shipping int-specs.

   **Why a column + status-sync write (not a per-render `getTracking` call):** the panel renders the carrier on every shipment row; calling `getTracking` per render would hammer the carrier API. Persisting on the row makes carrier read-side trivially cheap and aligns with how `trackingNumber` is already handled (#838 backfills it, the panel reads it).

   **Why a literal write at `getTracking` for InPost (no `dispatch`-time write):** matches the contract — `carrier` is part of the `TrackingSnapshot`, and the snapshot is the seam. The status-sync poll fires after dispatch and writes both fields together. For InPost own-contract this happens on the first poll within seconds (`generateLabel` doesn't produce a snapshot directly today; if that ever changes, the dispatch path can write the carrier literal upfront as a small optimisation, but it's not required for correctness).

**Step 1 — BE: `POST /shipments/:id/notify-dispatched`** _(small, ~30 min)_
   1. Add `notifyDispatched` controller method (`apps/api/src/shipping/http/shipment.controller.ts`).
   2. Add `NotifyDispatchedResponseDto` (`apps/api/src/shipping/http/dto/notify-dispatched-response.dto.ts`): PascalCase class, `*-response.dto.ts` filename per `engineering-standards.md § Interface Layer Files`, exposes `{ shipmentId, outcome, source, destinations[] }` shape mirroring `ShipmentDispatchNotificationResult`, ships a static `fromResult(result): NotifyDispatchedResponseDto` factory (matching the precedent set by `DispatchResultResponseDto.fromResult` and `ShipmentResponseDto.fromDomain`).
   3. Activate the already-injected `notification: IShipmentDispatchNotificationService` (constructor field at controller line 67).
   4. Unit spec — extend `shipment.controller.spec.ts` to cover the new method (happy path, not-found, skipped-not-generated). Test names follow the `should [behavior] when [condition]` form.
   5. **Check:** `pnpm --filter @openlinker/api exec jest --testPathPattern=shipment.controller.spec` ⇒ all pass.

**Step 2 — BE integration spec for the new endpoint** _(small, ~30 min)_
   1. Add a `notifyDispatched` test block to `apps/api/test/integration/shipment-dispatch-notification.int-spec.ts` (the existing int-spec already seeds source + dest stubs; we add HTTP calls).
   2. Cover: happy path (200 + outcome=notified), shipment-not-found (404), idempotent re-call (200 + outcome=skipped-not-generated).
   3. **Check:** `pnpm --filter @openlinker/api exec jest --config test/jest-integration.cjs --testPathPattern=shipment-dispatch-notification --runInBand` ⇒ all pass.

**Step 3 — FE: extend `features/shipments/api/`** _(small, ~30 min)_
   1. Add `generateLabel`, `cancel`, `notifyDispatched` methods to `ShipmentsApi`.
   2. Add input/output transport types to `shipments.types.ts` (mirroring the BE DTOs in `apps/api/src/shipping/http/dto/`).
   3. Add the methods to `createShipmentsApi` factory.
   4. **Check:** `pnpm --filter @openlinker/web type-check`.

**Step 4 — FE: mutation + query hooks** _(small, ~1 hr)_
   1. `use-order-shipments-query.ts` — thin wrapper over `useShipmentsQuery({ orderId })`.
   2. `use-generate-label-mutation.ts` — invalidates `shipmentsQueryKeys.list({ orderId })` on success.
   3. `use-cancel-shipment-mutation.ts` — invalidates same.
   4. `use-notify-dispatched-mutation.ts` — invalidates same + orders-detail key (the order row's `lastDispatchedAt` may change downstream).
   5. Re-export from `features/shipments/index.ts` (every symbol that `features/orders/components/order-shipment-panel.tsx` will read must appear here — the public-barrel rule is ESLint-enforced).
   6. **ESLint pattern audit:** confirm `.eslintrc.js`'s `no-restricted-imports` pattern groups for `features/orders/**` include the `shipments` slug across every canonical sub-dir (`api`, `hooks`, `components`, `lib`, `types`) — per `frontend-architecture.md § Feature Public Surface` ("Add the slug to both `no-restricted-imports` pattern groups in `.eslintrc.js`"). Since `features/shipments` already exists (the #770 `/shipments` page), the pattern groups should already be wired — but a missing slug fails open silently for that one sub-dir, so check explicitly: `grep -n "shipments" apps/web/.eslintrc.js` should match 5 lines (one per canonical sub-dir).
   7. **Check:** `pnpm --filter @openlinker/web type-check` + `pnpm --filter @openlinker/web lint` (the latter catches a missing public-barrel re-export at lint time).

**Step 5 — FE: carrier-keyed tracking-link helper (moved from Step 8 — must land before Step 6 consumes it)** _(small, ~30 min)_
   1. `features/shipments/lib/carrier-tracking-url.ts` — the `CARRIER_TRACKING_URLS` map + `buildCarrierTrackingUrl(shipment)` helper from §3.7. Pure function, no React. Keys against `KnownCarrierValues` (imported via the `@openlinker/core/shipping` barrel — but FE typings mirror the core type, so the import is type-only to avoid pulling in core's runtime).
   2. `features/orders/components/shipment-tracking-link.tsx` — accepts `shipment`, calls the helper, renders `<a target="_blank" rel="noopener noreferrer">` when the helper returns a URL or monospace copy-text when it returns `null`. URL params are `encodeURIComponent`'d (already in the map's builders).
   3. Re-export the helper from `features/shipments/index.ts` (so the next step's panel reads it through the public barrel).
   4. Unit test for `buildCarrierTrackingUrl`: each value in `KnownCarrierValues` resolves to a URL (loop over the constant array — the test compiles only when the map is complete); unknown carrier value returns `null`; null carrier returns `null`; null trackingNumber returns `null`. The loop-over-`KnownCarrierValues` shape is what makes adding a new carrier a compile-required change: append to core's array → FE test forces the map update.

**Step 6 — FE: `<OrderShipmentPanel orderId={...} />`** _(medium, ~3 hr)_
   1. `features/orders/components/order-shipment-panel.tsx` — top-level component composing `<section class="detail-section">` + `<h3>` + `<ShipmentStatusBadge>` (right-aligned via flex) + `<KeyValueList>` (field rows) + action row (per §3.3 primitive table).
   2. Capability-gating against `useConnectionsQuery` (per §3.5 Layer 1 + Layer 2 — render nothing if no connection declares `ShippingProviderManager`; key Allegro-flavored copy on shipping connection's `platformType`).
   3. Fetches `useOrderShipmentsQuery(orderId)`. Three render branches:
      - **`isLoading`** — render `<Skeleton>` matching the panel's row structure (header row + 4 grayed field rows + grayed button). **Skeleton primitive check:** verify `shared/ui` exports `<Skeleton>` or equivalent. If yes, use it. If no, add a minimal `<Skeleton>` primitive in this PR — single CSS class `.skeleton` with `--bg-strong` background + 1s `@keyframes` pulse animation, wrapped React component accepts `width` + `height` props. Adding the primitive triggers § MVP Primitives Standard rule "Use the same primitive in a real page immediately after introducing it" — this panel is the consumer, so the rule is satisfied. Adds ~20 lines (primitive + CSS) to this PR's diff.
      - **`isError`** — render `<ErrorState>` with retry affordance.
      - **`data` (success)** — render the panel body. Two sub-cases:
        - **No shipment row exists** — render `<EmptyState title="No shipment yet" description="Generate a label to dispatch this order." action={<Button tone="primary" size="md">Generate label</Button>} />` (per §3.8 sketch).
        - **Shipment row exists** — render `<KeyValueList>` (tracking + carrier + paczkomat + dispatched-at) + `<ShipmentActionButtons />` (Step 7) + status-gated alerts.
   4. Status badge renders with `withDot` always + `pulse` when status is `dispatched | in-transit` (matches the in-flight visual signal — Step 10 includes the pulse test).
   5. Renders `<ShipmentTrackingLink>` (Step 5) for the tracking number row (URL + copy fallback per the helper).
   6. Inline `<Alert tone="error">` at panel bottom for the most recent mutation error (from any of the three mutations); `<Alert tone="info">` for the `AllegroShipmentPendingException` case (per §3.6 step 7); `<Alert tone="warning">` for pre-flight prereq warnings.
   7. All spacing uses tokens (`var(--space-{3,4,5})`); no raw px/rem (per § CSS Implementation Standard).

**Step 7 — FE: `<ShipmentActionButtons />`** _(small, ~1 hr)_
   1. `features/orders/components/shipment-action-buttons.tsx`.
   2. Computes per-button enablement from `Shipment.status` (§3.4 matrix).
   3. **Generate Label button** — `Button tone="primary" size="sm"` (active-shipment state). Click toggles the panel's inline-expansion `<GenerateLabelForm />` (Step 8) — **NOT a Dialog**. Uses a `useState<boolean>` for the expansion toggle, lifted to the parent panel so the form can collapse on success without prop-drilling.
   4. **Cancel button** — `Button tone="danger" size="sm"`. Wraps `<ConfirmDialog tone="danger" title="Cancel this shipment?" description="The label will be voided in {carrier}. This cannot be undone.">`. On confirm, fires `useCancelShipmentMutation`. Carrier name in the description is interpolated from the shipping connection's `platformType` for readability.
   5. **Mark Dispatched button** — `Button tone="secondary" size="sm"`. Wraps `<ConfirmDialog tone="default" title="Manually mark as dispatched?" description="This fires the source notification and destination OMP update. Use only when the automatic dispatch flow has stalled.">`. On confirm, fires `useNotifyDispatchedMutation`. Less alarming tone than Cancel — it's a manual override, not destruction.
   6. All three buttons reach ≥ 36 px tap height on mobile via the existing `.btn--sm` token rule (per § Responsive "Tap targets ≥ 44 px on mobile for every interactive element (`.btn--sm` grows to 36 px min on touch; icon buttons to 40 px)").
   7. Action row layout: `display: flex; gap: var(--space-3); flex-wrap: wrap` so buttons wrap on mobile rather than overflow (per §3.3 responsive table).

**Step 8 — FE: `<GenerateLabelForm />` (inline expansion, NOT modal)** _(medium, ~2 hr)_
   1. `features/orders/components/generate-label-form.tsx`. Rendered inline within the panel when the parent's expansion toggle is open (per Step 7 sub-step 3). NO `Dialog` / `ConfirmDialog` import here — those are reserved for Cancel + Mark Dispatched (per §3.3 "Modal vs inline").
   2. **Recipient block** — `<KeyValueList>` showing the order's shipping address (name / street / city / postcode + country / phone) as a reference summary. **NOT disabled inputs** — KeyValueList signals "this is reference data, not draft." Source: `useOrderRecordQuery(orderId)` → `record.shippingAddress`. Per §3.3 + § MVP Primitives Standard's KeyValueList description ("definition list with `120px auto` grid, monospace values where appropriate, inline copy-to-clipboard buttons on hover").
   3. **Parcel dimensions** — composite three-input row labeled "Dimensions (mm)". Uses RHF + Zod schema (`z.object({ length: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive() })`). Layout: `<FormField label="Dimensions (mm)" description="Length × Width × Height">{three <Input>s inline}</FormField>`. Each input is `<Input type="number" min="1" inputMode="numeric">` with a small label suffix ("L", "W", "H"). Per §3.3 responsive table: stacks vertically below 480px via `grid-template-columns: repeat(auto-fit, minmax(80px, 1fr))`.
   4. **Weight** — separate `<FormField label="Weight (g)" />` with one `<Input type="number" min="1" inputMode="numeric">`. Zod: `z.number().int().positive()`.
   5. **Source connection + delivery method id** — pulled from the order context (`useOrderRecordQuery`). NOT rendered as form fields (operator can't change them — they come from the order's source-side data). Resolution happens in the submit handler.
   6. **Paczkomat-id** — capability-conditional per §3.5 Layer 2:
      - Allegro Delivery (shipping connection `platformType === 'allegro'`): read-only display of the buyer-pre-filled paczkomat from `order.shipping_data.paczkomatId`. Rendered inside the KeyValueList as one extra row.
      - InPost own-contract (`platformType === 'inpost'`): a `<FormField label="Paczkomat ID" />` with `<Input>` and placeholder `"e.g. POZ08A — picker coming in #769-picker"`. Operator types the id directly until the picker lands.
   7. **Submit** calls `useGenerateLabelMutation`. The whole form is wrapped in `<fieldset disabled={mutation.isPending}>` per §3.6 step 2.
   8. **Async-pending UX** — Submit button copy: `"Generate label"` → `"Generating label… (~30s)"` while `isPending`. After 5s, inline `<LoadingState>` appears below the form with copy `"Allegro is processing your label. This typically takes 10–30 seconds."` (per §3.6 steps 3–5). The LoadingState message is wrapped in `<div role="status" aria-live="polite">` (per §3.9).
   9. **Error surfacing**:
      - `<FieldError>` under each `<FormField>` for shape/format issues (Zod-derived)
      - `<FormErrorSummary>` at top for cross-field issues + API rejection messages — also aggregates field errors for screen-reader announcement on submit
   10. **Cancel affordance** — secondary button next to Submit collapses the inline expansion (toggles the parent's expansion state back to closed). Focus returns to the Generate Label trigger per §3.9.
   11. **On success** — `<Toast tone="success">"Label generated. Tracking number will appear within ~5 minutes."</Toast>`; collapse the form; `useGenerateLabelMutation`'s `onSuccess` invalidates `shipmentsQueryKeys.list({ orderId })` so the panel re-renders with the new row.
   12. **Focus management** — per §3.9 a11y table: trigger button `ref` on the parent panel; first form field receives focus on expansion open via `useEffect`; trigger receives focus on collapse.

**Step 9 — FE: wire panel into order detail page** _(tiny, ~15 min)_
   1. Edit `apps/web/src/pages/orders/order-detail-page.tsx` — render `<OrderShipmentPanel orderId={record.internalOrderId} />` as a full-width section in Band 2, **between the Addresses grid and the Activity Timeline**. Rationale: the panel pairs visually + semantically with Addresses ("where is it going?" + "how is it going?" form one logistics cluster). The 3-col primary grid in Band 1 (Summary | Sync Status | Customer) is too narrow for the panel's dense field+action layout; Band 2's full-width slot fits the ~100-120px panel height naturally. This placement also reserves the same Band 2 region for the future Invoice panel (#757/#758) — peer downstream-artifact panels stack here.

**Step 10 — FE: component tests** _(medium, ~2 hr)_
   Test naming follows `should [behavior] when [condition]` per `engineering-standards.md § Test Naming`.
   1. `order-shipment-panel.test.tsx` — covers:
      - capability-gate hides the panel when no connection declares `ShippingProviderManager`
      - shipping-connection-platformType keys the paczkomat caption ("buyer-selected via Allegro" vs "operator-selected")
      - status-matrix button enablement (one assertion per row of the §3.4 matrix)
      - status badge pulses (`pulse` modifier active) when status is `dispatched` or `in-transit`; not pulsing for terminal states
      - async-pending button copy: shows `"Generating label… (~30s)"` while `isPending`; inline `<LoadingState>` appears after 5s (use `vi.useFakeTimers()`)
      - error display (`<Alert tone="error">`) on the most recent mutation error
      - info alert on `AllegroShipmentPendingException`-shaped errors
      - mutation `onSuccess` invalidates `shipmentsQueryKeys.list({ orderId })` so the panel re-renders
      - loading skeleton renders while `useOrderShipmentsQuery` is `isLoading`
      - error state renders with retry affordance when query fails
   2. `generate-label-form.test.tsx` — covers:
      - Zod validation rejects non-positive dimensions and weight
      - recipient renders as `<KeyValueList>` (assert query for the primitive, NOT disabled inputs)
      - paczkomat field is read-only for Allegro shipping connection, editable input for InPost
      - the whole form is disabled (`<fieldset disabled>`) during `isPending`, not just the submit button
      - submit success closes the inline expansion + invalidates the list query
      - submit failure surfaces via `<FormErrorSummary>` at top + `<FieldError>` per field
      - focus moves to first input on expansion open; returns to trigger button on close
   3. `shipment-action-buttons.test.tsx` — covers:
      - §3.4 status-matrix coverage (per-button enablement)
      - Cancel button opens `<ConfirmDialog tone="danger">` (assert by role + content)
      - Mark Dispatched opens `<ConfirmDialog tone="default">`
      - Generate Label does NOT open a Dialog (toggles inline expansion instead)
   4. `carrier-tracking-url.test.ts` (already specified in Step 5) — coverage loop over `KnownCarrierValues`, plus unknown carrier / null carrier / null tracking → `null` returned.
   5. **Check:** `pnpm --filter @openlinker/web test`.

**Step 11 — Quality gate** _(tiny, ~5 min)_
   - `pnpm lint && pnpm type-check && pnpm test` from repo root.
   - `pnpm test:integration` for the new BE endpoint + the carrier-field round-trip extension to existing shipment int-specs.
   - `pnpm --filter @openlinker/api migration:show` — confirms the Step-0 `AddShipmentCarrier` migration is the only pending one.
   - **Logging sanity check** — `grep -rn "console\." apps/api/src/shipping/http/ libs/core/src/shipping/application/services/shipment-status-sync.service.ts` should return zero hits for the new code paths. The new `notifyDispatched` controller method reuses the controller's existing `Logger` instance (constructor field); the status-sync `carrier` write reuses the service's existing `Logger`. Per `engineering-standards.md § Logging`, no `console.*` calls anywhere.
   - **File-header sanity check** — `grep -rL "@module\|@implements" $(git diff --name-only HEAD origin/main | grep -E "\.(ts|tsx)$")` should return zero results among new files (files-without-the-header-tag). Pre-existing files edited in place don't need their headers added, only new files require them.

**Step 12 — Self-review + commit + PR** _(small)_
   - Review against `docs/code-review-guide.md`.
   - Commit on `769-839-shipment-panel-allegro`.
   - PR body: `Closes #769`; references #839 as "partially addresses — panel scope; `/shipments` extension follows #834, connection-settings remain in #771."

---

## 5. Validation

**Architecture compliance.**
- BE Step 0 (`Shipment.carrier`): ✅ port-first — the `TrackingSnapshot.carrier` field is added to the domain port; adapters implement it; the application service writes through the existing port-shaped patch path. No infrastructure leakage. The carrier vocabulary is an open string set (per the #576 capability-vocabulary precedent), so plugin adapters can register new values without core PRs.
- BE controller addition (`notify-dispatched`): ✅ obeys hexagonal — uses an already-injected `I*Service`, no port/repo coupling, errors mapped via existing `toHttpException`.
- FE panel: ✅ honours `app → pages → features → shared`; the order-detail page composes `<OrderShipmentPanel>`, which imports through the `features/shipments` public barrel only.
- FE tracking-link helper: ✅ lives in `features/shipments/lib/`, exported via the feature's public barrel; pure function, no React or DOM coupling, trivially unit-testable.
- ✅ No raw `fetch()` calls in pages or components; mutations all go through the API client.
- ✅ No client-side authorization gating beyond the capability check (which is a UX hint, not an authz boundary — backend guards still enforce).
- ✅ **No new design tokens.** The panel reuses the documented OKLCH palette: `--bg-surface` (panel chrome), `--border-default` (border), `--text-{primary,secondary,muted}` (hierarchy), `--status-{success,info,warning,error,review,neutral}` family (StatusBadge + Alert tones), `--accent-primary` + `--text-on-primary` (signal-orange primary CTA — sparingly per #775), `--space-{3,4,5}` (spacing scale), `--radius-lg` (10px card radius per § Spacing And Shape), `--accent-focus` (focus rings). `scripts/check-design-tokens.mjs` (chained into `pnpm lint` via `check:invariants`) passes without changes to `tokens.ts` or `index.css`. No raw hex values anywhere in the component CSS — per § CSS Implementation Standard.

**Engineering standards.**
- ✅ FE filenames: `kebab-case.tsx` for components, named-export `PascalCase` (`order-shipment-panel.tsx` exports `OrderShipmentPanel`).
- ✅ Hooks named `use-*.ts`, tests `*.test.tsx`.
- ✅ Types in separate `*.types.ts` files; no inline type definitions in component files.
- ✅ TanStack Query for server state; React Hook Form + Zod for the generate-label form; no global store.
- ✅ Plugin-architecture compliance: shipping is capability-driven, not platform-driven — no `PlatformContribution` slot added (deferred until 3rd carrier exists, per the trigger documented in §3.7).

**Testing strategy.**
- BE Step 0: Allegro mapper spec gains 4 carrier-mapping cases + unknown-passthrough; Allegro adapter spec gains 1 case asserting `carrier` populates from `transportingInfo[].carrierId`; InPost adapter spec gains 1 case for the `'inpost'` literal; `ShipmentStatusSyncService` spec gains 2 cases (carrier-backfilled, carrier-overwrite-blocked); existing shipment read int-spec extended for `carrier` round-trip; dispatch-notification int-spec extended for the stubbed-carrier write.
- BE Step 1-2: 1 controller unit spec extension + 1 int-spec extension.
- FE: 1 helper unit test (`buildCarrierTrackingUrl`) + 3 component tests + the existing Vitest harness.
- No e2e tests (matches #770's precedent — `/shipments` page ships without e2e).

**Security baselines.**
- ✅ Endpoint behind `JwtAuthGuard` (inherited from controller).
- ✅ `id` is parsed via `@Param` (path string), no SQL interpolation.
- ✅ FE has no embedded secrets; the API client uses the existing `useApiClient` DI seam.
- ✅ Tracking URLs are constructed from `trackingNumber` (DB-stored, sanitised at ingestion); rendered as `target="_blank" rel="noopener noreferrer"` to neutralise reverse-tabnabbing.

**Risks / open questions** (resolved during the grill pass; the live ones for impl):

1. ✅ **Tracking-URL composition: processor-keyed vs carrier-keyed** — resolved in §3.0 + §3.7: carrier-keyed via the new `Shipment.carrier` field, public-tracker URLs per known carrier, copy-text fallback otherwise. The Allegro-seller-auth caveat is sidestepped except for Allegro One's three first-party sub-carriers (where there is no underlying carrier — Allegro is the carrier-of-record).

2. ✅ **Source vs shipping connection terminology** — resolved in §3.0: `OrderRecord.sourceConnectionId` is never consulted by the Shipment panel; `Shipment.connectionId` drives capability-conditional copy (paczkomat caption); `Shipment.carrier` drives the tracking URL.

3. **Should `POST /shipments/:id/notify-dispatched` be its own endpoint, or should we route operator "mark dispatched" through a webhook-shaped surface that #768 (InPost webhook ingestion) will also use?** — Recommendation: standalone endpoint now; #768 can compose the same service when it ships. Decoupling them keeps #768's webhook validation logic out of the operator-action path.

4. **Picker deferral risk** — InPost paczkomat path is genuinely degraded in this PR (operator types the paczkomat-id into a text input). Is that acceptable as a v1, or should we block on the picker? — Recommendation: ship without picker; document the limitation in the panel copy with a copy-paste-friendly placeholder + a link to "Picker coming in #769-picker".

5. **Single active shipment per order** — the FE assumes one active shipment. If the BE ever supports multi-package multi-shipment, the panel becomes a list. Currently safe (BE `findActiveByOrderId` is single-result). Worth a code-comment in the panel naming the assumption.

6. **Auto-vs-manual mark-dispatched** — Allegro Delivery's `notifyDispatched` will eventually be called automatically by #838's status-poll once #861 lands. Until then, the manual button is the only path. Should the button label change between "manual" and "automatic" modes? — Recommendation: same button; the button stays useful as an override even after auto-mode lands.

7. **Capability check uses `useConnectionsQuery` — adds one extra query to the order-detail page.** Could the panel skip the capability check and just always render, letting the empty-state cover it? — Tradeoff: extra query = small perf cost; capability-check upholds AC-8 ("no Allegro Delivery terminology when no such connection exists") which the empty-state can't really do. Keep the check.

8. **Allegro `AllegroShipmentPendingException`** — does the existing `extractPlatformErrors` extractor know about it? — Need to verify in the plugins/allegro extractor. If not, add a one-line case.

9. **Test the BE `notifyDispatched` endpoint without a real worker — does the int-spec helper need a fresh stub setup?** — The existing `shipment-dispatch-notification.int-spec.ts` already wires the dispatch-notify stubs; we extend it.

10. **Allegro carrier-id vocabulary completeness** — the `normalizeAllegroCarrierId` mapper needs to cover whatever Allegro actually returns. Spec lists InPost/DPD/DHL/ORLEN/Allegro One/Poczta/UPS/Packeta, but the exact wire-shape strings (e.g. `INPOST` vs `INPOST_LOCKER`) need to be confirmed at impl time by hitting a sandbox shipment or reading the Allegro API docs. Unknown values pass through unmapped — the FE gracefully renders no link, so a missing mapping is a soft failure, not a crash.
