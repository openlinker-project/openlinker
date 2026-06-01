# Implementation Plan — Orders list filter/sort bar + identity-cell robustness (#939)

> Sibling redesign: #929 (orders list). Spec mockup: `docs/plans/orders-list-redesign-mockup.html`.
> Page under change: `apps/web/src/pages/orders/orders-list-page.tsx`.

## 1. Goal & layer classification

Two bundled gaps against the #929 mockup, both felt on `/orders`:

- **A — Filter + sort bar.** The mockup specs a filter row (Status / Source / Destination / Placed / Sort) that was never built; today only the health tiles + breaching chip filter. Surface the controls the backend query already supports.
- **C — Identity cells read poorly.** Order column renders a bare Allegro `checkoutFormId` UUID; Customer column shows `—` on every row.

**Layer: Frontend only.** No backend/CORE/migration touch. This is the key finding from research (see §2) — the original issue hypothesized a backend mapping/PII bug; the trace disproves that.

## 2. Research findings (root cause of C)

Traced the order-snapshot data path (Allegro adapter → IncomingOrder → Order → snapshot → FE):

- The Allegro adapter **does** populate `orderNumber` and `shippingAddress` (incl. `firstName`/`lastName`) correctly — `allegro-order-source.adapter.ts:265,335-390`.
- `orderNumber` = the Allegro **`checkoutFormId`**, which is genuinely a UUID (`212fbcf0-39d5-11f1-…`). Allegro exposes no friendly order number. So the Order column showing a UUID is **not a bug** — it's the real identifier, rendered verbatim by `EntityLabel`'s `name` prop (no shortening on `name`).
- Customer `—`: **confirmed root cause via dev-DB inspection (PII=true).** The persisted `shippingAddress` is complete and correct (`firstName: "Piotr"`, `lastName`, `address1`, `city`, `postalCode`, `country` all present) — but it also carries `company: null`. The FE `addressSchema` (`order-snapshot.schema.ts:15-26`) declares `company: z.string().optional()`, which accepts `string | undefined` but **rejects `null`**. So `addressSchema.safeParse` fails on the whole object, `parsed.shippingAddress` is dropped, and `customerName()` returns `null` → `—`. (32/39 dev rows carry `company:null`; 7 have a genuinely null `shippingAddress` and correctly show `—`.)

**Conclusion:** C is a **frontend** fix. The primary bug is the zod schema's intolerance of `null` on optional fields. No change to adapters, core, or persistence. Verified: `OL_STORE_PII=true`, `orderNumber` = Allegro `checkoutFormId` UUID (real identifier).

## 3. Scope

### A — Filter + sort bar (mirror `connections-list-page.tsx` precedent)
- **Source filter** — `Select` from `useConnectionsQuery()` (already loaded), wired to existing `?sourceConnectionId` URL param (already read at `:144`, already scopes both list + summary).
- **Sort control** — `Select` over `OrderSortValues` (`'createdAt' | 'dispatchBy'`), replacing the hardcoded `sort: 'dispatchBy'` (`:160`), persisted to `?sort=`. Labels: "Ship-by (soonest)" = `dispatchBy`, "Created (newest)" = `createdAt`.
- **Placed/Created date range** — two `<input type="date">` wired to `?createdFrom` / `?createdTo` (already in `buildQuery`). Convert to ISO instant on set.
- All state in URL search params; each change clears `offset` (mirror `setHealthFilter`). Render in the existing chip row (`:489-501`), left of the results count. Reuse `handleFilterChange` shape from connections page.

### C — Identity cells
- **C0 (primary bug) Address schema tolerates `null`** — in `order-snapshot.schema.ts`, optional string fields (`company`, `phone`, `address2`, `firstName`, `lastName`, `state`) must accept `null` (persisted as `null`, not absent). Switch `.optional()` → `.nullish()` (or a `null → undefined` preprocess) on the nullable optionals so one `null` field no longer fails the whole `safeParse`. This single fix restores Customer name + city on the 32 affected rows. Add a regression test with a `company:null` snapshot.
- **C1 Order column** — shorten a long (UUID-shaped) `orderNumber` to a `head…tail` form via `formatOrderRef(orderNumber)` so it reads as a reference instead of a 36-char hash; short numbers pass through untouched. No channel prefix (the dedicated Channel column already conveys the marketplace, and prefixing would churn the existing exact-text test anchors). Full `internalOrderId` stays in the `EntityLabel` chip + Copy; absent `orderNumber` keeps the `internalOrderId` fallback.
- **C2 Customer column (defense-in-depth)** — make `customerName()` resilient: name (`firstName`/`lastName`) → fall back to `parsed.customerEmail` → then `—`. Keep the city subline when a name resolved. Secondary to C0.

### Out of scope (deferred from #929, keep)
- Clickable column-header sort (server can't `ORDER BY` JSONB derivations without indexes).
- Status filter chip (overlaps health tiles).
- Destination filter, Save view, bulk selection.
- Any backend / adapter / PII change.

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 4.1 | `features/orders/api/orders.types.ts` | (verify only) `OrderSortValues` exported | no change expected |
| 4.2 | `pages/orders/orders-list-page.tsx` | Read `sort`/`createdFrom`/`createdTo` from URL; type-guard `sort` vs `OrderSortValues`; drop hardcoded sort | filters object built from URL |
| 4.3 | `pages/orders/orders-list-page.tsx` | `handleFilterChange(key,value)` setter (clears `offset`) | mirrors connections page |
| 4.4 | `pages/orders/orders-list-page.tsx` | Render Source `Select`, Sort `Select`, two date inputs in the filter row | a11y labels; tabular/mono per style |
| 4.5 | `pages/orders/orders-list-page.tsx` | `formatOrderRef()` helper + use in Order column cell + cardView title | UUID no longer shown raw; channel-prefixed + shortened |
| 4.6 | `pages/orders/orders-list-page.tsx` | Harden `customerName()` with email fallback | cell never blank when email/city present |
| 4.7 | `index.css` (+ `tokens.ts` if new var) | `/* ── Orders list filters (#939) ── */` bounded section for the filter row layout | reuse existing tokens; drift check passes |
| 4.8 | `pages/orders/orders-list-page.test.tsx` | Tests: source filter sets `sourceConnectionId`; sort `Select` sets `sort`; date sets `createdFrom`; Order ref shows channel+short; Customer falls back to email | all green |

## 5. Testing
- FE unit/component (`orders-list-page.test.tsx`) — extend with the 4.8 cases, mirroring the existing segment-click URL-param assertions.
- Full `pnpm lint` + `pnpm type-check` + `pnpm test`. No integration tests (FE-only, no API contract change).

## 6. Risks
- **Date-input UX** — native `<input type=date>` is the MVP-appropriate control (no date-picker primitive exists). Acceptable; note as follow-up if richer range UI wanted.
- **Sort label honesty** — `dispatchBy` default must stay the initial sort so the triage ordering is unchanged when no `?sort` is set.
- **C2 email is PII** — surfacing `customerEmail` as a fallback is consistent with it already being in the snapshot + on the detail page; if PII-hardening later hashes email, the fallback simply yields `—` again (no regression).
