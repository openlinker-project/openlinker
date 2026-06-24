# Implementation Plan — #1161 Shop-as-source cancellation detection in the OrderSource feed

**Issue:** [#1161](https://github.com/openlinker-project/openlinker/issues/1161) — part of #1157 (order-status round-trip), ADR-027. Completes User story S3 for shop origins.
**Branch:** `1161-ps-source-cancellation-detection`
**Layer:** Integration (PrestaShop) — Infrastructure adapter. **No CORE change. No migration.**
**Review:** revised after a deep `/tech-review` pass (🔄 Approve-with-changes) — all IMPORTANT + SUGGESTION items folded in (see §8).

---

## 1. Goal

PrestaShop's `OrderSource` feed currently emits only `created` / `updated`, so an origin-shop cancellation can't even be *observed* by core — blocking shop→OL→shop and shop→OL→marketplace cancel-from-origin. Allegro already maps `CANCEL → cancelled`; PrestaShop is the sole gap.

Make `PrestashopOrderSourceAdapter.listOrderFeed` emit a `cancelled` `OrderFeedEventType` when a PrestaShop order is in the canceled state. **The entire downstream path already exists** and needs no changes.

### Non-goals
- Any relay / core change. `OrderIngestionService.syncOrderFromSource` (line 194) already routes `eventType === 'cancelled'` → `handleSourceCancellation` → `orderLifecycleRelay.relay({ event: { type: 'cancelled' } })`, with the ADR-017 destination-echo guard. Verified.
- Scheduler change. The `prestashop-orders-poll` payload sets **no `eventTypes`**, so `cancelled` flows through unfiltered. Verified.
- Touching `mapOrderStatus` / the PS order-state table. Out of scope — see §8 decision.
- Dynamic order-state-name resolution (multilingual / renumbered installs) — see §7 Known limitation.
- `refunded` (state 7), `paid`, or any non-cancellation transition. Strictly the cancel signal.

---

## 2. Research findings (grounding)

| Fact | Evidence |
|---|---|
| Feed never emits `cancelled` | `prestashop-order-source.adapter.ts:80` — `eventType = createdAt === occurredAt ? 'created' : 'updated'` |
| `cancelled` is a valid feed type | `order-feed.types.ts:20` — `OrderFeedEventTypeValues = ['created','updated','cancelled','paid']` |
| List response carries `current_state` | Query builder defaults `display=full` (`prestashop-query.builder.ts:72`); `PrestashopOrder.current_state` typed (`prestashop.mapper.interface.ts:76`). **No extra fetch needed.** |
| PS canceled = state id `6` (default install) | `prestashop-order.mapper.ts:106` — `if (statusNum === 6) return 'cancelled'` |
| Downstream wiring complete | `order-ingestion.service.ts:194` routes cancelled → `handleSourceCancellation` → relay |
| Poll doesn't filter event types | `prestashop-scheduler-tasks.ts:73-77` — payload has no `eventTypes` |
| Allegro reference | `allegro-order-source.adapter.ts:659` — `if (t.includes('CANCEL')) return 'cancelled'` |

---

## 3. Design

`current_state === 6` denotes a PrestaShop cancellation. Emit `cancelled` with **precedence over** created/updated.

**Why precedence is load-bearing (not just cosmetic):** a cancelled order has `date_upd > date_add`, so without precedence it would read as `updated`. But the stronger, safety-critical reason is re-poll robustness: an order that **stays cancelled** but gets re-touched at the source (admin note, status-history write, any `date_upd` bump) must keep emitting `cancelled`. If it ever flipped to `updated`, `syncOrderFromSource` would re-enter the create/update path and **resurrect a cancelled order as active**. Checking `current_state === 6` first guarantees a still-cancelled order always re-emits `cancelled` (an idempotent no-op at the relay), never `updated`. This invariant must not be broken by a future edit.

**`eventKey`** stays `${externalOrderId}:${occurredAt}:${eventType}` — already includes `eventType`, so a `cancelled` event is dedupe-distinct from a prior `created`/`updated` at a different `date_upd`. Re-emission is safe end-to-end: the per-event `dedupeKey` dedupes at enqueue, the relay is at-most-once (#1158), and the ADR-017 destination-echo guard prevents a cancel re-read on a connection OL pushed the order *into* from propagating spuriously.

---

## 4. Step-by-step

### Step 1 — Named constant (single source of truth for the feed path)
**File:** new `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order-state.types.ts`
- `export const PRESTASHOP_DEFAULT_CANCELLED_STATE_ID = 6;` — name encodes the **default-install** assumption at every call site (§7). Docblock: PS default "Canceled" state id; renumbered installs are a documented v1 limitation.
- **AC:** constant exported; file header present.

### Step 2 — Feed emits `cancelled`
**File:** `prestashop-order-source.adapter.ts` (`listOrderFeed`)
- Add a private pure helper `resolveFeedEventType(order, createdAt, occurredAt): OrderFeedEventType`:
  - `order.current_state !== undefined && Number(order.current_state) === PRESTASHOP_DEFAULT_CANCELLED_STATE_ID` → `'cancelled'` (explicit undefined guard for legibility — `Number(undefined) === 6` is already `false`, but the guard states intent);
  - else `createdAt === occurredAt ? 'created' : 'updated'`.
- Inline comment on the helper records the §3 resurrection-safety invariant (cancel checked first so a re-touched still-cancelled order never flips to `updated`).
- Call it inside the existing `.map`. No change to cursor computation, `eventKey` shape, or eventTypes filtering.
- **AC:** a `current_state: '6'` order yields `eventType: 'cancelled'`; non-cancelled unaffected.

### Step 3 — Unit tests
**File:** `__tests__/prestashop-order-source.adapter.spec.ts`
- cancelled order (`current_state: '6'`, `date_upd > date_add`) → `eventType: 'cancelled'` (not `'updated'`); `eventKey` ends `:cancelled`.
- cancellation precedence when `date_add === date_upd` → still `'cancelled'`.
- **re-touched still-cancelled** order (`current_state: '6'`, `date_upd > date_add`) stays `'cancelled'` — regression guard for the §3 invariant.
- non-cancelled `current_state: '2'` with `date_upd > date_add` → still `'updated'`; equal dates → `'created'`.
- detection×filter interaction:
  - cancelled order is **retained** when `eventTypes: ['cancelled']` (the actual S3 relay path);
  - cancelled order is **filtered out** when `eventTypes: ['created','updated']`.
- cursor still advances to max `date_upd` with a cancelled item present.
- **AC:** new cases green; existing cases untouched.

### Step 4 — Integration coverage (committed criterion, not open-ended)
1. Grep existing int-specs for an ingestion→relay `cancelled` assertion (the relay path is platform-neutral; #1158/#1159 cover the marketplace-origin cancel).
2. If no **shop-source** `cancelled` path is exercised end-to-end, add **one** ingestion-level int-spec via the public `AdapterRegistryService` + `AdapterFactoryResolverService` stub seam (carrier-mapping pattern) — register a stub PS `OrderSource` emitting a `cancelled` feed item, assert the relay targets the destination. **Not** a PS Testcontainer (12-min boot, ~zero marginal assurance over the unit test).
3. Run the full **`pnpm test:integration`** regardless (issue architecture note).
- **AC:** shop-origin cancellation → other participant reached (or clear unsupported result); full int-suite green.

---

## 5. Quality gate
`pnpm lint` · `pnpm type-check` · `pnpm test` (prestashop package) · `pnpm test:integration`. No `migration:show` (no schema change).

## 6. Files touched
- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order-state.types.ts` (new)
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-source.adapter.ts`
- `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-source.adapter.spec.ts`
- (conditional) one `apps/api/test/integration/**` int-spec per §4.2

## 7. Known limitation (documented, not a regression)
Cancellation keys on the PrestaShop **default** "Canceled" state id (`6`), matching the existing `mapOrderStatus`. Installs that renumber order states won't be detected. A name-resolved upgrade (mirroring `prestashop-fulfillment-status.mapper.ts`'s `CANCEL_REGEX` + `resolveStateId('cancelled')`) is the robust follow-up; it adds a per-poll `order_states` lookup on the hot feed path, so it's deliberately out of scope for this MVP slice.

## 8. Tech-review resolutions
- **Mapper asymmetry (IMPORTANT):** chose option (a) — **leave `mapOrderStatus` untouched.** Extracting only `6` of its seven sibling state-id literals would be a confusing half-measure; fully extracting the table widens scope into an unrelated file + its spec for a no-op refactor. The `6` lives in two surfaces (status-string mapping vs feed event-type) that are independently obvious; the new constant + this note are the cross-reference. Net: change stays confined to the one path that needs new behavior.
- **Precedence invariant (IMPORTANT):** documented in §3 and pinned as an inline comment on the helper (Step 2).
- **Constant name (SUGGESTION):** `PRESTASHOP_DEFAULT_CANCELLED_STATE_ID`.
- **Test matrix (SUGGESTION):** added retained/filtered-by-eventTypes cases + the re-touched-stays-cancelled regression guard (Step 3).
- **Int decision (SUGGESTION):** Step 4 now commits to a grep-then-conditional-stub-seam criterion, explicitly avoiding the PS Testcontainer.
- **Undefined guard (SUGGESTION):** explicit `current_state !== undefined` in the helper (Step 2).

## 9. Risks
**Low.** Pure additive event-type derivation on an existing hot path; no I/O added; downstream + scheduler verified to already handle `cancelled`. Mild file-proximity to in-flight #1129 (touches the same adapter's `getOrder()`, a different method) — possible trivial merge brush, not blocking.
