## Implementation plan — `ShippingProviderManagerPort` foundation (#763)

**Branch:** `763-shipping-provider-manager-port`
**Issue:** [#763](https://github.com/openlinker-project/openlinker/issues/763)
**Parent spec:** `docs/specs/product-spec-727-inpost-integration.md` (#727)
**Layer:** CORE — domain ports + entities + ORM + migration. No adapters, no services, no HTTP.
**Effort:** S (~3–5 days)

---

### 1. Goal

Establish the domain-layer foundation that every shipping adapter (InPost #764, future Allegro Delivery #732 sibling) and downstream slice (paczkomat cache #766, FE panel #769, polling fallback #772, webhook #768) will depend on. After this issue merges, **nine downstream issues unblock**.

**In scope** (per issue body, with deviations from the literal spec documented in §3.5):

1. New bounded context `libs/core/src/shipping/`.
2. `ShippingProviderManagerPort` — base port with three required methods: `generateLabel`, `getTracking`, `getSupportedMethods(): readonly ShippingMethod[]`. Optional methods extracted into sub-port `*.capability.ts` files per engineering-standards §"Port sub-capabilities" (#337 listings precedent).
3. Sub-capabilities (`domain/ports/capabilities/`):
   - `ShipmentCanceller` (`cancelShipment(input)`) + `isShipmentCanceller(adapter)` type guard.
   - `PickupPointFinder` (`findPickupPoints(query)`) + `isPickupPointFinder(adapter)` type guard.
4. `ShippingMethod` (`paczkomat | kurier`) as `as const` union — sole shipping-level capability vocabulary. The runtime-discoverable answer to "what shipment types can this adapter produce?" is `getSupportedMethods()`. The product-spec strings `tracking-webhooks` and `cancel-shipment` are NOT in this vocabulary — see §1.1.
5. Domain entities + supporting types:
   - `Shipment` (id, orderId, connectionId, shippingMethod, providerShipmentId, status, paczkomatId?, trackingNumber?, labelPdfRef?, dispatchedAt?, deliveredAt?, errorMessage?)
   - `PickupPoint` (providerId, name, address, status, lat?, lon?, openingHours?) — value type, not persisted in this slice.
6. Repository ports — `ShipmentRepositoryPort` (persistent), `PickupPointCachePort` (no persistence in this slice; #766 implements via Redis).
7. ORM entity + repository implementation for `Shipment`.
8. Symbol tokens in `shipping.tokens.ts`.
9. Migration `up()` + `down()` round-tripping cleanly. Adds `'Shipment'` to `CoreEntityTypeValues` + `CORE_ENTITY_TYPE` so `Shipment.id` follows the canonical `ol_shipment_*` format.
10. Public surface exported via the top-level `@openlinker/core/shipping` barrel + `package.json` `exports` entry.

### 1.1 Deviations from the literal product-spec capability vocabulary

The #727 product spec (SC-5) calls out four capability strings: `paczkomat-shipment`, `kurier-domestic-shipment`, `tracking-webhooks`, `cancel-shipment`. The tech-review (2026-05-19) flagged that translating these to a single `getCapabilities(): readonly ShippingCapability[]` method conflates **three** different concerns:

| Spec string | Concern | Implementation in this plan |
|---|---|---|
| `paczkomat-shipment` | Parameter-value support for `cmd.shippingMethod` | Entry in `ShippingMethod` union; `getSupportedMethods()` returns it |
| `kurier-domestic-shipment` | Parameter-value support for `cmd.shippingMethod` | Same — entry in `ShippingMethod` union |
| `cancel-shipment` | Optional method presence | `ShipmentCanceller.capability.ts` sub-port + `isShipmentCanceller(adapter)` type guard (matches engineering-standards §"Port sub-capabilities" + 16-file precedent in `libs/core/src/listings/domain/ports/capabilities/`) |
| `tracking-webhooks` | Plugin-family webhook-ingestion support | NOT on the port at all — derived from existing `WebhookProvisioningRegistryService` per architecture-overview §11 (#583). The InPost plugin registers a `WebhookProvisioningPort` at its adapter key; `webhookProvisioningRegistry.has('inpost.shipx.v1')` is the single source of truth |

The FE's AC-11 ("if no connection declares paczkomat-shipment or kurier-domestic-shipment capability, InPost-specific terminology does NOT appear") is preserved without behaviour change — the API response seam derives the capability-string list from `getSupportedMethods()` + the registries on the way out (single mapping function, ~5 lines).

This deviation should be re-confirmed at PR review.

**Explicit non-goals** (per issue body):

- InPost adapter (#764) — implements this port; out of scope here.
- Paczkomat caching service (#766) — consumes `PickupPointCachePort` but supplies the impl.
- HTTP API endpoints — none in this slice.
- FE work — none in this slice.
- ORM entity for `PickupPoint` — it's an API-fetched value cached in Redis (per spec SC-2). Defined as a domain type, not persisted.
- Webhook provisioning UI / dispatch — handled by the existing `WebhookProvisioningRegistryService` (#583); the InPost plugin (#764/#768) will register its provisioner there.

### 2. Architectural classification

**Layer:** CORE / Domain + Infrastructure / Persistence. Strict hexagonal boundary — `libs/core/src/shipping/domain/**` must have zero framework imports (no `@nestjs/*`, no `typeorm`). Per `.claude/rules/backend.md`.

**Cross-context shape:** the new context publishes pure contracts on `@openlinker/core/shipping` (types, ports, capability constants, exceptions, tokens, the domain entity class). The `ShippingModule` + `ShipmentRepository` implementation are exported from the same barrel — same shape as `inventory`, simpler than `listings` (no `/services` sub-barrel needed since there are no application services yet and no value-import cycle to worry about — single-file modules are the common case per `docs/engineering-standards.md § Import Aliases`).

### 3. Sibling-pattern reuse — established conventions

| Pattern | Reference | Application here |
|---|---|---|
| Top-level barrel + tokens-export-star | `libs/core/src/inventory/index.ts`, `inventory.tokens.ts` | Mirror for `shipping.tokens.ts` + `index.ts`. |
| Symbol DI token naming | `INVENTORY_REPOSITORY_TOKEN = Symbol('InventoryRepositoryPort')` | `SHIPMENT_REPOSITORY_TOKEN`, `PICKUP_POINT_CACHE_TOKEN`. |
| `as const` + union + `*_STATUS` named-constant map | `BULK_BATCH_STATUS` in `bulk-offer-creation-batch.types.ts` | Same shape for `SHIPMENT_STATUS`, `SHIPPING_METHOD`. |
| **Port sub-capabilities** (`*.capability.ts` + co-located `is{Capability}` type guard under `domain/ports/capabilities/`) per engineering-standards §"Files and Folders" | `libs/core/src/listings/domain/ports/capabilities/` (16 files, #337) — `OfferCreator`, `OfferStatusReader`, `OfferLister`, etc. | Same shape for `ShipmentCanceller`, `PickupPointFinder`. |
| Anemic domain entity (DDD direction is open — #750) | `BulkOfferCreationBatch` | `Shipment` matches the readonly-fields-via-constructor shape. |
| Canonical entity ID via `formatInternalId(entityType)` → `ol_{prefix}_{uuid}` | `Product`, `Order`, `Customer` (per architecture-overview "Internal Identifier Format") | Add `'Shipment'` to `CoreEntityTypeValues` + `CORE_ENTITY_TYPE`; `Shipment.id` is `ol_shipment_*`, persisted as `text PRIMARY KEY`. Repository generates the ID at create-time via `formatInternalId('Shipment')` (no `IdentifierMappingService` involvement — `Shipment` is not cross-platform-mapped). |
| Repository port → infrastructure impl, private `toDomain` / `toOrm` mappers | `BulkOfferCreationBatchRepository` | Same shape for `ShipmentRepository`. |
| Repository unit spec mocking the TypeORM `Repository<T>` (no Docker) | `bulk-offer-creation-batch.repository.spec.ts` | Same harness for `shipment.repository.spec.ts`. |
| Migration with `up()` + `down()`, indexes named `IDX_<table>_<col>`, no FKs on connection/order ids (newer convention) | `1797000000000-add-bulk-offer-creation-batches.ts` | Same shape for `1799000000000-add-shipments-table.ts`. |
| `package.json` `exports` entry per context | `./inventory`, `./inventory/orm-entities` | Add `./shipping` (no `orm-entities` sub-barrel — no cross-context consumer yet). |

### 4. File-by-file plan

#### 4.1 Domain types (`libs/core/src/shipping/domain/types/`)

**`shipment-status.types.ts`** — persistent shipment lifecycle. Drops `none` from the spec list (which is a UI-only state computed from "no row exists"). Uses `draft` instead of `pending` for the pre-provider state — `pending` is overloaded in OL (sync jobs use it for "queued for worker", offer creation for "awaiting marketplace"), and the shipping panel needs an unambiguous label. The FE can render `draft` as "Pending" verbatim if the operator-facing copy needs to stay that word; the internal vocabulary stays unambiguous.

```ts
export const ShipmentStatusValues = [
  'draft',       // row created, label not yet generated by provider
  'generated',   // label PDF returned, awaiting dispatch
  'dispatched',  // courier picked up
  'in-transit',  // first scan after dispatch
  'delivered',   // terminal success
  'failed',      // terminal failure (label-gen rejection, courier-side error)
  'cancelled',   // operator-cancelled (AC-7 cancel + re-issue path); terminal
] as const;
export type ShipmentStatus = (typeof ShipmentStatusValues)[number];
export const SHIPMENT_STATUS = { /* mirrored named-constant map */ };
```

**Append-only multiplicity:** `Shipment` rows mirror real external commitments (each `generateLabel` call issues a provider shipment id, reserves locker capacity, sometimes accrues a cancel fee even on void). Per the established OL pattern for attempt-records (`OfferCreationRecord`, `webhook_deliveries`, `BulkBatchAdvancement`, `OrderRecord.syncAttempts`), `Shipment` is append-only: 1 order → N shipments over time. The AC-7 "cancel + re-issue" flow flips the existing row to `cancelled` and INSERTs a new row for the re-issue (preserves the cancelled tracking number, paczkomat id, and label-pdf reference for audit + customer-support forensics). Future multi-package shipments (spec §6 v2) drop into the same schema without migration.

**`shipping-method.types.ts`** — `as const satisfies Record<...>` discipline matches `BULK_BATCH_STATUS` (keys + values both type-checked against the union):

```ts
export const ShippingMethodValues = ['paczkomat', 'kurier'] as const;
export type ShippingMethod = (typeof ShippingMethodValues)[number];
export const SHIPPING_METHOD = {
  Paczkomat: 'paczkomat',
  Kurier: 'kurier',
} as const satisfies Record<'Paczkomat' | 'Kurier', ShippingMethod>;
```

**`pickup-point.types.ts`** — domain value type for paczkomat-like pickup points (provider-fetched, cached, not persisted in `shipments`). Distinct from `OrderPickupPoint` in `@openlinker/core/orders` (which is just the bare locker-id reference on a source order). Opening hours preserved as a structured 7-day grid — InPost's ShipX returns this shape natively, and collapsing to a free-form string at the domain boundary is lossy (forecloses future "open now?" / "open this weekend?" filtering without a cache migration). Matches OL's convention for provider-side structured external data (cf. `OfferCategory`, `CategoryParameter`).

```ts
export const PickupPointStatusValues = ['active', 'temporarily-unavailable'] as const;
export type PickupPointStatus = (typeof PickupPointStatusValues)[number];
export const PICKUP_POINT_STATUS = {
  Active: 'active',
  TemporarilyUnavailable: 'temporarily-unavailable',
} as const satisfies Record<'Active' | 'TemporarilyUnavailable', PickupPointStatus>;

export const PickupPointDayValues = [
  'mo', 'tu', 'we', 'th', 'fr', 'sa', 'su',
] as const;
export type PickupPointDay = (typeof PickupPointDayValues)[number];
export const PICKUP_POINT_DAY = {
  Monday: 'mo', Tuesday: 'tu', Wednesday: 'we', Thursday: 'th',
  Friday: 'fr', Saturday: 'sa', Sunday: 'su',
} as const satisfies Record<
  'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday',
  PickupPointDay
>;

export interface PickupPointAddress {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
}

/**
 * Per-day open/close times. `intervals: null` means closed that day.
 * Each interval is an `HH:MM` range in the provider's local timezone
 * (PL = Europe/Warsaw for InPost). Multiple intervals per day support
 * split-day schedules (e.g. siesta breaks).
 */
export interface PickupPointDayHours {
  intervals: readonly { open: string; close: string }[] | null;
}

export type PickupPointOpeningHours = Readonly<Record<PickupPointDay, PickupPointDayHours>>;

export interface PickupPoint {
  providerId: string;        // e.g. 'POZ08A'
  name: string;
  address: PickupPointAddress;
  status: PickupPointStatus;
  lat?: number;
  lon?: number;
  openingHours?: PickupPointOpeningHours;
}

/**
 * Query shape for `PickupPointFinder.findPickupPoints`. Co-located with
 * `PickupPoint` because it's part of the same domain concept and the only
 * consumer is the pickup-point-finder sub-capability.
 */
export interface FindPickupPointsQuery {
  city?: string;
  postalCode?: string;
  searchText?: string;
  limit?: number;
}
```

**`generate-label.types.ts`** — port-input/output types for `ShippingProviderManagerPort.generateLabel`. Lives in `*.types.ts` per engineering-standards §"Type Definitions in Separate Files" (mirrors listings' `offer-create.types.ts` precedent — port files contain only the port interface; their types live in dedicated files).

```ts
import type { ShippingMethod } from './shipping-method.types';

export interface GenerateLabelCommand {
  shipmentId: string;        // internal Shipment id (ol_shipment_*)
  orderId: string;
  connectionId: string;
  shippingMethod: ShippingMethod;
  paczkomatId?: string;      // required for paczkomat method
}

export interface GenerateLabelResult {
  providerShipmentId: string;
  trackingNumber: string | null;
  labelPdfRef: string;       // adapter-supplied opaque reference (URL, blob id, etc.)
}
// NOTE: no `platformParams` / `overrides` escape hatch in this foundation
// slice. When #764 (InPost adapter) needs adapter-specific fields (parcel
// dims, sender-address override, etc.), that PR adds them — either as
// typed optional fields on the canonical command, or as a typed
// `GenerateLabelOverrides` interface (mirroring listings' CreateOfferOverrides
// shape) with `platformParams?: Record<string, unknown>` as the bottom-of-
// stack escape hatch. Adding optional fields is forward-compatible;
// speculating now risks locking in the wrong shape before two real
// adapters (#764 + future #732) reveal what's shared vs adapter-specific.
```

**`tracking-snapshot.types.ts`** — port output for `ShippingProviderManagerPort.getTracking`. Separate file so the polling-fallback (#772) and webhook handler (#768) can value-import the type without pulling in the rest of the port surface.

```ts
import type { ShipmentStatus } from './shipment-status.types';

export interface TrackingSnapshot {
  status: ShipmentStatus;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  /** Provider-native status code, for diagnostics. */
  providerStatus?: string;
}
```

**`shipment.types.ts`** — input contracts for repository writes. Mirrors `CreateBulkOfferCreationBatchInput` discipline (input types decoupled from entity shape).

```ts
export interface CreateShipmentInput {
  orderId: string;          // internal `ol_order_*`
  connectionId: string;     // shipping-provider connection
  shippingMethod: ShippingMethod;
  paczkomatId?: string;     // required when shippingMethod === 'paczkomat'
}

export interface UpdateShipmentInput {
  status?: ShipmentStatus;
  providerShipmentId?: string;
  trackingNumber?: string;
  labelPdfRef?: string;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  failedAt?: Date;
  errorMessage?: string | null;
}
```

#### 4.2 Domain entities (`libs/core/src/shipping/domain/entities/`)

**`shipment.entity.ts`** — anemic, readonly constructor args matching `BulkOfferCreationBatch` shape.

```ts
export class Shipment {
  constructor(
    public readonly id: string,
    public readonly orderId: string,
    public readonly connectionId: string,
    public readonly shippingMethod: ShippingMethod,
    public readonly status: ShipmentStatus,
    public readonly providerShipmentId: string | null,
    public readonly paczkomatId: string | null,
    public readonly trackingNumber: string | null,
    public readonly labelPdfRef: string | null,
    public readonly dispatchedAt: Date | null,
    public readonly deliveredAt: Date | null,
    public readonly cancelledAt: Date | null,
    public readonly failedAt: Date | null,
    public readonly errorMessage: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
```

**Terminal-state timestamps follow the `OfferCreationRecord` precedent** — each terminal status has its own column rather than relying on `updatedAt` (which gets overwritten on any subsequent update). `dispatchedAt` / `deliveredAt` / `cancelledAt` / `failedAt` together form an append-only timeline for the shipment's life. Skipped `generatedAt` — that transition is recoverable from the worker job record that called `generateLabel`.

Decision note: `shippingMethod` is added to the entity even though the issue's terse spec omits it — without it the `paczkomatId?` discriminator alone can't distinguish a paczkomat shipment with a not-yet-fetched locker from a kurier shipment. The field is cheap, has an `as const` domain, and makes the spec-AC-10 filter (`paczkomat vs kurier`) a simple column query.

#### 4.3 Domain ports (`libs/core/src/shipping/domain/ports/`)

**`shipping-provider-manager.port.ts`** — base port. Three required methods. Optional methods extracted into sub-capabilities per engineering-standards §"Port sub-capabilities" (mirroring listings #337). Adapters declare extra capabilities via `implements ShippingProviderManagerPort, ShipmentCanceller, PickupPointFinder, …`; call sites narrow support via co-located type guards. Port file is **interface-only** per engineering-standards §"Interface and Implementation Separation" — all command / result / snapshot types live in dedicated `*.types.ts` siblings (see §4.1).

```ts
import type { ShippingMethod } from '../types/shipping-method.types';
import type { GenerateLabelCommand, GenerateLabelResult } from '../types/generate-label.types';
import type { TrackingSnapshot } from '../types/tracking-snapshot.types';

export interface ShippingProviderManagerPort {
  /**
   * Generate a label for a shipment. Throws if `cmd.shippingMethod` isn't in
   * `getSupportedMethods()`.
   */
  generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult>;

  /**
   * Read the latest tracking snapshot from the provider. Required because
   * polling-fallback (#772) is always available as a degradation path even
   * when webhooks are provisioned.
   */
  getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot>;

  /**
   * Declares which `ShippingMethod` values this adapter accepts for
   * `generateLabel`. Static per adapter — does NOT change at runtime.
   * Drives the AC-11 capability-conditional FE rendering via an API-response
   * mapping seam (see §1.1).
   */
  getSupportedMethods(): readonly ShippingMethod[];
}
```

##### 4.3.1 Sub-capabilities (`libs/core/src/shipping/domain/ports/capabilities/`)

Each file mirrors the listings shape (`offer-creator.capability.ts` precedent): one optional interface + one `is{Capability}(adapter)` type guard. Call sites narrow via the guard; after the guard TypeScript knows the optional method exists.

**`shipment-canceller.capability.ts`**:

```ts
import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';

export interface ShipmentCanceller {
  /**
   * Void a shipment that has not yet dispatched. Behavior on dispatched
   * shipments is provider-specific; callers should check Shipment.status
   * before invoking.
   */
  cancelShipment(input: { providerShipmentId: string }): Promise<void>;
}

export function isShipmentCanceller(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & ShipmentCanceller {
  return typeof (adapter as Partial<ShipmentCanceller>).cancelShipment === 'function';
}
```

**`pickup-point-finder.capability.ts`** — capability file is **interface + type-guard only**; `FindPickupPointsQuery` lives in `pickup-point.types.ts` (co-located with `PickupPoint` since both belong to the same domain concept and have a single consumer):

```ts
import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';
import type { PickupPoint, FindPickupPointsQuery } from '../../types/pickup-point.types';

export interface PickupPointFinder {
  findPickupPoints(query: FindPickupPointsQuery): Promise<PickupPoint[]>;
}

export function isPickupPointFinder(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & PickupPointFinder {
  return typeof (adapter as Partial<PickupPointFinder>).findPickupPoints === 'function';
}
```

##### 4.3.1.1 Sub-capability type-guard specs (`libs/core/src/shipping/domain/ports/capabilities/__tests__/`)

Both type-guards ship with a spec mirroring the listings precedent at `libs/core/src/listings/domain/ports/capabilities/__tests__/`. Two-test shape per guard:

**`shipment-canceller.capability.spec.ts`**:

```ts
describe('isShipmentCanceller', () => {
  it('should narrow when the adapter implements cancelShipment', () => {
    const adapter: ShippingProviderManagerPort & ShipmentCanceller = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      cancelShipment: jest.fn(),
    };
    expect(isShipmentCanceller(adapter)).toBe(true);
  });

  it('should return false when the adapter does not implement cancelShipment', () => {
    const adapter: ShippingProviderManagerPort = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
    };
    expect(isShipmentCanceller(adapter)).toBe(false);
  });
});
```

**`pickup-point-finder.capability.spec.ts`** — same shape for `isPickupPointFinder`.

##### 4.3.2 Repository ports

**`shipment-repository.port.ts`** — shaped for the append-only model:

```ts
export interface ShipmentRepositoryPort {
  create(input: CreateShipmentInput): Promise<Shipment>;
  findById(id: string): Promise<Shipment | null>;
  /**
   * All shipments for an order, ordered by createdAt ASC. Returns [] if
   * the order has no shipments yet. Multiple rows happen on AC-7
   * cancel + re-issue (and on future multi-package shipments).
   */
  findByOrderId(orderId: string): Promise<readonly Shipment[]>;
  /**
   * Most-recent non-terminal shipment for an order, or null if none.
   * Terminal statuses excluded: `delivered`, `failed`, `cancelled`.
   * This is the row the order-detail "Shipment" panel renders.
   */
  findActiveByOrderId(orderId: string): Promise<Shipment | null>;
  findByProviderShipmentId(providerShipmentId: string): Promise<Shipment | null>;
  update(id: string, patch: UpdateShipmentInput): Promise<Shipment>; // throws ShipmentNotFoundException if 0 rows
}
```

Keep it minimal. `listShipments` (with cross-order filters) belongs to the future query service for AC-10; not in this foundation slice.

**`pickup-point-cache.port.ts`** — defined here, **implemented in #766** (Redis 24h TTL + background refresh). Intentionally narrow per engineering-standards §"Repository Ports Pattern" ("keep it minimal — only methods needed by application services"). The single-item shape lets #766's warmer use whatever Redis pipelining / `MSET` strategy it wants *below* the port; bulk semantics aren't a domain concern. Mirrors `SellerPoliciesCacheRepositoryPort`'s minimalism.

```ts
export interface PickupPointCachePort {
  /** Returns the cached point or null. Does NOT trigger a refetch. */
  get(providerId: string): Promise<PickupPoint | null>;
  /** Replace the cached entry; TTL handled by implementation. */
  put(point: PickupPoint): Promise<void>;
}
```

No `delete()` / `refresh()` — explicit invalidation isn't a v1 use case (SC-2 is TTL-driven). Add them when a real consumer surfaces. No bulk methods — if #766 needs bulk-warm semantics, `Promise.all(points.map(p => this.cache.put(p)))` inside the warmer is the right shape; the Redis client below can pipeline transparently.

#### 4.4 Domain exceptions (`libs/core/src/shipping/domain/exceptions/`)

**`shipment-not-found.exception.ts`** — mirrors `BulkOfferCreationBatchNotFoundException`. Used by `update()` when 0 rows match.

#### 4.5 Infrastructure persistence (`libs/core/src/shipping/infrastructure/persistence/`)

**`entities/shipment.orm-entity.ts`** — `@Entity('shipments')`. `id` is `@PrimaryColumn({ type: 'text' })` (NOT `@PrimaryGeneratedColumn` — the application generates `ol_shipment_*` via `formatInternalId('Shipment')` at create time, mirroring how Order / Product ids are produced). `@Index` declarations for `connectionId`, `orderId`, `status`, and a unique index on `providerShipmentId` (partial-where-not-null) so the same provider shipment id can't be assigned to two rows. `orderId` is `text` (matches `ol_order_*` shape); `connectionId` is `uuid`.

**`repositories/shipment.repository.ts`** — `@Injectable() ShipmentRepository implements ShipmentRepositoryPort`. `create()` generates the internal id via `formatInternalId('Shipment')` from `@openlinker/core/identifier-mapping` before persisting (no `IdentifierMappingService` call — Shipment is not cross-platform-mapped). Private `toDomain` / `toOrm` mappers. Throws `ShipmentNotFoundException` on `update()` when `Repository.update(id, …).affected === 0`. No FK constraints emitted (matches `bulk_offer_creation_batches` recent convention).

**`repositories/shipment.repository.spec.ts`** — unit test using `getRepositoryToken(ShipmentOrmEntity)` + a `jest.Mocked<Repository<…>>` stub. Coverage:

- `create()` happy path → returns domain entity with correct field mapping; `id` asserted via `expect(result.id).toMatch(/^ol_shipment_[a-f0-9]{32}$/)` (catches regressions in `formatInternalId` and the `'Shipment'` → `'shipment'` lowercase fallback).
- `findById` / `findByProviderShipmentId` — found + null paths.
- `findByOrderId` — empty-array, single-row, multi-row (cancel + re-issue scenario, asserts `createdAt ASC` ordering).
- `findActiveByOrderId` — picks the most-recent non-terminal row out of a mix of terminal and non-terminal shipments; returns null when every row is terminal.
- `update()` happy path with partial patch — only the patched fields change.
- `update()` not-found path — throws `ShipmentNotFoundException`.
- Mapper round-trip — `toOrm(toDomain(orm))` and `toDomain(toOrm(domain))` preserve every field including the nullables.

#### 4.6 Module + tokens

**`shipping.tokens.ts`**:

```ts
export const SHIPMENT_REPOSITORY_TOKEN = Symbol('ShipmentRepositoryPort');
export const PICKUP_POINT_CACHE_TOKEN = Symbol('PickupPointCachePort');
```

**`shipping.module.ts`** — registers `ShipmentOrmEntity` via `TypeOrmModule.forFeature` (private to the module) and binds `ShipmentRepository` to `SHIPMENT_REPOSITORY_TOKEN` via `useExisting`. **Exports only the port binding** (`exports: [SHIPMENT_REPOSITORY_TOKEN]`) — does NOT re-export `TypeOrmModule.forFeature(...)` because consumers must inject the port (`@Inject(SHIPMENT_REPOSITORY_TOKEN)`) and never see `Repository<ShipmentOrmEntity>` directly. Keeping the ORM type private to the module preserves the hexagonal boundary documented in engineering-standards §"ORM ↔ Domain Mapping". No binding for `PICKUP_POINT_CACHE_TOKEN` here — that's #766's job.

#### 4.7 Public barrel + `package.json` exports

**`libs/core/src/shipping/index.ts`** — re-exports types, ports + sub-capability interfaces + their type guards, exceptions, the domain entity, `ShippingModule`, and `export * from './shipping.tokens';`. The two sub-capability exports follow the listings barrel shape: `export type { ShipmentCanceller } from './domain/ports/capabilities/shipment-canceller.capability'; export { isShipmentCanceller } from './...';` (same line for `PickupPointFinder` / `isPickupPointFinder`).

**`libs/core/package.json`** — add the `./shipping` exports entry mirroring the `./inventory` block. **No `./shipping/orm-entities` sub-barrel** — no cross-context consumer yet (`Shipment` is shipping-only). Add it later if a sibling registers a foreign-key constraint or test fixture (per `docs/engineering-standards.md § Import Aliases`).

#### 4.8 Identifier-mapping registry edit

**`libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts`** — extend both:

```ts
export const CoreEntityTypeValues = [
  'Product', 'ProductVariant', 'Sku', 'Order', 'Offer', 'Inventory', 'Customer',
  'Shipment', // ← new (#763)
] as const;

export const CORE_ENTITY_TYPE = {
  // ... existing entries ...
  Shipment: 'Shipment', // ← new
} as const satisfies Record<CoreEntityType, CoreEntityType>;
```

No `ENTITY_TYPE_ID_PREFIX` override needed — the default `'Shipment'.toLowerCase()` → `'shipment'` produces the desired `ol_shipment_*` format. Update the matching spec at `libs/core/src/identifier-mapping/domain/types/__tests__/identifier-mapping.types.spec.ts` (asserts the exact `CoreEntityTypeValues` array). Architecture-overview §"Internal Identifier Format" lists the prefix examples — append `ol_shipment_*` there.

#### 4.9 Migration

**Filename / class timestamp:** the plan pins `1799000000000` because that's the next free 13-digit slot after the latest-merged main migration (`1798000000000-add-smart-classification-and-batch-advancements.ts`). If another PR lands and takes that slot first, bump both the filename prefix AND the class suffix to the next free millisecond per docs/migrations.md §"Timestamp uniqueness invariant"; `scripts/check-migration-timestamps.mjs` runs under `pnpm lint` and fails on any collision or filename-vs-class drift.

**`apps/api/src/migrations/1799000000000-add-shipments-table.ts`** (class name: `AddShipmentsTable1799000000000`):

```sql
CREATE TABLE "shipments" (
  "id"                  text PRIMARY KEY,
  "orderId"             text NOT NULL,
  "connectionId"        uuid NOT NULL,
  "shippingMethod"      text NOT NULL,
  "status"              text NOT NULL,
  "providerShipmentId"  text,
  "paczkomatId"         text,
  "trackingNumber"      text,
  "labelPdfRef"         text,
  "dispatchedAt"        TIMESTAMP,
  "deliveredAt"         TIMESTAMP,
  "cancelledAt"         TIMESTAMP,
  "failedAt"            TIMESTAMP,
  "errorMessage"        text,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX "IDX_shipments_orderId"       ON "shipments" ("orderId");
CREATE INDEX "IDX_shipments_connectionId"  ON "shipments" ("connectionId");
CREATE INDEX "IDX_shipments_status"        ON "shipments" ("status");
CREATE UNIQUE INDEX "UQ_shipments_providerShipmentId"
  ON "shipments" ("providerShipmentId") WHERE "providerShipmentId" IS NOT NULL;
```

`down()` drops every index + the table.

#### 4.10 Host wiring

**`apps/api/src/app.module.ts`** — add `import { ShippingModule } from '@openlinker/core/shipping';` to the imports array. Worker is not touched in this slice (no worker handlers consume the repository yet).

### 5. Quality-gate verification

1. `pnpm lint` — zero errors.
2. `pnpm type-check` — zero errors. The new context must build cleanly (TypeScript project references include `libs/core` already).
3. `pnpm test` — all unit tests pass, including the new `shipment.repository.spec.ts`.
4. `pnpm --filter @openlinker/api migration:show` — confirms `1799000000000-add-shipments-table` is listed as pending on a fresh DB and `[X]` after `migration:run`.
5. Manual migration round-trip — `migration:run` then `migration:revert` then `migration:run` cleanly on a local DB.

### 6. Risks / open questions

| | Risk | Mitigation |
|---|---|---|
| R1 | Shipment status vocabulary may need to shift once the adapter (#764) lands and we see real ShipX state names — the spec's AC list is UI-oriented, not ShipX-native. | `as const` union makes additions trivially compatible; adapter is free to ADD new statuses by extending the array. Removing a value requires a coordinated migration, but no value is locked in by external contract today. |
| R2 | `findByProviderShipmentId` requires partial-unique index — Postgres-only feature. | Already used elsewhere in the codebase (e.g. webhook-deliveries dedup); no risk. |
| R3 | `labelPdfRef` shape is adapter-defined (URL vs blob id) and may need a typed wrapper later. | Storing as opaque `text` is the right shape today; downstream FE just renders a `<a href>` if it's an absolute URL, otherwise hands to the adapter for resolution. Re-evaluate when #769 lands. |
| R4 | Adding `shippingMethod` to the `Shipment` entity diverges from the issue's literal field list. | Documented in §4.2 with rationale; the alternative (paczkomatId-as-discriminator) is fragile during the pending → generated window when paczkomatId may not yet be resolved. Also: `Shipment.shippingMethod` is the persisted answer to "what method was this shipment created with?" — exactly the column the AC-10 filter (`paczkomat vs kurier`) reads. |
| R5 | Port shape deviates from the literal #727 product-spec capability vocabulary (4-string `getCapabilities()`). | Tech-review (2026-05-19) determined the spec's vocabulary conflates three concerns and contradicts the documented `*.capability.ts` sub-capability pattern (engineering-standards §"Files and Folders"). §1.1 documents the mapping; §3 reuse-patterns table grounds it in the listings #337 precedent. Re-confirm at PR review. |
| R6 | Duplicate-provider-shipment-id collision on the partial-unique index would leak `QueryFailedError` past the port. | Not load-bearing for v1 — ShipX issues globally-unique provider ids and no consumer can trigger the collision today. When/if a concurrent-write path emerges (e.g. webhook + polling racing on the same shipment), wrap the `QueryFailedError` for `UQ_shipments_providerShipmentId` into a domain exception `DuplicateProviderShipmentIdError` in `domain/exceptions/` per engineering-standards §"Repository error handling pattern" (cf. `DuplicateIdentifierMappingError`). Deferred — not added in this slice. |

### 7. Definition of done

- All new files (§4.1–§4.10, ~20 new files including the two sub-capability spec files + the two new types files) exist and compile, plus the documented edits to `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts` + its spec, `libs/core/package.json` (new `./shipping` exports entry), `apps/api/src/app.module.ts` (new import), and `docs/architecture-overview.md § Internal Identifier Format` (append `ol_shipment_*` example).
- **Every new `.ts` file** under `libs/core/src/shipping/**` and `apps/api/src/migrations/**` ships with a JSDoc file header per engineering-standards §"File Headers" (Purpose + Context, optional `@module`, optional `@see`).
- `pnpm lint && pnpm type-check && pnpm test` green from a clean checkout of this branch.
- `pnpm --filter @openlinker/api migration:run` then `migration:revert` round-trip clean on a fresh DB.
- The new `@openlinker/core/shipping` subpath resolves at runtime from another package (smoke-test by adding a throwaway `console.log` in `apps/api/src/app.module.ts` that imports `SHIPMENT_REPOSITORY_TOKEN` and removing before commit).
- PR description includes `Closes #763`.

### 8. Out-of-scope reminders (for the PR reviewer)

- **InPost adapter** (#764) — separate issue, depends on this. Will implement `ShippingProviderManagerPort` against ShipX REST.
- **Paczkomat caching** (#766) — separate issue, depends on this. Will implement `PickupPointCachePort` against Redis.
- **PS direct-order paczkomat reader** (#767) — independent of this issue.
- **FE order Shipment panel** (#769), **`/shipments` page** (#770), **connection-settings UI** (#771), **polling fallback** (#772), **webhook ingestion** (#768) — all downstream slices.

#### 8.1 Forward pointers for future shipping work

- **`/services` sub-barrel split** — when `ShippingModule` grows application services that sibling contexts value-import (vs. type-import), split per the listings #337/#359 pattern: move services + `ShippingModule` to a `/services` sub-barrel (`@openlinker/core/shipping/services`), keep pure contracts (ports, types, exceptions, tokens) on the main barrel, and add a `barrel-purity.spec.ts` regression guard. Not needed today — no services exist yet and no value-import cycle to worry about.
- **`orm-entities` sub-barrel** — if a sibling context ever needs to register `ShipmentOrmEntity` (e.g. an orchestration module wanting cross-context TypeORM `forFeature`), add `libs/core/src/shipping/orm-entities.ts` per the `inventory` / `products` precedent. Plugins and core port files remain ESLint-blocked from importing it.
- **`DuplicateProviderShipmentIdError`** — see R6 for when this should be added.
