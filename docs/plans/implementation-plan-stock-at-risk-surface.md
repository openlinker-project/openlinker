# Implementation Plan: Stock-at-risk surface for reservation shortfall

**Date**: 2026-08-27
**Issue**: #2350 (`W2-13`), Wave 2 stream S3. Depends on #2349 (landed, `a8a6c4421`), #2356 (`W2-19`), #2357 (`W2-20`).
**Status**: Ready for implementation — **with one scope reduction stated up front** (§ 2).
**Classification**: Frontend (Interfaces)

---

## 1. Task Summary

**Objective**: make #2349's shortfall episodes visible where an operator can act on them —
*"Order {ref} is short {n} × {sku}"* — as an order-row badge and an order-detail callout.

**Context**: #2349 records the fact; a fact nobody sees is not an honesty commitment. The spec's
body copy is *"The stock master dropped below what this order was promised. Nothing was silently
reduced — this order is the one at risk."*

---

## 2. Scope — and the two things the backend cannot currently support

The issue's Proposed Solution names four surfaces. **Two are deliverable today, two are not**, and
that is a data-availability fact rather than a sequencing preference.

| Surface | Status |
|---|---|
| Order-detail callout | **In scope** — `reservationShortfalls` is on the detail read |
| Order-row badge on `/orders` | **In scope, but requires a backend list read** — see below |
| Product-row badge on `/products` | **DEFERRED** — no backend read exists at any grain |
| Link between the two | **DEFERRED** with the product badge |

**The row badge needs a backend change.** #2349 deliberately put `reservationShortfalls` on the
DETAIL read only, with the reason stated in the controller: putting it on the shared `toDto` would
cost one lookup per row on every page of `/orders`. The FE list and detail share the `OrderRecord`
type, so a row badge *type-checks* today and would **always be `undefined`** — dead code that looks
correct. Two honest options:

- **(A) Extend the list read with a batched lookup** — one query per page, keyed by the page's order
  ids. This is exactly the precedent `getLatestInvoicesForOrders` (#1713) set for the invoice
  projection, which faced this identical list-vs-detail problem. ~40 lines across the service,
  repository and controller. **Recommended.**
- **(B) Ship the detail callout only** and defer the row badge to a follow-up.

**#2350's `File(s)` line understates this slice.** It reads `apps/web/**` only; the diff will carry
`apps/api` and `libs/core` files for the batched list read. Stated here so a reviewer working from
the issue is not surprised. **#2349's detail-only decision stands** — this ADDS a batched list read
beside it and does not move the field.

This plan assumes **(A)**, because a badge that can never render is worse than no badge, and because
the AC "renders on desktop rows and mobile cards from one renderer" is not satisfiable without it.
It does mean this slice touches `apps/api`, which the issue's `File(s)` line does not anticipate.

**The product badge has no data at any grain.** `/products` fetches `Product` (`totalAvailable`,
`totalReserved`) and nothing shortfall-shaped; #2349 exposes episodes per ORDER only. A product badge
needs a new endpoint, a new query hook and KPI-probe changes. Note the ACs themselves list only the
badge title, the one-renderer rule and a component test — none mention `/products`. Deferring it
keeps this slice honest and is proposed as a follow-up issue.

### Out of scope
- RS-S and the attention-section count (**#2356** owns them).
- Any inline remediation. The operator's fix is off-system (buy stock, cancel, contact buyer).

---

## 3. Architecture Mapping

**Layers**: `apps/web/src/features/orders/**` (copy lib + cell component + detail callout),
`apps/web/src/pages/orders/**` (mount points), plus the `apps/api` list-read extension from § 2.

Dependency direction is unchanged: `pages → features → shared`. The new copy lib and cell live in
`features/orders`; both mount points are pages. Nothing is added to `shared/`.

---

## 4. Design

### 4.1 One copy source, because the AC demands byte-identical text

AC1 requires the badge title be byte-identical to the attention-table title. `W2-20`'s copy module
does not exist on this branch, and the repo's actual pattern is a **per-feature copy lib**
(`features/orders/lib/order-row.ts` holds `invoicingBlockedBadge`, `taxRateConflictBadge`, …;
`features/invoicing/lib/sales-document-block-copy.ts` holds the panel copy).

So this slice **creates the single source** — `features/orders/lib/stock-at-risk-copy.ts` — exporting
`stockAtRiskBadge(shortfalls)` and `stockAtRiskCallout(shortfalls)` over one shared title builder.
**#2357 (`W2-20`) does not exist on this branch**, so the byte-identity AC is satisfied against a
source of truth *this slice creates*. When #2357 lands it should **absorb this file**, not grow its
own copy of the sentence. #2356 imports the same builder rather than restating the string. Byte-identity is then structural: a
second copy of the sentence cannot exist without deleting the import.

The title is `Short {n} × {sku}` for one episode and `Short stock on {n} items` for several;
`t()`-injected, following `sales-document-block-copy.ts`. A null `sku` degrades to the variant id and
never to an empty gap.

### 4.1b WHERE the badge goes — the style guide already decided

`frontend-ui-style-guide.md § Order-row signal placement (#2081)` partitions the row into three
semantic groups, and a shortfall is unambiguously placed by it:

- **A shortfall is an EXCEPTION, so it is a badge, and it belongs in the STATUS group** — the guide
  puts exceptions (its example is an open return) beside failure reasons, subordinate to order
  health. It is not a Money signal and it is not a Shipment signal, so it gets **no new column**.
- **It sits BESIDE health, never inside it.** Rule 4 is explicit: `OrderHealthValues` is a partition
  whose values must stay exhaustive and mutually exclusive so the KPI cards sum to the total.
  Adding a shortfall value to that union would break the sum. (This is the same trap #2100 named
  when it declined a sixth `OrderHealth` bucket for sales-document blocks.)
- **The list displays; the detail page acts** (rule 3) — the badge is inert, never an affordance.
  That matches this issue's own "no inline remediation in v1".

No row-height carve-out is needed: the badge joins an existing stack in a cell the Orders table
already top-aligns (`.orders-table td`, #2091), rather than making the row taller on its own.

### 4.2 One renderer, two layouts

`features/orders/components/stock-at-risk-badge.tsx` takes `layout: 'stack' | 'row'` and is rendered
verbatim by both the desktop column cell and the mobile card slot — the `OrderInvoicingCell` (#2100)
contract exactly, whose own header records that this used to be a hand-duplicated parallel path.
`layout` is layout only; it never changes what is said.

### 4.3 An empty array is not a positive claim

`loadReservationShortfalls` catches to `[]` on failure (#2349, error-logged). So:

- **No badge is rendered for an empty array** — absence of a badge means "nothing reported", which
  is the honest reading of a value that is also what a failure produces.
- **The detail callout never renders a "no shortfalls" reassurance.** Stating "this order is fine"
  on data that may be a swallowed error would be a false claim, and the whole point of #2349 is that
  a shortfall is never silently absent.

This is written into the copy module's docblock so a later contributor does not add the reassurance.

### 4.4 Types, not Zod

`features/orders/api/orders.types.ts` is plain TypeScript interfaces — there is **no** Zod schema
over `OrderRecord` (the only Zod in the feature parses the opaque `orderSnapshot` sub-tree). The
S3 standing rule ("`.nullish()` never `.optional()`") applies to Zod schemas over new projections, so
it applies **vacuously** here. The equivalent obligation is honoured in the file's own convention:
`sku` and `productVariantId` are typed `string | null` (not `?: string`), so a JSON `null` is a
representable value rather than a parse gap, and the array itself is `?: T[]` matching the
"optional for graceful degradation on older payloads" convention the file documents.

---

## 5. Implementation Steps

### Phase 1 — backend list read (§ 2 option A)
1. `IReservationShortfallService.listOpenForOrders(orderRecordIds)` + repository
   `listOpenByOrderRecordIds` — one `IN` query, grouped into a `Map`.
2. `OrdersController.listOrders` calls it **once per page** beside the existing invoice batch read,
   never inside the row loop.

### Phase 2 — FE contract + copy
3. `orders.types.ts`: `OrderReservationShortfall` interface + `reservationShortfalls?:` on `OrderRecord`.
4. `features/orders/lib/stock-at-risk-copy.ts` — the single copy source (§ 4.1).
5. Export both from `features/orders/index.ts` (the barrel is the cross-feature seam; #2356 consumes it).

### Phase 3 — components
6. `features/orders/components/stock-at-risk-badge.tsx` (+ test).
7. `features/orders/components/stock-at-risk-callout.tsx` (+ test) — wraps the shared `Alert`.

### Phase 4 — mounts
8. `orders-list-page.tsx`: rendered inside the **Status** group's cell (§ 4.1b) on desktop, and in
   the mobile card's corresponding labelled fact — same component, `layout` differing only.
9. `order-detail-page.tsx`: mount the callout in the existing full-width Alert slot, beside the
   failed-destinations callout.

### Phase 5 — gate
10. `pnpm lint`, `pnpm type-check`, apps/web unit suite. **No integration run** (Docker is wedged
    host-side; #2349's int-spec is already carried as unverified).

---

## 6. Alternatives Considered

- **Row badge from the detail read.** Rejected: the field is `undefined` on list rows, so the badge
  would never render while type-checking cleanly — the worst failure shape available.
- **Per-row detail fetch on `/orders`.** Rejected: N requests per page, the exact cost #2349's
  detail-only decision avoided.
- **Copy inline in each component.** Rejected: AC1 requires byte-identity with a table that does not
  exist yet, which only a shared builder can guarantee.
- **A `shared/ui` badge primitive.** Rejected: `StatusBadge` already exists; this is domain copy over
  it, and `shared/` may not hold domain vocabulary.

---

## 7. Risks

| Risk | Handling |
|---|---|
| Empty array conflated with "healthy" | No badge, no reassurance copy (§ 4.3), documented in the module |
| Copy drift with #2356 | One exported builder; #2356 imports it |
| List-read cost | One batched query per page, the #1713 precedent — never per row (the `ConnectionCell` / #1996 N+1 trap) |
| List read fails | Same honesty rule as the detail loader: an empty result must never render as "no shortfalls" (§ 4.3) |
| `sku` null | Degrades to the variant id, never an empty gap |

## 8. AC mapping

- Badge title byte-identical to the attention table → one exported builder (§ 4.1).
- One renderer for desktop + mobile → `stock-at-risk-badge.tsx` with `layout` (§ 4.2).
- Component test covers badge + callout → Phase 3.
