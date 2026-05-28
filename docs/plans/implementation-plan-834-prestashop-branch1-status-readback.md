# Implementation Plan — #834 Branch-1 (PS-fulfilled) shipment status read-back

**Issue:** #834 · **ADR:** [ADR-012](../architecture/adrs/012-branch-1-fulfillment-modeling.md) (branch-1 modeling — delegate-to-OMP + status-reader capability)
**Layer:** Core (shipping) + Integration (prestashop) · **Branch:** `834-prestashop-branch1-shipment-readback`
**Effort:** S–M (1–3 days) · **Migration:** 1 (partial-unique index on `shipments`)

> Makes OL the single status pane for branch-1 (PS-fulfilled) shipments. **Backend-only PR** — the existing `/shipments` page (#770/#848) picks up new branch-1 rows for free via the existing read API (#846/#847); no FE work in #834.

## 1. Direction — projection-only

The architecturally-grounded model for branch-1: **`Shipment` is a projection of PS's reality, not a commitment OL writes proactively.** PS is the system of record. A branch-1 Shipment row exists when, and only when, **PS has acted** on the order (state transitions to a shipping-related state, or `shipping_number` is set).

This mirrors how OL already models other downstream truths — `OfferStatusSnapshot` (ADR-009) is a persisted projection of marketplace offer state, never written speculatively. Branch-1 Shipments follow the same primitive.

**Concrete consequences of "projection-only":**

| | Effect |
|---|---|
| **Single lifecycle owner** | The new sync service is the **only** creator + updater of branch-1 Shipments. No cross-context coupling between `orders` and `shipping`. `OrderSyncService` is untouched. |
| **No phantom rows** | Every persisted branch-1 Shipment 1:1 with a real PS fulfillment event. No "OL says dispatched, PS says awaiting payment" mismatch windows. |
| **No `ShipmentDispatchService` changes** | Dispatch is operator-triggered (`POST /shipments/dispatch`) and shapes around `GenerateLabelCommand`. Branch-1 never invokes it. The plan's prior "extend dispatch" was the wrong hook. |
| **Reporting integrity** | Branch-1 Shipment count = real branch-1 shipment count. Finance / SLA queries don't need defensive filters against phantom rows. |
| **FE consequence — explicit gap** | `/shipments` shows branch-1 rows once PS acts, **not before**. Pre-fulfillment branch-1 orders are visible in `/orders` only. A "pending fulfillment count" hint banner on `/shipments` is a deferred follow-up FE issue — out of scope for #834. |

## 2. Goal & non-goals

**Goal.** Branch-1 (`processorKind === 'omp_fulfilled'`) orders show up in OL's `/shipments` view as the fulfilling party (PS) acts on them, with status + tracking read back from PS via a new `FulfillmentStatusReader` capability.

**Non-goals (explicit per issue):**

- Changing how PS fulfils (stays external — OL generates no label).
- Operator-set workflow statuses → PD #827.
- FE changes — `/shipments` page already exists and reads via the existing API. The "pending PS fulfillment" hint banner on `/shipments` is a *deferred* FE follow-up.
- Shipment column schema changes (the nullable fields branch-1 needs — `providerShipmentId`, `paczkomatId`, `trackingNumber`, `labelPdfRef` — already exist). **One small migration** ships: a partial-unique index `(orderId, connectionId) WHERE providerShipmentId IS NULL` to guard branch-1 dedup at the DB.
- Proactive Shipment creation at order-mirror time. Pre-fulfillment branch-1 orders are not represented in `Shipment` (per §1 architectural decision).

## 3. Design

### 3.1 New capability — `FulfillmentStatusReader`

Sub-capability of `OrderProcessorManagerPort`, parallel in shape to `OrderFulfillmentUpdater` (#858). Lives under `libs/core/src/shipping/domain/ports/capabilities/` (the OrderProcessorManager sub-capabilities map cleanly to shipping concerns and live in the shipping context; same convention as `OrderFulfillmentUpdater` did).

```ts
// fulfillment-status-reader.capability.ts
export interface FulfillmentStatusReader {
  /**
   * Read the destination OMP's view of an order's fulfillment status.
   *
   * Returns a snapshot whose `status` is `null` when the OMP has not yet acted
   * (pre-fulfillment: awaiting payment, processing, picking, …). The sync
   * service treats `null` as "no shipment to project — skip this order this
   * pass." When non-null, the value is the canonical OL `ShipmentStatus`
   * reflecting the OMP's current fulfillment state.
   */
  getFulfillmentStatus(input: { externalOrderId: string }): Promise<FulfillmentStatusSnapshot>;
}

export function isFulfillmentStatusReader(adapter: unknown): adapter is FulfillmentStatusReader {
  return typeof (adapter as FulfillmentStatusReader)?.getFulfillmentStatus === 'function';
}
```

```ts
// fulfillment-status-snapshot.types.ts
export interface FulfillmentStatusSnapshot {
  /**
   * `null` ⇒ OMP has not yet acted on the order (pre-fulfillment). The sync
   * service skips creation/update in that case — projection-only semantics.
   * Non-null ⇒ OMP has acted; this is the OL-canonical status to project.
   */
  status: ShipmentStatus | null;
  trackingNumber: string | null;
  deliveredAt: Date | null;
}
```

### 3.2 PS adapter implementation

The existing `PrestashopOrderProcessorAdapter` (or its decomposed equivalent) declares `implements FulfillmentStatusReader`. **No `supportedCapabilities` manifest change** — sub-capability discovery is via the `isFulfillmentStatusReader` type guard at the call site, mirroring how `isOrderFulfillmentUpdater` (#858) works against the same `OrderProcessorManager` capability declaration. Reads PS order + the matching `order_state` row, then maps via the boolean columns PS itself uses to describe a state — **not** by name regex, which is brittle under multi-language configs and operator-renamed states.

**Source data:**

- `GET /api/orders/{id}` returns `PrestashopOrder` carrying `current_state` (id), `date_upd`, and `shipping_number` (legacy direct-on-order tracking field, accessed via the existing `[key:string]: unknown` index).
- `GET /api/order_states?deleted=0` (already loaded once per scan via the existing `listOrderStatuses()` pattern) returns the canonical state rows. The `PrestashopOrderState` type is widened to expose the three boolean discriminator columns PS ships:
  - `delivered` — `'1'` ⇔ the state means "the customer has the package."
  - `shipped` — `'1'` ⇔ the state means "handed off to carrier."
  - `paid` — `'1'` ⇔ the state means "payment captured" (not used by the mapper today; documenting for future).

  **Verification gate:** the PrestaShop Webservice allowlist on `order_states` must surface these columns on the wire. Confirm against [developer.prestashop.com](https://devdocs.prestashop-project.org/) (or a sandbox probe) at impl-start. If the WS strips them, the mapper falls back to v1 name-match (less correct but still ships) and we file a follow-up to add them via WS schema config.

**Mapping (conservative v1):**

- `delivered === '1'` → `SHIPMENT_STATUS.Delivered` (+ `deliveredAt = order.date_upd`).
- `shipped === '1' && delivered !== '1'` → `SHIPMENT_STATUS.Dispatched` (+ `dispatchedAt = order.date_upd`). PS has handed off to carrier.
- **Cancellation — explicit fallback:** PS has no canonical cancellation boolean (operators define cancel states by convention). v1 falls back to `state.name` matching `/cancel|annul|anul|storno|reject|abge/i` ⇒ `SHIPMENT_STATUS.Cancelled` (+ `cancelledAt = order.date_upd`). Coverage: EN `cancel/cancelled`, FR `annulé`, ES `anulado`, PL `anulowano`/`anulowane` (single `n`), CS/SK `storno`, EN `rejected`, DE `abgebrochen`. Documented as the regex-fallback gap; the proper fix is operator-configurable PS→OL state mapping under **#862** — once that ships, this mapper consumes the same config table.
- Otherwise → `status: null` (PS has not yet acted on this order — pre-fulfillment).

**Tracking number** — read `order.shipping_number` through `PrestashopOrder`'s `[key:string]: unknown` index, narrow with `typeof === 'string' && length > 0` before use (engineering-standards.md § Type Safety), else fall back to the first non-empty `order_carriers[].tracking_number` (`writeTracking` in the same adapter already proves this resource access pattern); `null` if neither.

The mapper extracts to a pure unit `prestashop-fulfillment-status.mapper.ts`:

```ts
mapToFulfillmentStatusSnapshot(
  order: PrestashopOrder,
  state: PrestashopOrderState | null,    // null ⇒ orphaned current_state, treat as 'not acted'
  orderCarriers: readonly PrestashopOrderCarrier[],
): FulfillmentStatusSnapshot
```

The adapter is a thin shell: fetch the order, look up the state, fetch the carriers, delegate to the mapper. The PS `order_states` map is cached **inside the adapter** as a lazy-init `Map<id, PrestashopOrderState>`. Lifetime = the adapter instance.

**Why the lazy-init cache is correctly bounded** (verified against `libs/core/src/integrations/application/services/integrations.service.ts:94-132`): `IntegrationsService.getCapabilityAdapter` constructs a **fresh adapter via the factory resolver on every call** — there is no instance cache. The sync service in §3.4 resolves the adapter **once per page** (single `const adapter = await ...` before the loop) and reuses it across all records in that page. So: adapter constructed at page start → state map loaded lazily on the first record → reused for every subsequent record in the page → discarded when `sync()` returns and the adapter goes out of scope. One PS `order_states` WS call per scan tick; no stale-state hazard across ticks. Document this contract in the adapter's file header so future refactors of `getCapabilityAdapter` (any pathway that introduces adapter-instance caching) surface this assumption explicitly.

### 3.3 Type widenings (all additive — existing call sites unchanged)

- **`ShippingMethod`** gains `'omp'` (the persisted `shippingMethod` value for branch-1 Shipments). Forward-compatible per its docstring (which already documents the type as discriminating *what kind of shipment OL persists*, not strictly what `ShippingProviderManagerPort` produces — update the docstring to reflect this honestly).
- **`ShipmentFilters`** gains `hasProviderShipmentId?: boolean`. When `false`, the query adds `providerShipmentId IS NULL` (the branch-1 selector). Used by both the find-existing-branch-1-shipment lookup in the sync service and any future read API that wants to filter by branch.
- **`CreateShipmentInput`** gains `initialStatus?: ShipmentStatus` (default `'draft'` — preserves existing call-site behaviour) plus `trackingNumber?: string`, `dispatchedAt?: Date`, `deliveredAt?: Date`, `cancelledAt?: Date`. The sync service writes the snapshot's status + terminal-timestamp at create time so the row is born at its correct status (no `draft → terminal` two-write cycle, no transient pre-projection state that would trip the partial-unique index). `ShipmentDispatchService` keeps its existing two-step `create(draft) → update(generated)` flow — the draft row is observable as `failed` on `generateLabel` errors, which is the intended UX there.
- **`OrderRecordFilters`** (on `OrderRecordRepositoryPort.findMany`) gains `destinationConnectionId?: string` (JSONB `@>` containment on `syncStatus`, mirroring the existing `syncStatus` enum filter at `order-record.repository.ts:85-88`) and `updatedSince?: Date` (column predicate on `rec.updatedAt`, mirroring the existing `createdFrom`). `recordStatus?: OrderRecordStatus` already exists (`order-record.types.ts:40`) — no widening, just reused. Without a GIN index the JSONB containment is a seqscan; acceptable at v1 scale (~30k rows in the 30-day window), file as a follow-up if scan time creeps.

### 3.4 The new sync service — `FulfillmentStatusSyncService`

```ts
// libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts

@Injectable()
export class FulfillmentStatusSyncService implements IFulfillmentStatusSyncService {
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN) private readonly shipments: ShipmentRepositoryPort,
    // Cross-context callers go through I*Service per
    // architecture-overview.md § "Cross-context dependencies in core" —
    // repository ports are explicitly forbidden across context boundaries.
    // Same precedent as the sibling ShipmentStatusSyncService (#871).
    @Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecords: IOrderRecordService,
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN) private readonly routing: IFulfillmentRoutingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrations: IIntegrationsService,
  ) {}

  async sync(
    connectionId: string,
    options: FulfillmentStatusSyncOptions,
  ): Promise<FulfillmentStatusSyncResult> {
    // 1. Page candidate OL Order Records: those mirrored to this PS connection,
    //    bounded by recent activity (default: updated_at within last 30 days).
    //    `findMany` is added to IOrderRecordService as part of this PR (Step 8b),
    //    delegating to the existing OrderRecordRepositoryPort.findMany inside
    //    the orders context — repository stays intra-context.
    const page = await this.orderRecords.findMany(
      { destinationConnectionId: connectionId, recordStatus: 'ready', updatedSince: thirtyDaysAgo() },
      { offset: options.offset ?? 0, limit: options.limit },
    );

    // 2. Resolve the PS OrderProcessor adapter once; bail if it doesn't
    //    declare FulfillmentStatusReader.
    const adapter = await this.integrations.getCapabilityAdapter<OrderProcessorManagerPort>(
      connectionId, 'OrderProcessorManager',
    );
    if (!isFulfillmentStatusReader(adapter)) {
      this.logger.warn(`Connection ${connectionId} doesn't declare FulfillmentStatusReader — skipping scan`);
      return zeroResult(page);
    }

    let created = 0, updated = 0, skipped = 0, failed = 0;

    // Per-invocation routing cache: `(sourceConnectionId, sourceDeliveryMethodId)`
    // is a hot key with low cardinality per page (≤ #distinct delivery methods,
    // typically <10). Lifetime is one sync() call — stale-cache risk is bounded
    // to one page; next tick re-reads. Don't push this into the routing service
    // (would couple lifetimes across all callers and need invalidation on rule
    // edit). See #834 deep-analysis Q F.
    const routingCache = new Map<string, FulfillmentRoutingResolution>();
    const resolveCached = async (
      sourceConnectionId: string,
      methodId: string | null,
    ): Promise<FulfillmentRoutingResolution> => {
      const key = `${sourceConnectionId}::${methodId ?? '__null__'}`;
      const hit = routingCache.get(key);
      if (hit) return hit;
      const resolution = await this.routing.resolve({
        sourceConnectionId,
        sourceDeliveryMethodId: methodId,
      });
      routingCache.set(key, resolution);
      return resolution;
    };

    for (const record of page.items) {
      try {
        // 3. Routing check: only branch-1 rows where this connection is the omp processor.
        const resolution = await resolveCached(
          record.sourceConnectionId,
          record.sourceDeliveryMethodId ?? null,
        );
        if (resolution.processorKind !== FULFILLMENT_PROCESSOR_KIND.OmpFulfilled
            || (resolution.processorConnectionId !== null && resolution.processorConnectionId !== connectionId)) {
          skipped += 1;
          continue;
        }

        // 4. External order id lookup from the record's syncStatus.
        const externalOrderId = findExternalOrderId(record, connectionId);
        if (!externalOrderId) { skipped += 1; continue; }

        // 5. Read PS state.
        const snapshot = await adapter.getFulfillmentStatus({ externalOrderId });

        // 6. Projection: status === null ⇒ PS hasn't acted ⇒ no-op.
        if (snapshot.status === null) { skipped += 1; continue; }

        // 7. Find existing branch-1 Shipment for (orderId, this PS connection, providerShipmentId IS NULL).
        const existing = await this.shipments.findBranchOneByOrderAndConnection(record.internalOrderId, connectionId);

        if (!existing) {
          await this.shipments.create({
            orderId: record.internalOrderId,
            connectionId,
            shippingMethod: SHIPPING_METHOD.Omp,
            sourceDeliveryMethodId: record.sourceDeliveryMethodId ?? undefined,
            initialStatus: snapshot.status,
            // dispatchedAt / deliveredAt / cancelledAt / trackingNumber from snapshot
            // (terminal timestamps set per status; trackingNumber threaded directly).
          });
          created += 1;
        } else {
          const patch = diffPatch(existing, snapshot);
          if (Object.keys(patch).length > 0) {
            await this.shipments.update(existing.id, patch);
            updated += 1;
          }
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(`Branch-1 status sync failed for record ${record.internalOrderId}: ${msg(error)}`);
      }
    }

    const offset = options.offset ?? 0;
    const consumed = offset + page.items.length;
    const nextOffset = consumed >= page.total ? 0 : consumed;

    return {
      scanned: page.items.length,
      created, updated, skipped, failed,
      total: page.total, nextOffset,
    };
  }
}
```

**Key shape notes:**

- The sync service iterates **OL Order Records**, not OL Shipments (because pre-fulfillment branch-1 orders have no Shipment yet). The page filter (`destinationConnectionId` + recent activity) bounds the work.
- The single per-page adapter resolution mirrors #871's pattern.
- **Idempotency**: `findBranchOneByOrderAndConnection` is the dedup gate. Two concurrent syncs for the same connection could in principle both pass it and double-create — but per-connection scans are serialised by the scheduler (one job per connection per tick), so the race window is closed in practice. Worst case: a second create attempts to insert; rely on a partial-unique index `(orderId, connectionId) WHERE providerShipmentId IS NULL` as the DB-side guard (cheap addition).
- **No OMP push-back** (unlike #871's branches-2/3 sync). Branch-1's OMP IS the source of truth — there's nothing to push.

### 3.5 Scheduler + worker

- **Scheduler task** in PS plugin: `prestashop-fulfillment-status-sync`. Default `0 */15 * * * *` (15 min). Cursor key `prestashop.fulfillmentStatus.scanOffset`.
- **Worker handler** at `marketplace.fulfillment.statusSync`. Thin shell: parse `connectionId` + `{ offset, limit }`, call service, persist `nextOffset` to `connection_cursors`. Mirrors #871's `marketplace.shipment.statusSync` handler.

## 4. Step-by-step

| # | File | Change |
|---|---|---|
| 1 | `libs/core/src/shipping/domain/ports/capabilities/fulfillment-status-reader.capability.ts` (NEW) | `FulfillmentStatusReader` port + `isFulfillmentStatusReader` guard |
| 2 | `libs/core/src/shipping/domain/types/fulfillment-status-snapshot.types.ts` (NEW) | `FulfillmentStatusSnapshot` type with `status: ShipmentStatus \| null` semantics documented |
| 3 | `libs/core/src/shipping/domain/types/shipping-method.types.ts` | Add `'omp'` to `ShippingMethodValues`; update docstring |
| 4 | `libs/core/src/shipping/domain/types/shipment.types.ts` | Add `hasProviderShipmentId?: boolean` to `ShipmentFilters`; add `initialStatus?` (and terminal timestamps + `trackingNumber`) to `CreateShipmentInput` |
| 5 | `libs/core/src/shipping/domain/ports/shipment-repository.port.ts` | Add `findBranchOneByOrderAndConnection(orderId, connectionId): Promise<Shipment \| null>` |
| 6 | `libs/core/src/shipping/infrastructure/persistence/repositories/shipment.repository.ts` | Implement filter widenings + new find method; honour `initialStatus` (and terminal-timestamp fields) in create |
| 7a | `libs/core/src/shipping/infrastructure/persistence/entities/shipment.orm-entity.ts` | Decorate the ORM entity with `@Index('UQ_shipments_branch_one_per_order_conn', ['orderId','connectionId'], { unique: true, where: '"providerShipmentId" IS NULL' })` (matches the existing `UQ_shipments_providerShipmentId` decorator pattern so integration-test synchronize stays consistent). |
| 7b | `apps/api/src/migrations/1799000000007-add-branch-one-shipments-uq-index.ts` (NEW) | Production migration creating the partial-unique index — `CREATE UNIQUE INDEX … WHERE "providerShipmentId" IS NULL` in `up`, `DROP INDEX` in `down`. Mirrors the partial-unique-index pattern at `1790000000000-add-prompt-templates-table.ts:43-65`. Class name **must** end in the same 13-digit suffix as the filename — `AddBranchOneShipmentsUqIndex1799000000007` — per `docs/migrations.md § Timestamp uniqueness invariant` (lint-enforced by `scripts/check-migration-timestamps.mjs`). |
| 8a | `libs/core/src/orders/domain/ports/order-record-repository.port.ts` + types | Widen `OrderRecordFilters` with `destinationConnectionId?` + `updatedSince?` (intra-context — repository surface stays inside `orders`) |
| 8b | `libs/core/src/orders/application/interfaces/order-record.service.interface.ts` + service impl | Widen `IOrderRecordService` with `findMany(filters, pagination): Promise<PaginatedOrderRecords>`; `OrderRecordService` delegates to `OrderRecordRepositoryPort.findMany`. This is the **cross-context contract surface** the shipping sync service consumes — `*RepositoryPort` is forbidden across context boundaries per architecture-overview.md § "Cross-context dependencies in core". |
| 9 | `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` | Implement the new filter (JSONB `@>` for `destinationConnectionId`; `rec.updatedAt >= :updatedSince` column predicate). |
| 10 | `libs/core/src/shipping/index.ts` | Re-export new capability + snapshot type |
| 11 | `libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts` (NEW) + sibling `*.service.interface.ts` + `*.types.ts` | The sync service implementing §3.4 |
| 12 | `libs/core/src/shipping/shipping.module.ts` + `shipping.tokens.ts` | Bind the new service with `FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN` |
| 13a | `libs/integrations/prestashop/src/domain/types/prestashop-options.types.ts` | Widen `PrestashopOrderState` with `delivered?: string \| number`, `shipped?: string \| number`, `paid?: string \| number` (the boolean discriminator cols the mapper consumes) — gated on the §3.2 WS-exposure verification |
| 13b | `libs/integrations/prestashop/src/.../mappers/prestashop-fulfillment-status.mapper.ts` (NEW) | Pure mapper PS order + state + carriers → `FulfillmentStatusSnapshot` per §3.2 |
| 14 | `libs/integrations/prestashop/src/.../adapters/prestashop-order-processor.adapter.ts` | `implements FulfillmentStatusReader`; `getFulfillmentStatus` reads PS order, looks up state via lazy-initialised per-instance `Map<id, PrestashopOrderState>`, fetches order_carriers, delegates to the mapper |
| 15 | `libs/integrations/prestashop/src/infrastructure/scheduler/prestashop-scheduler-tasks.ts` (NEW or extend) | Register `prestashop-fulfillment-status-sync` scheduler task |
| 16 | `libs/integrations/prestashop/src/prestashop-plugin.ts` `register(host)` | Wire the new task |
| 17 | `apps/worker/src/.../handlers/marketplace-fulfillment-status-sync.handler.ts` (NEW) + registration | Worker handler |
| 18 | Unit specs for every new/touched file | **Mapper** (5 cases: `delivered=1` → Delivered+deliveredAt; `shipped=1 && delivered≠1` → Dispatched+dispatchedAt; state name matches cancel-regex → Cancelled+cancelledAt; orphaned `current_state` / null state row → `status: null`; tracking precedence — `shipping_number` wins over `order_carriers[].tracking_number`). **Adapter** (state-map cache hit on the 2nd call; WS list-resources call shape against `order_states` + `order_carriers`). **Sync service** (routing-cache: two records with the same `(source, method)` issue exactly one `routing.resolve` call; branch-2/3 routing → `skipped++`, no Shipment write; `snapshot.status === null` → `skipped++`, no Shipment write; find-or-create branching; partial-unique-index conflict on concurrent create → caught, counted as `failed` not throw). **Repository** (`findBranchOneByOrderAndConnection` returns null when no row, null when only a non-null-`providerShipmentId` row exists, the row when a `providerShipmentId IS NULL` row exists). |
| 19 | `apps/api/test/integration/prestashop-branch1-status.int-spec.ts` (NEW) | End-to-end: seed PS order → routing rule omp_fulfilled → sync runs → Shipment row appears with correct status / tracking; second sync no-ops; PS-state advance projects to the row. |

## 5. Validation

- **Architecture:** ADR-012 honoured — branch-1 stays on `OrderProcessorManagerPort + CarrierMapping`; new sub-capability sits on `OrderProcessorManager` in the same shape as `OrderFulfillmentUpdater` (#858). The sync service is the sole branch-1 Shipment lifecycle owner — no cross-context coupling between `orders` and `shipping` is introduced. The PS adapter lives in `libs/integrations/prestashop`; no core→plugin value imports.
- **Naming:** `*.capability.ts` + co-located guard (per engineering-standards §"Port sub-capabilities"); `*.service.ts` + sibling `*.service.interface.ts`; `*.types.ts` for types; `*.mapper.ts` for the mapper.
- **Symbol DI tokens:** `FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN` in `libs/core/src/shipping/shipping.tokens.ts` (#595 convention).
- **Type strictness:** no `any`; the snapshot's `status: ShipmentStatus | null` cleanly encodes the "PS hasn't acted" case in the type system.
- **Tests:** unit specs for mapper, adapter, sync service, scheduler-task builder, worker handler, repository extensions. Int-spec verifies the projection vertical-slice through real Postgres.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test`; `pnpm --filter @openlinker/api migration:show` → one new migration (`1799000000007-add-branch-one-shipments-uq-index.ts`) listed as pending, runs cleanly forward + reverts cleanly.

## 6. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Iterating Order Records is unbounded over time.** | `OrderRecordFilters.updatedSince` bounds the scan. Default 30 days, exposed via `FulfillmentStatusSyncOptions.updatedSinceDays?: number` so the scheduler-task config can override per-operator without code change. **30 days is a v1 guess** — covers normal B2C cadence, misses operators who ship 6-week-old B2B-with-approval orders. Two follow-up options if v1 signal demands it: (i) drop the bound entirely and page across all destination-matching records like `OfferStatusSyncService` (#816), accepting slower scans for completeness; (ii) double-watermark — time window + a periodic "scan latest N un-projected" sweep so the long tail isn't perpetually missed. Both are over-engineering for v1; ship the 30-day single bound and re-decide once operator data arrives. |
| **Race-creates if scheduler fires the same connection twice.** | Per-connection serialisation in the scheduler today (one job per connection per tick) + partial-unique index `(orderId, connectionId) WHERE providerShipmentId IS NULL` as DB-side guard. |
| **Conservative PS-state mapping leaves shipments forever `dispatched`.** | Acceptable v1 trade-off — `delivered`/`cancelled` are explicit; further-grained transitions (`in-transit`, etc.) are a documented follow-up once we have operator feedback on which PS states should map to what. |
| **Pre-fulfillment branch-1 orders aren't visible on `/shipments`.** | Documented intentional UX consequence of projection-only. Follow-up FE issue (deferred): aggregate "pending PS fulfillment" count + link on `/shipments`. Not in #834. |
| **Routing rules with `processorConnectionId === null` (fan-out default).** | The sync service's "destination match" check (§3.4 step 3) handles this: when `processorConnectionId === null`, any destination matches; when non-null, only that specific connection. Both shapes work. |

## 7. Out-of-scope follow-ups (file when appropriate)

- **FE:** `/shipments` "pending PS fulfillment" hint banner + link to `/orders` filter. Restores the "single pane" UX intent without polluting the data model.
- **Richer PS-state → `ShipmentStatus` mapping** (e.g. forward transitions to `in-transit` on PS `shipped` once we have signal data).
- **Order-state mapping configurability** (#862 — `feat(prestashop,mappings): operator-configurable OL→PrestaShop order-state mapping`) is the inverse direction; this PR's read-back mapping could later consume that config table once it ships.
- **Watch-list-style invalidation**: if PS state changes are bursty, a webhook-driven invalidation could eventually replace polling. Not v1.
