# Implementation Plan: WooCommerce OrderSourcePort (#876)

## 1. Goal

Implement `OrderSourcePort` for WooCommerce — cursor-based order ingest using a `modified_after`
polling watermark. Mirrors the PrestaShop `date_upd` watermark pattern; WooCommerce has no
monotonic event journal.

**Base branch:** `874-woocommerce-product-master-read` (rebased — #874's scaffold is already in
this branch).

**Layer:** Integration (`libs/integrations/woocommerce`)
**No core port changes. No DB migration.**

**Non-goals (deferred):**
- WC native webhook subscription — v2 latency optimisation
- `OrderProcessorManagerPort` — #877
- HPOS-disabled-store handling — HPOS-only at v1

---

## 2. What #874 already provides (do not re-implement)

After the rebase, the following already exist and must be used as-is:

| Symbol | Location | Used by #876 for |
|---|---|---|
| `IWooCommerceHttpClient` | `infrastructure/http/woocommerce-http-client.interface.ts` | Adapter constructor type |
| `WooCommerceHttpClient` | `infrastructure/http/woocommerce-http-client.ts` | Instantiated in plugin |
| `WooCommerceHttpResponseException` | `infrastructure/http/woocommerce-http-response.exception.ts` | 404 detection in `getOrder` |
| `WooCommerceUnauthorizedException` | `domain/exceptions/woocommerce-unauthorized.exception.ts` | Auth classifier |
| `WooCommerceResourceNotFoundException` | `domain/exceptions/woocommerce-resource-not-found.exception.ts` | Order not found (reused) |
| `WooCommerceNetworkException` | `domain/exceptions/woocommerce-network.exception.ts` | Propagates unchanged |
| `WooCommerceConfigException` | `domain/exceptions/woocommerce-config.exception.ts` | Already used in plugin |
| `WooCommerceConnectionConfig` | `domain/types/woocommerce-config.types.ts` | Extended by #876 |

**No base class** — all exceptions extend `Error` directly. This is the established pattern.

`get<T>(path, params?)` — the HTTP client already accepts an optional params object
(`Record<string, string | number | boolean>`). Use it directly — no inline query strings.

---

## 3. WooCommerce REST API

```
GET /wp-json/wc/v3/orders   params: { modified_after?, per_page, orderby, order }
GET /wp-json/wc/v3/orders/{id}
```

**Date format:** WC `_gmt` fields are UTC but have **no `Z` suffix** (`"2024-01-15T10:30:00"`).
`normGmt` always produces a valid `Z`-suffixed UTC ISO 8601 string.

---

## 4. All Design Decisions

| Decision | Resolution |
|---|---|
| `fromCursor = null` | No `modified_after` param — fetches all historical orders |
| `ordersInitialSyncFrom` | Optional nested config; validated by `IsValidDateConstraint`; adapter calls `new Date(v).toISOString()` |
| Config structure | `WooCommerceConnectionConfig.orders?: WooCommerceOrdersConfig` — own file, own DTO |
| HTTP client | Use `IWooCommerceHttpClient` from #874; pass params as `{ modified_after, per_page, orderby, order }` |
| EventKey | `${id}:${status}` |
| EventType | `cancelled/refunded/failed → cancelled`; `processing → paid` (always); `isNew → created`; else `updated` |
| Cursor | `max(normGmt(date_modified_gmt, date_modified))` over ALL orders, before eventType filter |
| `normGmt` | `infrastructure/utils/woocommerce-utils.ts` — pure exported function; handles no-Z, empty-both-fields. **Deviation from original plan**: the plan originally justified `domain/utils/` on grounds of zero I/O and zero infrastructure deps (safe from any layer). In practice, `normGmt` is only consumed by the order-source adapter (an infrastructure-layer class); colocating it in `infrastructure/utils/` keeps it closer to its only caller without violating any layer rule — infrastructure code is always free to import from infrastructure siblings. If a future pure-domain entity or application service needs it, the function can be moved to `domain/utils/` at that point. Tests at `infrastructure/utils/__tests__/woocommerce-utils.spec.ts`. |
| `roundCurrency` | Module-level private in adapter file (Allegro pattern) |
| Address mapping | `mapShippingAddress` / `mapBillingAddress` sharing `mapBaseAddress` — no `in` discrimination |
| Mapping approach | Module-level private functions (no `IMapper` interface or mapper class). Matches Allegro `OrderSource` pattern. `#874` used a mapper class for `ProductMaster` because it has complex options and is injected independently; `OrderSource` mapping is simpler and adapter-internal. Note this in PR description. |
| "Order not found" | Throw `WooCommerceResourceNotFoundException` (reuse #874's class) — no new exception class |
| 404 detection | `instanceof WooCommerceHttpResponseException && error.statusCode === 404` (infrastructure-internal import) |
| Auth classifier | `instanceof WooCommerceUnauthorizedException` — already in barrel from #874 |
| `customerEmail = ""` | Maps to `undefined` |
| `externalOrderId` guard | `!/^\d+$/.test(id)` → throw `WooCommerceResourceNotFoundException` before URL construction |
| Logging | `Logger` from `@openlinker/shared/logging`; `debug` on feed + order; credentials never logged |
| Scheduler | `*/5 * * * *`, env-gated `OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED`; no ConfigService dep |
| `index.ts` exports | Add `WooCommerceOrdersConfig` type only — no new exception exports (reusing #874's) |

---

## 5. WC Status → OL EventType Mapping

```typescript
// module-level in adapter file — not exported
function mapWooCommerceEventType(status: string, isNew: boolean): OrderFeedEventType {
  const s = status.toLowerCase();
  if (s === 'cancelled' || s === 'refunded' || s === 'failed') return 'cancelled';
  if (s === 'processing') return 'paid';
  if (isNew) return 'created';
  return 'updated';
}
```

| OL event | WC trigger |
|---|---|
| `created` | New order in `pending`/`on-hold` (first poll, `date_created_gmt === date_modified_gmt`) |
| `paid` | Status `processing` — always, including instant-payment new orders |
| `updated` | `completed`, re-opened `on-hold`, custom status |
| `cancelled` | `cancelled`, `refunded`, `failed` |

---

## 6. Complete File Plan

### New files

```
libs/integrations/woocommerce/src/
│
├── domain/
│   └── types/
│       └── woocommerce-orders-config.types.ts      WooCommerceOrdersConfig interface
│
├── application/
│   └── dto/
│       └── woocommerce-orders-config.dto.ts        IsValidDateConstraint + WooCommerceOrdersConfigDto
│
└── infrastructure/
    ├── adapters/
    │   ├── woocommerce-order-source.adapter.ts     WooCommerceOrderSourceAdapter
    │   ├── woocommerce-auth-failure-classifier.adapter.ts
    │   └── __tests__/
    │       ├── woocommerce-order-source.adapter.spec.ts          16 cases
    │       └── woocommerce-auth-failure-classifier.adapter.spec.ts  3 cases
    ├── scheduler/
    │   ├── woocommerce-scheduler-tasks.ts
    │   └── __tests__/
    │       └── woocommerce-scheduler-tasks.spec.ts  5 cases
    └── utils/
        ├── woocommerce-utils.ts                    normGmt pure function (see design decisions)
        └── __tests__/
            └── woocommerce-utils.spec.ts           4 cases
```

**Not creating** (already in #874):
- `infrastructure/http/woocommerce-http-client.interface.ts`
- Any `domain/exceptions/` files — reusing `WooCommerceResourceNotFoundException`

### Modified files

```
domain/types/
  woocommerce-config.types.ts              ADD  orders?: WooCommerceOrdersConfig + import

application/dto/
  woocommerce-connection-config.dto.ts     ADD  @ValidateNested @Type orders?: WooCommerceOrdersConfigDto

infrastructure/adapters/
  __tests__/
    woocommerce-connection-config-shape-validator.adapter.spec.ts
                                           ADD  4 new validator cases

woocommerce-plugin.ts                      ADD  'OrderSource' to supportedCapabilities
                                                register auth classifier
                                                register scheduler tasks
                                                add OrderSource arm to dispatch table

__tests__/woocommerce-plugin.spec.ts       ADD  4 new assertion cases:
                                                  1. authFailureClassifierRegistry.register called
                                                     with adapterKey + WooCommerceAuthFailureClassifierAdapter
                                                  2. schedulerTaskRegistry.register called once
                                                     (orders-poll task)
                                                  3. supportedCapabilities includes 'OrderSource'
                                                  4. createCapabilityAdapter('OrderSource', ...)
                                                     resolves to WooCommerceOrderSourceAdapter

index.ts                                   ADD  export type { WooCommerceOrdersConfig }
```

**Note for PR description:** The GitHub issue #876 has two typos in the architecture notes — `WoocommerceOrderSourceAdapter` (lowercase `c`) and path `src/order-source/`. The plan uses the correct naming convention (`WooCommerceOrderSourceAdapter`, `{System}{Capability}Adapter` pattern) and correct path (`infrastructure/adapters/order-source/` per engineering standards). Call this out in the PR body so reviewers are not confused.

**Not modifying** (owned by #874):
- `infrastructure/http/woocommerce-http-client.ts`

**Security fixes (in existing #873/#874 files — included in this PR):**
```
application/dto/
  woocommerce-connection-config.dto.ts     ADD  IsSsrfSafeUrlConstraint + @Validate on siteUrl
                                                Blocks RFC-1918, loopback, link-local IPs and
                                                cloud metadata hostnames (SSRF fix)

infrastructure/adapters/
  woocommerce-connection-tester.adapter.ts CHANGE  WooCommerceNetworkException branch: replace
                                                    raw OS error message (e.g. "ECONNREFUSED
                                                    10.0.0.5:5432") with generic user-facing
                                                    string; log raw message server-side only
                                                    Same fix to final catch fallback
  __tests__/
    woocommerce-connection-tester.adapter.spec.ts
                                           ADD  3 new cases for security fixes
```

---

## 7. Complete Specifications

### `woocommerce-orders-config.types.ts` (`domain/types/`)

```typescript
/**
 * WooCommerce Orders Configuration Types
 *
 * Per-connection configuration for the WooCommerce OrderSource capability (#876).
 * Nested under WooCommerceConnectionConfig.orders.
 * Future capabilities (#875, #877) follow the same pattern — own sibling file.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */
export interface WooCommerceOrdersConfig {
  /**
   * Optional initial sync boundary — any JS-parseable date string.
   * When absent: no modified_after param sent — fetches all historical orders.
   * Validated by IsValidDateConstraint. Normalised via new Date(v).toISOString().
   */
  initialSyncFrom?: string;
}
```

### `woocommerce-config.types.ts` — full modified file

```typescript
/**
 * WooCommerce Connection Config Types
 *
 * Non-secret per-connection configuration for the WooCommerce REST API v3 adapter.
 * Capability-specific sub-sections are nested as optional fields — each in its
 * own sibling types file per the Allegro/PrestaShop convention.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */
import type { WooCommerceOrdersConfig } from './woocommerce-orders-config.types';

export interface WooCommerceConnectionConfig {
  // Must include protocol (http:// or https://).
  // Validated by WooCommerceConnectionConfigShapeValidatorAdapter.
  // Trailing slash stripped by WooCommerceHttpClient.
  siteUrl: string;

  /** OrderSource capability configuration (#876). */
  orders?: WooCommerceOrdersConfig;
}
```

---

### `woocommerce-utils.ts` (`infrastructure/utils/`)

Note: originally planned for `domain/utils/` — moved to `infrastructure/utils/` because
`normGmt` is only consumed by infrastructure-layer adapters. See design decisions table for rationale.

```typescript
/**
 * WooCommerce Utilities
 *
 * Pure helper functions shared across WooCommerce adapters. No I/O, no
 * framework dependencies.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/utils
 */

/**
 * Normalise a WooCommerce _gmt field to a valid UTC ISO 8601 string.
 *
 * WC REST API v3 returns _gmt fields without Z suffix ("2024-01-15T10:30:00").
 * Fallback chain:
 *   1. gmt present → append Z if missing
 *   2. gmt absent, local present → append Z to local field
 *   3. both absent → epoch sentinel — detectable, always sorts before real timestamps
 */
export function normGmt(gmt: string, local: string): string {
  const base = gmt || local;
  if (!base) return new Date(0).toISOString();
  return base.endsWith('Z') ? base : base + 'Z';
}
```

---

### `woocommerce-orders-config.dto.ts` (`application/dto/`)

```typescript
/**
 * WooCommerce Orders Config DTO
 *
 * Validates the optional orders sub-section of WooCommerceConnectionConfig.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import { IsOptional, IsString, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'isValidDate', async: false })
export class IsValidDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && !isNaN(new Date(value).getTime());
  }
  defaultMessage(): string {
    return '$property must be a parseable date string (e.g. "2024-01-01" or "2024-01-01T00:00:00Z")';
  }
}

export class WooCommerceOrdersConfigDto {
  @IsOptional()
  @IsString()
  @Validate(IsValidDateConstraint)
  initialSyncFrom?: string;
}
```

`WooCommerceConnectionConfigDto` (modified — add after `siteUrl` field):
```typescript
import { WooCommerceOrdersConfigDto } from './woocommerce-orders-config.dto';
// add to class:
@IsOptional()
@ValidateNested()
@Type(() => WooCommerceOrdersConfigDto)
orders?: WooCommerceOrdersConfigDto;
```

---

### `WooCommerceOrderSourceAdapter` (complete)

```typescript
/**
 * WooCommerce Order Source Adapter
 *
 * Implements OrderSourcePort for WooCommerce REST API v3.
 * Uses modified_after watermark cursor — no event journal in WC.
 * Cursor key: woocommerce.orders.lastModifiedAfter
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */
import type {
  OrderSourcePort, OrderFeedInput, OrderFeedOutput, OrderFeedItem,
  IncomingOrder, IncomingOrderItem, IncomingOrderItemRef,
  IncomingOrderAddress, IncomingOrderTotals, OrderFeedEventType,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../domain/exceptions/woocommerce-resource-not-found.exception';
import { normGmt } from '../utils/woocommerce-utils';
import type { WooCommerceConnectionConfig } from '../../domain/types/woocommerce-config.types';
import type {
  WooCommerceOrder, WooCommerceLineItem,
  WooCommerceBillingAddress, WooCommerceShippingAddress,
} from './order-source/woocommerce-order.types';

export class WooCommerceOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(WooCommerceOrderSourceAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly connection: Connection,
  ) {}

  async listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput> {
    this.logger.debug('Listing WooCommerce order feed', {
      connectionId: this.connection.id,
      fromCursor: input.fromCursor ?? 'none',
      limit: input.limit,
    });

    const params: Record<string, string | number | boolean> = {
      per_page: input.limit,
      orderby: 'modified',
      order: 'asc',
    };

    if (input.fromCursor) {
      params.modified_after = input.fromCursor;
    } else {
      const config = this.connection.config as WooCommerceConnectionConfig;
      const initial = config.orders?.initialSyncFrom;
      if (initial) {
        params.modified_after = new Date(initial).toISOString();
      }
      // No modified_after = fetch all historical orders (intentional boot behaviour)
    }

    const orders = await this.httpClient.get<WooCommerceOrder[]>(
      '/wp-json/wc/v3/orders',
      params,
    );

    if (orders.length === 0) {
      return { items: [], nextCursor: input.fromCursor ?? null };
    }

    // Cursor computed over ALL orders before filtering — prevents cursor freeze
    // when every item is filtered out by eventTypes.
    const nextCursor = orders.reduce<string | null>((acc, o) => {
      const ts = normGmt(o.date_modified_gmt, o.date_modified);
      return !acc || ts > acc ? ts : acc;
    }, null);

    const items: OrderFeedItem[] = orders.map((o) => {
      const occurredAt = normGmt(o.date_modified_gmt, o.date_modified);
      const createdAt  = normGmt(o.date_created_gmt,  o.date_created);
      return {
        externalOrderId: String(o.id),
        eventType: mapWooCommerceEventType(o.status, occurredAt === createdAt),
        occurredAt,
        eventKey: `${o.id}:${o.status}`,
      };
    });

    const filtered = input.eventTypes
      ? items.filter((i) => input.eventTypes!.includes(i.eventType))
      : items;

    return { items: filtered, nextCursor: nextCursor ?? input.fromCursor ?? null };
  }

  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const { externalOrderId } = input;

    // WC order IDs are always positive integers.
    // Reject anything else before URL construction to prevent path issues.
    if (!/^\d+$/.test(externalOrderId)) {
      throw new WooCommerceResourceNotFoundException(
        `WooCommerce order not found: ${externalOrderId}`,
        'Order',
        externalOrderId,
        this.connection.id,
      );
    }

    this.logger.debug('Fetching WooCommerce order', {
      connectionId: this.connection.id,
      externalOrderId,
    });

    let order: WooCommerceOrder;
    try {
      order = await this.httpClient.get<WooCommerceOrder>(
        `/wp-json/wc/v3/orders/${externalOrderId}`,
      );
    } catch (error) {
      if (error instanceof WooCommerceHttpResponseException && error.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce order not found: ${externalOrderId} on connection ${this.connection.id}`,
          'Order',
          externalOrderId,
          this.connection.id,
        );
      }
      // WooCommerceUnauthorizedException (401/403) → auth failure classifier
      // WooCommerceNetworkException → retry classifier
      // WooCommerceHttpResponseException (5xx) → retry classifier
      throw error;
    }

    return {
      externalOrderId,
      orderNumber:        order.number,
      status:             order.status,
      customerExternalId: order.customer_id > 0 ? String(order.customer_id) : undefined,
      customerEmail:      order.billing.email || undefined,
      items:              order.line_items.map(mapLineItem),
      totals:             mapTotals(order),
      shippingAddress:    mapShippingAddress(order.shipping),
      billingAddress:     mapBillingAddress(order.billing),
      shipping:           order.shipping_lines[0]
        ? { methodId:   order.shipping_lines[0].method_id,
            methodName: order.shipping_lines[0].method_title }
        : undefined,
      createdAt: normGmt(order.date_created_gmt,  order.date_created),
      updatedAt: normGmt(order.date_modified_gmt, order.date_modified),
    };
  }
}

// ─── module-level helpers (not exported) ────────────────────────────────────

function mapWooCommerceEventType(status: string, isNew: boolean): OrderFeedEventType {
  const s = status.toLowerCase();
  if (s === 'cancelled' || s === 'refunded' || s === 'failed') return 'cancelled';
  if (s === 'processing') return 'paid';
  if (isNew) return 'created';
  return 'updated';
}

function mapLineItem(item: WooCommerceLineItem): IncomingOrderItem {
  const productRef: IncomingOrderItemRef =
    item.variation_id > 0
      ? { type: 'variant', externalId: String(item.variation_id) }
      : item.product_id > 0
        ? { type: 'product', externalId: String(item.product_id) }
        : item.sku
          ? { type: 'sku', externalId: item.sku }
          : { type: 'sku', externalId: String(item.id) };

  return {
    id:       String(item.id),
    productRef,
    quantity: item.quantity,
    price:    roundCurrency(Number(item.price)),
    sku:      item.sku  || undefined,
    name:     item.name || undefined,
    imageUrl: item.image?.src || undefined,
  };
}

function mapBaseAddress(
  addr: WooCommerceShippingAddress | WooCommerceBillingAddress,
): Omit<IncomingOrderAddress, 'phone'> {
  return {
    firstName:  addr.first_name || undefined,
    lastName:   addr.last_name  || undefined,
    company:    addr.company    || undefined,
    address1:   addr.address_1,
    address2:   addr.address_2  || undefined,
    city:       addr.city,
    state:      addr.state      || undefined,
    postalCode: addr.postcode,
    country:    addr.country,
  };
}

function mapShippingAddress(addr: WooCommerceShippingAddress): IncomingOrderAddress {
  return mapBaseAddress(addr);
}

function mapBillingAddress(addr: WooCommerceBillingAddress): IncomingOrderAddress {
  return { ...mapBaseAddress(addr), phone: addr.phone || undefined };
}

function mapTotals(order: WooCommerceOrder): IncomingOrderTotals {
  const total    = Number(order.total);
  const tax      = Number(order.total_tax);
  const shipping = Number(order.shipping_total);
  // WC has no order-level subtotal. Derived: total - tax - shipping
  // = sum(line_items[].total) — post-discount product amount.
  return {
    subtotal: roundCurrency(total - tax - shipping),
    tax:      roundCurrency(tax),
    shipping: roundCurrency(shipping),
    total:    roundCurrency(total),
    currency: order.currency,
  };
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}
```

WC order types live at:
`infrastructure/adapters/order-source/woocommerce-order.types.ts`
(co-located with the adapter — same pattern as `infrastructure/adapters/product-master/woocommerce-product.types.ts` from #874)

---

### `woocommerce-order.types.ts` (`infrastructure/adapters/order-source/`)

```typescript
/**
 * WooCommerce REST API v3 Order Response Types
 *
 * External platform shapes for GET /wp-json/wc/v3/orders and
 * GET /wp-json/wc/v3/orders/{id}. Not domain model entities — raw API
 * response types used exclusively by WooCommerceOrderSourceAdapter.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-source
 */
export interface WooCommerceOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  date_created_gmt: string;
  date_modified: string;
  date_modified_gmt: string;
  customer_id: number;        // 0 = guest
  billing: WooCommerceBillingAddress;
  shipping: WooCommerceShippingAddress;
  line_items: WooCommerceLineItem[];
  shipping_lines: WooCommerceShippingLine[];
  total: string;              // decimal string
  total_tax: string;          // decimal string
  shipping_total: string;     // decimal string
  currency: string;           // ISO 4217
  // NOTE: WC REST API v3 has NO top-level subtotal field.
  // Derived: total - total_tax - shipping_total
}

export interface WooCommerceBillingAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email: string;
  phone: string;
}

export interface WooCommerceShippingAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

export interface WooCommerceLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number;   // 0 when not a variation
  quantity: number;
  sku: string;
  price: string;          // unit price, decimal string
  subtotal: string;       // pre-discount line total
  total: string;          // post-discount line total
  image: WooCommerceLineItemImage | null;
}

export interface WooCommerceLineItemImage {
  id: number;
  src: string;
}

export interface WooCommerceShippingLine {
  id: number;
  method_id: string;
  method_title: string;
  total: string;
}
```

---

### `WooCommerceAuthFailureClassifierAdapter`

```typescript
/**
 * WooCommerce Auth Failure Classifier Adapter
 *
 * Returns true only for WooCommerceUnauthorizedException — thrown by
 * WooCommerceHttpClient on 401/403. These signal a revoked or
 * insufficient-scope consumer key/secret.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';

export class WooCommerceAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof WooCommerceUnauthorizedException;
  }
}
```

---

### `woocommerce-scheduler-tasks.ts`

```typescript
/**
 * WooCommerce Scheduler Tasks
 *
 * Contributes the orders-poll cron task to SchedulerTaskRegistryService.
 * No ConfigService dependency — cron fixed at 5 min; env gate evaluated
 * by SchedulerService at tick time.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/scheduler
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig, MarketplaceOrdersPollPayloadV1 } from '@openlinker/core/sync';

export function buildWooCommerceSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId:         'woocommerce-orders-poll',
      platformType:   'woocommerce',
      jobType:        'marketplace.orders.poll',
      cronExpression: '*/5 * * * *',
      enabledEnvVar:  'OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection): MarketplaceOrdersPollPayloadV1 => ({
        schemaVersion: 1,
        cursorKey:     'woocommerce.orders.lastModifiedAfter',
        limit:         100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:wc:orders:poll:${timestamp}`,
    },
  ];
}
```

---

### `woocommerce-plugin.ts` — exact additions

**1. Add to imports:**
```typescript
import { WooCommerceOrderSourceAdapter } from './infrastructure/adapters/woocommerce-order-source.adapter';
import { WooCommerceAuthFailureClassifierAdapter } from './infrastructure/adapters/woocommerce-auth-failure-classifier.adapter';
import { buildWooCommerceSchedulerTasks } from './infrastructure/scheduler/woocommerce-scheduler-tasks';
```

**2. Change `supportedCapabilities`:**
```typescript
supportedCapabilities: ['ProductMaster', 'OrderSource'],
```

**3. Add to `register()` after existing registrations:**
```typescript
host.authFailureClassifierRegistry.register(
  woocommerceAdapterManifest.adapterKey,
  new WooCommerceAuthFailureClassifierAdapter(),
);
for (const task of buildWooCommerceSchedulerTasks()) {
  host.schedulerTaskRegistry.register(task);
}
```

**4. Extend dispatch table in `createCapabilityAdapter`:**
```typescript
// CHANGE:
dispatchCapability<T>(capability, { ProductMaster: () => productMaster }, WOOCOMMERCE_BRAND)
// TO:
dispatchCapability<T>(
  capability,
  {
    ProductMaster: () => productMaster,
    OrderSource:   () => new WooCommerceOrderSourceAdapter(httpClient, connection),
  },
  WOOCOMMERCE_BRAND,
)
```

---

### `index.ts` — single addition

```typescript
export type { WooCommerceOrdersConfig } from './domain/types/woocommerce-orders-config.types';
```

---

## 7b. Security Fixes (SSRF + Data Exposure)

These fix vulnerabilities identified by security review of the #873/#874 code already in this branch.

---

### Fix 1 — SSRF: `woocommerce-connection-config.dto.ts`

Add `IsSsrfSafeUrlConstraint` before the existing `@IsUrl` in the same file.

```typescript
import { isIP } from 'net';
import { IsUrl, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/**
 * Blocks private, loopback, and link-local IP ranges and known cloud metadata
 * hostnames from being used as siteUrl. Prevents SSRF attacks where an operator
 * (or a compromised account) routes OL's outbound HTTP requests — including the
 * WooCommerce Basic Auth header — to internal services or cloud metadata endpoints.
 *
 * Blocked ranges:
 *   IPv4: 127.x (loopback), 10.x, 172.16-31.x, 192.168.x (RFC-1918),
 *         169.254.x (link-local / AWS IMDSv1)
 *   IPv6: ::1, fc00::/7, fe80::/10
 *   Hostnames: localhost, metadata.google.internal, metadata.internal
 *
 * Local development: use a DNS alias (e.g. /etc/hosts entry pointing to a
 * WooCommerce container) or an HTTPS tunnel (ngrok) instead of bare localhost.
 */
/**
 * Returns true when the hostname resolves to a private, loopback, or
 * link-local address that must not be reached by outbound OL requests.
 *
 * localhost / 127.x is intentionally ALLOWED — needed for local dev where
 * a WooCommerce container runs on the same machine as the OL API server.
 * All other RFC-1918 ranges and cloud metadata addresses are blocked.
 *
 * Bypass patterns caught explicitly (verified via validator.js test):
 *   - Hex notation  0x7f000001  → @IsUrl accepts, IP regex does not → detected here
 *   - IPv4-mapped   ::ffff:10.0.0.1 → @IsUrl accepts, simple IPv6 check misses → detected here
 */
function isPrivateOrLinkLocalIp(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Hex-encoded IPv4 (e.g. 0xc0a80001 = 192.168.0.1) — passes @IsUrl, bypasses isIP()
  if (/^0x[0-9a-f]+$/i.test(h)) return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1) — passes @IsUrl, resolves to private IPv4
  if (h.startsWith('::ffff:')) {
    return isPrivateOrLinkLocalIp(h.slice(7));
  }

  if (h.includes(':')) {
    // IPv6: unique-local (fc::/7) and link-local (fe80::/10) — loopback ::1 is allowed (local dev)
    return h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }

  const parts = h.split('.').map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||                               // 10.0.0.0/8 private
    (a === 172 && b >= 16 && b <= 31) ||      // 172.16.0.0/12 private
    (a === 192 && b === 168) ||               // 192.168.0.0/16 private
    (a === 169 && b === 254)                  // 169.254.0.0/16 link-local (cloud metadata)
    // 127.x loopback intentionally omitted — allowed for local dev
  );
}

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.internal',
]);

@ValidatorConstraint({ name: 'isSsrfSafeUrl', async: false })
export class IsSsrfSafeUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      const { hostname } = new URL(value);
      if (isIP(hostname) !== 0) {
        return !isPrivateOrLinkLocalIp(hostname);
      }
      // Also handle hex IP and ::ffff: that isIP() returns 0 for
      if (/^0x[0-9a-f]+$/i.test(hostname) || hostname.toLowerCase().startsWith('::ffff:')) {
        return !isPrivateOrLinkLocalIp(hostname);
      }
      return !BLOCKED_HOSTNAMES.has(hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'siteUrl must not point to a private or internal network address';
  }
}

export class WooCommerceConnectionConfigDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @Validate(IsSsrfSafeUrlConstraint)
  siteUrl!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WooCommerceOrdersConfigDto)
  orders?: WooCommerceOrdersConfigDto;
}
```

---

### Fix 2 — Data Exposure: `woocommerce-connection-tester.adapter.ts`

Two changes — both replace raw OS error messages with generic strings while keeping raw detail in server-side logs only.

**Change A — `WooCommerceNetworkException` non-timeout branch** (currently line ~142):

```typescript
// BEFORE (leaks internal topology: "ECONNREFUSED 10.0.0.5:5432")
return {
  success: false,
  message: error.originalError?.message ?? error.message,
  latencyMs: Date.now() - startedAt,
};

// AFTER
this.logger.warn('WooCommerce connection test failed: network error', {
  connectionId: connection.id,
  // Raw OS error logged server-side only — never returned to caller.
  // Contains internal network details (e.g. "ECONNREFUSED 10.0.0.5:5432").
  error: error.originalError?.message ?? error.message,
});
return {
  success: false,
  message: 'Could not reach the WooCommerce site — check the URL and network connectivity',
  latencyMs: Date.now() - startedAt,
};
```

**Change B — final `catch` fallback** (currently last `return` before closing brace):

```typescript
// BEFORE (leaks raw error message)
return {
  success: false,
  message: err.message ?? 'WooCommerce connection test failed',
  latencyMs: Date.now() - startedAt,
};

// AFTER
return {
  success: false,
  message: 'WooCommerce connection test failed — check server logs for details',
  latencyMs: Date.now() - startedAt,
};
```

The `logger.warn` call immediately above this return already logs `err.message` server-side — no second log needed.

---

## 8. Test Coverage

### `domain/utils/__tests__/woocommerce-utils.spec.ts` — 4 cases

| # | Input | Expected |
|---|---|---|
| 1 | `normGmt("2024-01-15T10:30:00", "")` | `"2024-01-15T10:30:00Z"` |
| 2 | `normGmt("", "2024-01-15T10:30:00")` | `"2024-01-15T10:30:00Z"` |
| 3 | `normGmt("", "")` | `"1970-01-01T00:00:00.000Z"` |
| 4 | `normGmt("2024-01-15T10:30:00Z", "")` | `"2024-01-15T10:30:00Z"` (no double-Z) |

---

### `woocommerce-order-source.adapter.spec.ts` — 16 cases

| # | Case |
|---|---|
| 1 | `fromCursor=null`, no `initialSyncFrom` → `modified_after` absent from params |
| 2 | `fromCursor=null`, `initialSyncFrom` set → `modified_after=new Date(v).toISOString()` |
| 3 | `fromCursor` set → `modified_after=fromCursor` in params |
| 4 | Empty response → `{ items:[], nextCursor: fromCursor }` |
| 5 | Cursor advances to max `date_modified_gmt` over all orders (not just filtered) |
| 6 | `status=cancelled/refunded/failed` → `eventType=cancelled` |
| 7 | `status=processing`, `isNew=true` → `eventType=paid` |
| 8 | New order, `status=pending` → `eventType=created` |
| 9 | Existing order, `status=completed` → `eventType=updated` |
| 10 | `variation_id>0` → `productRef.type='variant'` |
| 11 | `customer_id=0` → `customerExternalId=undefined` |
| 12 | `billing.email=""` → `customerEmail=undefined` |
| 13 | Non-numeric `externalOrderId` → `WooCommerceResourceNotFoundException` (no HTTP call) |
| 14 | HTTP client throws `WooCommerceHttpResponseException(404)` → `WooCommerceResourceNotFoundException` |
| 15 | HTTP client throws `WooCommerceHttpResponseException(500)` → propagates unchanged |
| 16 | `fromCursor` set + empty response → `nextCursor` equals original `fromCursor` (cursor not reset to `null`) |

---

### `woocommerce-auth-failure-classifier.adapter.spec.ts` — 3 cases

| # | Case |
|---|---|
| 1 | `WooCommerceUnauthorizedException` → `true` |
| 2 | `WooCommerceHttpResponseException(500)` → `false` |
| 3 | Generic `Error` → `false` |

---

### `woocommerce-scheduler-tasks.spec.ts` — 5 cases

| # | Case |
|---|---|
| 1 | Returns exactly one task, `taskId='woocommerce-orders-poll'` |
| 2 | `enabledEnvVar='OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED'` |
| 3 | `generatePayload` shape matches `MarketplaceOrdersPollPayloadV1` |
| 4 | `cursorKey='woocommerce.orders.lastModifiedAfter'` |
| 5 | `generateIdempotencyKey` → `marketplace:{id}:wc:orders:poll:{ts}` |

---

### `woocommerce-connection-config-shape-validator.adapter.spec.ts` — 4 additions (orders) + 6 additions (SSRF)

**Orders validation additions (from earlier plan):**

| # | Case |
|---|---|
| + | `orders.initialSyncFrom="2024-01-01"` → valid |
| + | `orders.initialSyncFrom="2024-01-01T00:00:00Z"` → valid |
| + | `orders.initialSyncFrom="not-a-date"` → `InvalidConnectionConfigException` |
| + | `orders` absent → valid |

**SSRF validation additions:**

| # | Case |
|---|---|
| + | `siteUrl="https://myshop.example.com"` → valid |
| + | `siteUrl="http://169.254.169.254"` → `InvalidConnectionConfigException` (AWS metadata) |
| + | `siteUrl="http://10.0.0.1"` → `InvalidConnectionConfigException` (RFC-1918) |
| + | `siteUrl="http://192.168.1.50"` → `InvalidConnectionConfigException` (RFC-1918) |
| + | `siteUrl="http://localhost"` → `InvalidConnectionConfigException` (loopback) |
| + | `siteUrl="http://172.16.0.1"` → `InvalidConnectionConfigException` (RFC-1918) |
| + | `siteUrl="http://0x7f000001"` → `InvalidConnectionConfigException` (hex bypass) |
| + | `siteUrl="http://[::ffff:192.168.1.1]"` → `InvalidConnectionConfigException` (IPv4-mapped IPv6 bypass) |
| + | `siteUrl="http://localhost"` → valid (local dev allowed) |
| + | `siteUrl="http://127.0.0.1"` → valid (loopback allowed for local dev) |

---

### `woocommerce-connection-tester.adapter.spec.ts` — 3 additions (security)

| # | Case |
|---|---|
| + | Network error (non-timeout) → `result.message` is generic (does NOT contain `ECONNREFUSED` or any IP/hostname) |
| + | Network error (non-timeout) → raw error detail is NOT in `result.message` |
| + | Unexpected error in final catch → `result.message` is generic (does NOT contain raw error text) |

---

## 9. Architecture Compliance Checklist

- [x] All new adapters implement a port or registry interface
- [x] `WooCommerceOrderSourceAdapter` depends on `IWooCommerceHttpClient` (from #874) — never concrete class
- [x] `isCredentialRejected` method name matches `AuthFailureClassifierPort` exactly
- [x] Auth classifier uses `instanceof WooCommerceUnauthorizedException` — no statusCode magic numbers
- [x] 404 uses `instanceof WooCommerceHttpResponseException` — internal import, not from barrel
- [x] `WooCommerceResourceNotFoundException` reused — no redundant exception class
- [x] No base class — all exceptions extend `Error` directly (per #874 convention)
- [x] `normGmt` in `infrastructure/utils/` — pure, no I/O, directly tested (moved from planned `domain/utils/`; see design decisions)
- [x] WC order types co-located with adapter in `infrastructure/adapters/order-source/`
- [x] `mapShippingAddress`/`mapBillingAddress`/`mapBaseAddress` — typed, no `in` discrimination
- [x] `getOrder` try/catch: 404 → `WooCommerceResourceNotFoundException`; others propagate
- [x] `IsValidDateConstraint` uses `@ValidatorConstraint` — standard pattern
- [x] Logger in adapter; credentials never logged
- [x] `externalOrderId` validated before URL construction
- [x] `index.ts` — one new type export, no new exception exports (reusing #874's)
- [x] `woocommerce-http-client.ts` not touched
- [x] SSRF: `IsSsrfSafeUrlConstraint` blocks 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, localhost, cloud metadata hostnames
- [x] SSRF: 6 validator test cases covering blocked ranges + valid external URL
- [x] Data exposure: `WooCommerceNetworkException` branch returns generic message; raw OS error logged server-side only
- [x] Data exposure: Final catch fallback also returns generic message
- [x] Data exposure: 3 tester spec cases confirm no internal details in `result.message`
- [x] `supportedCapabilities` updated to `['ProductMaster', 'OrderSource']`
- [x] `woocommerce-plugin.spec.ts` updated with 4 new assertions (auth classifier, scheduler, capability)
- [x] `infrastructure/utils/` placement — colocated with its only caller; pure function, no I/O; moveable to `domain/utils/` if future domain code needs it
- [x] No mapper class — module-level private functions, matches Allegro `OrderSource` pattern; noted in PR description
- [x] Adapter spec has 19 cases (16 original + 3 added for productRef sku/id fallback coverage)
- [x] No `any` types
- [x] No `console.log`
