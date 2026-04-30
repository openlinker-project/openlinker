# Implementation Plan — #454 + #457: Allegro shipping cost + delivery address

## Goal

Stop two silent corruptions on every Allegro→PrestaShop order:

1. **#454** — Allegro orders land with `total_shipping = 0` and PS flags `Payment error: €X.XX paid instead of €Y.YY` because we read `summary.totalToPay` as both `subtotal` and `total`, dropping shipping cost on the floor.
2. **#457** — Shipping address comes from `buyer.address` (the buyer's profile address) instead of `delivery.address` (the actual checkout-time ship-to). Parcels go to the wrong place when buyers ship to a different address than their profile.

Both root-cause through the same missing piece: `AllegroCheckoutForm.delivery` is not modelled in our types. Fixing the type unblocks both fixes in the same file (`AllegroOrderSourceAdapter.getOrder`).

## Layer classification

- **Integration** — Allegro adapter only. `AllegroCheckoutForm` type + adapter mapping.
- No core changes (`IncomingOrder.totals.shipping` and `IncomingOrderAddress` already exist).
- No schema changes, no migration.
- No FE changes.

## Non-goals

Per the issue bodies, these stay out of scope and are tracked separately:

- **#455** — carrier mapping (Allegro `delivery.method` → PS `id_carrier`). Has an unresolved Option 1 vs 2 design decision.
- **#458** — pickup-point forwarding for InPost lockers. Has an unresolved Option 1/2/3 design decision.
- Shipping VAT split — Allegro doesn't expose shipping VAT separately on checkout-form; revisit if/when it does.
- Mapping by name fallback when `delivery.method.id` is absent.

The `delivery` type added by #454 is **fully shaped** (includes `method`, `pickupPoint`, etc.) so #455 and #458 don't need to re-extend it later — only the adapter's *use* of those fields stays out of scope here.

## Design

### Single change to `AllegroCheckoutForm` type

Extend the existing interface in `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` with an optional `delivery?` block matching the Allegro swagger `CheckoutFormDeliveryReference`. The full shape is typed proactively so #455 and #458 don't need to re-edit the interface — but **the adapter in this PR consumes only `cost` and `address`**. The other fields (`method`, `pickupPoint`, `smart`) are typed for downstream PRs and ignored here:

```typescript
delivery?: {
  /** #455 — carrier mapping consumes `method.id`. Ignored in this PR. */
  method?: { id: string; name?: string };
  /** #454 — this PR uses `cost.amount` for shipping totals. */
  cost?: { amount: string; currency: string };
  /** #457 — this PR prefers `address` over `buyer.address` for shippingAddress. */
  address?: {
    firstName?: string;
    lastName?: string;
    street?: string;
    city?: string;
    zipCode?: string;
    countryCode?: string;
    companyName?: string;
    phoneNumber?: string;
  };
  /** #458 — pickup-point forwarding consumes this. Ignored in this PR. */
  pickupPoint?: {
    id: string;
    name?: string;
    description?: string;
    address?: {
      street?: string;
      zipCode?: string;
      city?: string;
      countryCode?: string;
    };
  };
  /** Future use (Smart! free-delivery flag). Ignored in this PR. */
  smart?: boolean;
};
```

All fields are optional because Allegro doesn't always populate every sub-field (pickup-only orders skip `cost`; cash-pickup orders may skip `address`; non-pickup-point orders skip `pickupPoint`).

### `AllegroOrderSourceAdapter.getOrder` — two surgical changes

**Change 1 (#454): recompute totals.**

Today (`allegro-order-source.adapter.ts:169-175`):

```typescript
totals: {
  subtotal: parseFloat(checkoutForm.summary.totalToPay.amount), // ❌ includes shipping
  tax: 0,
  shipping: 0,                                                  // ❌ always 0
  total: parseFloat(checkoutForm.summary.totalToPay.amount),
  currency: checkoutForm.summary.totalToPay.currency,
},
```

After:

```typescript
const subtotal = checkoutForm.lineItems.reduce(
  (acc, item) => acc + parseFloat(item.price.amount) * item.quantity,
  0,
);
const total = parseFloat(checkoutForm.summary.totalToPay.amount);
const shipping = checkoutForm.delivery?.cost
  ? parseFloat(checkoutForm.delivery.cost.amount)
  : Math.max(0, total - subtotal); // defensive fallback for malformed responses

totals: {
  subtotal: roundCurrency(subtotal),
  tax: 0,
  shipping: roundCurrency(shipping),
  total: roundCurrency(total),
  currency: checkoutForm.summary.totalToPay.currency,
},
```

`roundCurrency(n)` = `Math.round(n * 100) / 100` — Allegro returns string-decimal amounts, our totals are `number`; rounding once at construction prevents float-drift.

**Change 2 (#457): prefer `delivery.address` for `shippingAddress`.**

Today (`allegro-order-source.adapter.ts:176-186`):

```typescript
shippingAddress: checkoutForm.buyer.address
  ? {
      firstName: checkoutForm.buyer.firstName,
      lastName: checkoutForm.buyer.lastName,
      address1: checkoutForm.buyer.address.street ?? '',
      city: checkoutForm.buyer.address.city ?? '',
      postalCode: checkoutForm.buyer.address.zipCode ?? '',
      country: checkoutForm.buyer.address.countryCode ?? '',
      phone: checkoutForm.buyer.phoneNumber,
    }
  : undefined,
```

After: prefer `delivery.address` if it has at least one populated field, fall back to `buyer.address` otherwise. Each branch sources name + phone from the corresponding side (delivery uses `delivery.address.firstName/lastName/phoneNumber`; buyer fallback uses `buyer.firstName/lastName/phoneNumber`). Log at `debug` which source was used.

The empty-`{}`-guard matters: Allegro can return `delivery.address: {}` on pickup-point orders where the parcel goes to the locker (the locker address is on `delivery.pickupPoint`, not `delivery.address`). Without the guard, we'd emit `address1: '', city: '', postalCode: '', country: ''` — worse than today's `buyer.address` fallback. Pickup-point address resolution is #458's scope; until that ships, pickup-only orders should keep using `buyer.address`.

```typescript
const shippingAddress = this.resolveShippingAddress(checkoutForm);
// ...
private resolveShippingAddress(checkoutForm: AllegroCheckoutForm): IncomingOrderAddress | undefined {
  const deliveryAddr = checkoutForm.delivery?.address;
  // Reject empty `delivery.address: {}` — happens on pickup-point orders.
  // Treat any of street/city/zipCode being non-empty as "real address present."
  const hasDeliveryAddress = Boolean(
    deliveryAddr && (deliveryAddr.street || deliveryAddr.city || deliveryAddr.zipCode),
  );

  if (hasDeliveryAddress && deliveryAddr) {
    this.logger.debug(
      `Using delivery.address as shippingAddress for ${checkoutForm.id} (connection: ${this.connectionId})`,
    );
    return {
      firstName: deliveryAddr.firstName,
      lastName: deliveryAddr.lastName,
      company: deliveryAddr.companyName,
      address1: deliveryAddr.street ?? '',
      city: deliveryAddr.city ?? '',
      postalCode: deliveryAddr.zipCode ?? '',
      country: deliveryAddr.countryCode ?? '',
      phone: deliveryAddr.phoneNumber,
    };
  }
  if (checkoutForm.buyer.address) {
    this.logger.debug(
      `Using buyer.address as shippingAddress fallback for ${checkoutForm.id} (connection: ${this.connectionId})`,
    );
    return {
      firstName: checkoutForm.buyer.firstName,
      lastName: checkoutForm.buyer.lastName,
      address1: checkoutForm.buyer.address.street ?? '',
      city: checkoutForm.buyer.address.city ?? '',
      postalCode: checkoutForm.buyer.address.zipCode ?? '',
      country: checkoutForm.buyer.address.countryCode ?? '',
      phone: checkoutForm.buyer.phoneNumber,
    };
  }
  return undefined;
}
```

Extracting to a private helper keeps `getOrder` readable now that it has a non-trivial branch.

### Why `IncomingOrderAddress.company` is the right home for `companyName`

`IncomingOrderAddress.company?: string` already exists on the core type. Allegro's `delivery.address.companyName` semantically matches — it's a buyer-supplied company name on the shipping address (e.g. for B2B orders shipping to a company). The PrestaShop side uses it via the address-provisioner's mapping; no PS-side change needed.

### Defensive subtotal fallback — why

The plan computes `shipping = total - subtotal` when `delivery.cost` is absent. This is defensive against:

- Pickup-only orders that omit `cost` but still have `totalToPay > subtotal` (rare).
- Malformed/partial responses during sandbox repros.
- Future Allegro response variants we haven't seen.

`Math.max(0, …)` prevents a negative shipping if some discount path produces `subtotal > totalToPay`. In that case we leave `shipping = 0` and `subtotal` accurate — the sum is internally consistent for PS.

## Files

| File | Action | Notes |
|---|---|---|
| `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | extend | add `delivery?` block to `AllegroCheckoutForm` matching swagger `CheckoutFormDeliveryReference` |
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts` | edit | recompute totals (lineItem-based subtotal + delivery.cost shipping); resolve shipping address via new private helper |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts` | extend | add 5 new test cases (see below); update existing `should hydrate a full IncomingOrder` to assert the new totals shape (split subtotal/shipping) since the existing fixture has no shipping cost — verify it still produces `subtotal=39.98, shipping=0` |

## Step-by-step

### Step 1 — extend the `AllegroCheckoutForm` type
- Add `delivery?` to the interface.
- Use full shape (method, cost, address, pickupPoint, smart) so #455/#458 don't need to re-edit it.
- **AC**: `pnpm --filter @openlinker/integrations-allegro type-check` passes.

### Step 2 — recompute totals (#454)
- Replace the `totals` block in `getOrder` with line-item-derived `subtotal` + `delivery.cost`-derived `shipping` + `total - subtotal` defensive fallback.
- Add a small `roundCurrency(n)` helper local to the file.
- **AC**: existing tests still pass; new totals tests (Step 4) cover all branches.

### Step 3 — refactor shipping-address resolution (#457)
- Extract a private `resolveShippingAddress(checkoutForm)` method.
- Branch order: `delivery.address` → `buyer.address` → `undefined`.
- Source `firstName`, `lastName`, `phone`, and (new) `company` from the same side as the address itself in each branch.
- `debug` log indicates which source was used.
- **AC**: existing `should hydrate a full IncomingOrder` test continues to pass with `buyer.address`-only fixture.

### Step 4 — add the new test cases
1. `should compute subtotal and shipping correctly when delivery.cost is present` — fixture with 1 × €10 line item, `delivery.cost: '12.49'`, `totalToPay: '22.49'` → `{ subtotal: 10, shipping: 12.49, total: 22.49 }`.
2. `should fall back to total - subtotal when delivery.cost is absent` — same fixture without `delivery.cost` → `shipping: 12.49`.
3. `should clamp shipping to 0 when subtotal exceeds total (defensive)` — fixture where `lineItems` sum is 50 but `totalToPay: 30` → `shipping: 0`, `subtotal: 50`, `total: 30`.
4. `should report shipping=0 when delivery.cost is explicitly 0.00 (free delivery)` — fixture with 1 × €10 line item, `delivery.cost: { amount: '0.00' }`, `totalToPay: '10.00'` → `{ subtotal: 10, shipping: 0, total: 10 }`. Catches a regression where someone replaces the ternary with `||` and `'0.00'` falls through to the `total - subtotal` fallback (which would also yield 0 here, but on a different code path — the assertion locks in the right *path*).
5. `should prefer delivery.address over buyer.address for shippingAddress` — both set, different cities → `shippingAddress.city` is the delivery one; firstName / lastName / phone / company sourced from `delivery.address` consistently.
6. `should fall back to buyer.address when delivery.address is undefined` — only `buyer.address` set → behaviour unchanged from today.
7. `should fall back to buyer.address when delivery.address is an empty object` — `delivery: { address: {} }` (pickup-point order) plus `buyer.address` populated → emits `buyer.address`, not the empty object. Verifies the empty-guard introduced in Step 3.
- Existing `should hydrate a full IncomingOrder` test: update its assertion to the split-totals shape. The current fixture is `2 × €19.99`, `totalToPay: '39.98'`, no `delivery.cost` — so the new assertion is `{ subtotal: 39.98, shipping: 0, total: 39.98 }`. Confirms internally-consistent totals when no shipping is in the picture.
- **AC**: all 7 new/updated cases pass; no regressions in any other Allegro adapter test.

### Step 5 — quality gate + self-review
- `pnpm lint && pnpm type-check && pnpm test`.
- Self-review per `docs/code-review-guide.md`. Fix BLOCKING / IMPORTANT.

## Validation

- **Hexagonal layering**: change is purely in `libs/integrations/allegro/src/` — no core surface changes. `IncomingOrder` shape already supports `shipping`, `company`, etc. No new ports or services.
- **Naming**: type extension on existing interface; private method on adapter — no new public class. Conventions unchanged.
- **No migration**: schema-stable. JSONB-stored `OrderRecord.orderSnapshot` is forward-compatible (it stores whatever the adapter emits).
- **Security**: no new auth surface. Address fields are PII and respect the existing `OL_STORE_PII` flag at the persistence layer (handled by `OrderRecordService`); adapter just emits the value.
- **Tests**: 5 new cases cover all branches. Adapter is in the 70% coverage tier — these additions take it well past that.

## Risks

1. **Existing fixtures relying on `buyer.address`-as-shipping-address.** Today's test passes `buyer.address` only and asserts `shippingAddress.city`. After the change that test still passes (no `delivery.address` present → fallback). Verify — if it breaks I missed something.
2. **Round-trip drift on `delivery.cost`.** Allegro returns string-decimal amounts. We `parseFloat` and round to 2 decimals. The `subtotal = Σ(price × quantity)` arithmetic could introduce a sub-cent drift on multi-item orders with prices like `€19.99 × 3 = 59.97000000000001` — `roundCurrency` neutralizes that.
3. **Pickup-point orders without a delivery address.** Allegro returns `delivery.pickupPoint` but no `delivery.address`. Today: would fall back to `buyer.address` (the home address) — wrong, but consistent with the bug we're fixing for #457. Picking the *right* address for pickup-point is #458's scope, not this PR's. The fallback to `buyer.address` keeps current behaviour for that case until #458 ships.
