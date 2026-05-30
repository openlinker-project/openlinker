# Implementation Plan — Source-Authoritative Order Pricing (#895)

> **Status:** v3 (post tech-review) — in implementation
> **Issue:** [#895](https://github.com/openlinker-project/openlinker/issues/895)
> **ADR:** [ADR-014](../architecture/adrs/014-source-authoritative-order-pricing.md)
> **Branch:** `895-source-authoritative-order-pricing`

---

## 1. Goal & framing

When a marketplace order (Allegro) is created into a destination shop (PrestaShop), the destination
order **must be priced at the buyer-paid source price**, not the destination catalog price. Today PS
orders land in `Payment error` (repro #6 `RPRRSFSUW`: catalog 1,499×2 on the lines, 30.95 paid).

**CORE owns the scenario; integrations implement it natively.** The seven design decisions below
were resolved in a design grill and are captured in ADR-014.

### Resolved decisions

| # | Decision | Resolution |
|---|---|---|
| Q1 | Contract shape | **Invariant** on `createOrder` (not opt-in capability); fail-fast if unhonorable |
| Q2 | Core tax signal | `taxTreatment?: 'inclusive'\|'exclusive'` union on `OrderTotals`, order-level; tax **rate stays destination-side** |
| Q3 | PS mechanism | Native cart-scoped **`specific_price`** (fiscal correctness; PS stays its own tax authority) |
| Q4 | Tax + rounding | **Delivery-country** rate from PS; **buyer-paid-total-anchored largest-remainder** allocation; don't mirror PS rounding |
| Q5 | Override lifecycle | **Short-`to` expiry + create→order→best-effort-delete** this PR; durable self-healing reconciliation = follow-up (avoids a new entity + migration) |
| Q6 | Source tax model | `taxTreatment` (gross/net) union now; **`tax?` optional deferred to a follow-up** (highest blast radius, marginal present value) |
| Q7 | Enforcement/placement | Layered tests + PS int-spec lock (no OL module); `@openlinker/shared/money` (minor units, wired in `exports`); ADR-014 |

### Tech-review adjustments (applied)

- **No migration in this PR.** `OrderTotals` gains only `taxTreatment?` (jsonb-stored, optional). The durable saga-state reconciliation (which *would* need a new entity + migration) is deferred; override cleanup this PR is short-`to` expiry + best-effort delete.
- **`tax?` optional deferred.** Ship `taxTreatment` + the PS fix (closes #895) now; `tax` stays a required `number`. The gross + genuinely-tax-exempt case (the only thing `tax?` unlocks) has no source today.
- **`@openlinker/shared/money`** requires a `libs/shared/package.json` `exports` subpath entry (mirrors `logging`/`cache`) — explicit step, else `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **PS tax "based-on" config** (delivery vs invoice vs store address) must match rate resolution — the int-spec asserts against the real PS response, not the delivery-country assumption.
- **Int-spec runs without the OL module** (`installOlModule: false`), isolating line pricing from shipping so it runs in CI.

### Layer map

| Layer | Change |
|---|---|
| **CORE — orders** | `OrderTotals.taxTreatment?`, `tax?` optional; `createOrder` invariant doc; propagation |
| **CORE — shared** | `@openlinker/shared/money` largest-remainder allocation (minor units), pure |
| **Integration — Allegro** | emit `taxTreatment: 'inclusive'`, omit `tax` |
| **Integration — PrestaShop** | `specific_price` pin + delivery-country rate inversion + penny allocation + saga lifecycle; fix `total_paid_tax_excl` derivation |
| **Docs** | ADR-014; architecture-overview Orders note |

### Non-goals (deferred, with rationale)

- **Per-line `subtotal`/`total`/`currency`/`taxAmount` on `OrderItem`** — Allegro reports
  order-level gross with no per-line tax; speculative until WC #877 needs it.
- **`Money` value object / minor-unit migration of the contract** — the float `number`
  representation is the deeper latent issue; the allocation helper works in minor units internally,
  but a full VO refactor is its own effort. Flagged as the correct end-state.
- **WooCommerce / Shopify adapters** — out of scope; contract validated as neutral against #877 +
  Shopify draft-order model.
- **Editing the OL PrestaShop PHP module** — `specific_price` is native; no module change.
- **Reconciling historical `Payment error` orders** — forward-fix only.

---

## 2. Design detail

### 2.1 CORE — `OrderTotals` tax semantics (two orthogonal axes)

`libs/core/src/orders/domain/types/order.types.ts` + `incoming-order.types.ts`:

```ts
export const PriceTaxTreatmentValues = ['inclusive', 'exclusive'] as const;
export type PriceTaxTreatment = (typeof PriceTaxTreatmentValues)[number];

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  taxTreatment?: PriceTaxTreatment;  // absent = unknown; 'inclusive' = gross, 'exclusive' = net
}
```

Mirror `taxTreatment?` on `IncomingOrderTotals`. Optional → backward-compatible, **no migration**
(`order_records.totals` is `jsonb`).

**Why:** `taxTreatment` (gross/net) is source-uniform and source-domain. Tax **rate** is
deliberately absent — it's destination-catalog knowledge. **`tax?` optional is deferred** (see
tech-review adjustments): `tax` stays a required `number` this PR; the only scenario it unlocks
(gross + genuinely-tax-exempt source) has no source today, and the change has the largest consumer
blast radius.

### 2.2 CORE — `createOrder` invariant

Doc-contract on `OrderProcessorManagerPort.createOrder`: MUST price lines at `items[].price`
honouring `totals.taxTreatment`; MUST NOT substitute catalog price; MUST fail loudly if it cannot.
**Not** a sub-capability (it's a universal behavioural constraint — see ADR-014).

### 2.3 CORE — `@openlinker/shared/money` allocation helper

New pure module `libs/shared/src/money/allocate-by-largest-remainder.ts`:

```ts
/** Distribute `totalMinor` across `weightsMinor` so the parts sum EXACTLY to
 *  totalMinor, assigning rounding residual by largest fractional remainder. */
export function allocateByLargestRemainder(totalMinor: number, weightsMinor: number[]): number[];
```

Operates on **integer minor units** (exact sums; no float drift). Pure, dependency-free, reusable
by every destination adapter. Unit-tested on the sum-preservation property + deterministic residual
placement. (Seed for a future `Money` VO.)

**Exports wiring:** add a `./money` subpath to `libs/shared/package.json` `exports` (+ a barrel
`libs/shared/src/money/index.ts`), mirroring `@openlinker/shared/logging` / `cache` — otherwise the
import fails at Node runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

**Multi-rate note:** with mixed per-line tax rates there is no single net total. The helper preserves
each line's **gross** (`net_line = gross_line / (1 + rate_line)`, summing to the authoritative gross
total because source lines already sum to it) and distributes only the **sub-cent rounding residual**
across lines, independent of per-line rate.

### 2.4 Integration — Allegro source

`allegro-order-source.adapter.ts` totals (~line 274): set `taxTreatment: 'inclusive'`, **omit
`tax`** (Allegro doesn't decompose). Buyer prices (`lineItem.price.amount`, `summary.totalToPay`)
are gross.

### 2.5 Integration — PrestaShop destination

Sequence in `createOrder` becomes: resolve → `POST /carts` → **resolve delivery-country tax rate +
compute net unit prices + penny-allocate + `POST /specific_prices` (cart-scoped) per line** →
`POST /orders` → **delete overrides** → map identifiers.

- **Rate resolution:** product → `id_tax_rules_group` → rate for the order's **delivery country**
  (state where configured), read from PS, memoized per `(connection, group, country)`. Inversion
  `net = gross / (1 + rate)`; PS re-grosses with the same rate → exact line total. Rate `0`/unknown
  → `net = gross`.
- **Penny allocation:** anchor on buyer-paid `totals.total`; allocate net line amounts (minor
  units) via `allocateByLargestRemainder` so PS's re-grossed sum equals buyer-paid exactly;
  irreducible sub-cent residual logged as tolerance.
- **`specific_price` payload:** cart-scoped (`id_cart`), `from_quantity: 1`, `price` = net,
  `reduction: 0`, `reduction_type: 'amount'`, `reduction_tax: 0`, broad-match `0` ids, `from` now,
  **`to` = short near-future expiry** (fail-safe deactivation).
- **Lifecycle (this PR):** create overrides before `POST /orders`; **best-effort delete** the
  created ids after success (and on failure). Short-`to` expiry bounds the harm of any orphan from a
  crash. *Durable coordinator-side reconciliation* (which needs a new persisted entity + migration)
  is a tracked follow-up — out of scope here.
- **PS tax "based-on" caveat:** rate resolution assumes PS taxes on the **delivery** address; PS can
  be configured for invoice/store address. The int-spec asserts against the **actual** PS-computed
  `order_detail` rather than trusting the assumption.
- **Mapper fix:** `total_paid_tax_excl` derived as `subtotal / (1 + rate)` when
  `taxTreatment: 'inclusive'`, not equated to the gross `subtotal`. Keep `order_rows.product_price`
  with a comment that `specific_price` is the effective mechanism.
- **WS client:** add `deleteResource(resource, id)` (none today).

---

## 3. Step-by-step

### CORE
1. `order.types.ts` / `incoming-order.types.ts` — `PriceTaxTreatment` union + `taxTreatment?`
   (no `tax?` change). *AC:* type-check; documented; no migration.
2. `order-sync.service.ts` / `order-ingestion.service.ts` — propagate `taxTreatment`.
   *AC:* unit test asserts it reaches the `OrderCreate` handed to `createOrder`.
3. `order-processor-manager.port.ts` — invariant doc.
4. `libs/shared/src/money/` — `allocateByLargestRemainder` + barrel + `package.json` `exports`
   subpath. *AC:* pure unit tests (sum-exact; residual determinism; n=1, zeros, negatives guarded);
   import resolves at runtime.

### Integration — Allegro
6. `allegro-order-source.adapter.ts` — `taxTreatment: 'inclusive'`, omit `tax`. *AC:* adapter spec.

### Integration — PrestaShop
5. WS client interface+impl — `deleteResource`. *AC:* client spec (URL/verb).
6. Delivery-country tax-rate resolver (memoized), extracted as a private helper/collaborator with a
   file header. *AC:* unit: 23%→0.23, country-specific, unknown→0.
7. `prestashop-order-processor-manager.adapter.ts` — specific_price pin (net + allocation) +
   best-effort cleanup, behind extracted helpers to keep `createOrder` readable. *AC:* unit (mocked
   WS): one `specific_prices` POST/line, correct net, `id_cart`, ordered before `orders`, delete
   after.
8. `prestashop-order.mapper.ts` — `total_paid_tax_excl` derivation; comment that `specific_price` is
   authoritative (keep the no-op `order_rows.product_price`). *AC:* mapper spec.

### Tests + Docs
9. **Int-spec (regression lock)** — `installOlModule: false`, shipping isolated (standard carrier /
   zero shipping): order with buyer price ≠ catalog price → assert PS-computed
   `order_detail.product_price == buyer-paid` (within tolerance) AND status ≠ payment-error. Runs in
   CI (no OL module).
10. ADR-014 (done); architecture-overview Orders note referencing it. New files carry headers per
    engineering-standards § File Headers.

---

## 4. Validation

- **Architecture:** core neutral (no PS/WC leakage); PS specifics in the adapter; CORE→Integration
  direction preserved; `shared/money` dependency-free.
- **Standards:** `as const` union; types in `*.types.ts`; invariant on the port; Symbol tokens
  unaffected; barrel exports for the new union + helper.
- **Security:** no secrets; `specific_price` writes via the authenticated WS client.
- **Testing:** unit on every branch + the vertical int-spec lock.

---

## 5. Open risks (tracked, not blocking)

0. **Shipping reconciliation is out of scope (scope boundary).** This fix pins the
   **line** price. `Payment error` also fires on shipping mismatch: for a **static**
   (non-OL-Dynamic) carrier PS computes shipping from its own zone tables, which may
   differ from `totals.shipping`. So `Payment error` is fully resolved only when
   shipping also reconciles (the OL Dynamic carrier sidecar path, #516). Not a
   regression — separate concern.

1. **PS rounding modes** (`PS_ROUND_TYPE`/precision) can still leave a logged sub-cent tolerance —
   int-spec asserts within tolerance, not bit-exact.
2. **Cross-border / OSS rates** — delivery-country resolution covers the common case; exotic
   per-state configs may need follow-up.
3. **Reconciliation sweep** — durable saga-state cleanup is the correct model; if the persistence
   for sync-attempt override-state is heavier than wanted, the short-`to`-expiry fail-safe bounds
   the harm and a follow-up can add the sweep. Call this out at review.
4. **PR size** — core + shared + Allegro + PS + ADR is one cohesive bug-fix PR (the bug isn't fixed
   without all parts). Split only if review prefers a core-contract-first PR.
