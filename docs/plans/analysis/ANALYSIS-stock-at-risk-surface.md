# Pre-implement gate: stock-at-risk surface (#2350)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-stock-at-risk-surface.md`
**Verdict**: **READY** — the plan's own § 2 already names the one blocking finding and resolves it.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `IReservationShortfallService.listOpenForOrders` | **NEW** | no `listOpenForOrders` / `listOpenByOrderRecordIds` anywhere |
| Batched per-page read pattern | **REUSE** | `IInvoiceService.getLatestInvoicesForOrders` (`invoice.service.interface.ts:142`), called once per page at `orders.controller.ts:202`. This is the exact precedent, and #2349's own comment at `:334` cites it |
| `features/orders/lib/stock-at-risk-copy.ts` | **NEW** | the lib dir holds `order-row.ts`, `delivery-copy.ts`, `order-health.ts`, … — no shortfall copy |
| Row badge copy-table pattern | **REUSE** | `order-row.ts` (`invoicingBlockedBadge`, `taxRateConflictBadge`) — table + `satisfies Record<…>` + table-driven test in `order-row.test.ts` |
| `stock-at-risk-badge.tsx` (one renderer, two layouts) | **REUSE the shape** | `order-invoicing-cell.tsx` — `layout: 'stack' \| 'row'`, rendered verbatim by the desktop cell and the mobile card slot |
| `StatusBadge` / `Alert` | **REUSE** | both exported from `shared/ui/index.ts:23-26` |
| `features/orders` barrel | **REUSE** | exists (9 exports); `orders` is already in both `no-restricted-imports` pattern groups, so #2356 can import the copy builder |
| Detail callout mount slot | **REUSE** | the full-width `<Alert tone="error">` failed-destinations callout on `order-detail-page.tsx` is the precedent slot |
| Zod schema over `OrderRecord` | **DOES NOT EXIST** | `orders.types.ts` is plain interfaces; the only Zod parses the `orderSnapshot` sub-tree |

## Backward-compat findings

**No Critical items.** Everything is additive: one optional field on a response DTO, one new service
method, one new repository method, two new FE components, one new FE copy lib.

**Warning-1 — this slice touches `apps/api`, which #2350's `File(s)` line does not anticipate.**
The plan states this in § 2 and justifies it: without the list read the row badge is permanently
`undefined`. Flagged so the reviewer is not surprised by backend files in a "Frontend" issue.

**Warning-2 — the S3 `.nullish()` rule applies vacuously.** The rule governs *Zod schemas over new
projections*; there is no Zod over `OrderRecord`. The plan honours the equivalent obligation in the
file's own convention (`string | null`, not `?: string`) — § 4.4. Worth stating explicitly so it does
not read as the rule being ignored.

**Warning-3 — invariant scripts.** `check-ui-vocabulary.mjs` (FE copy), plus the standard lint gates.
No mirror script exists for the shortfall shape and none is needed — unlike the sales-document reason
union, this carries no closed enum the FE re-declares.

## Open questions

None blocking. One recorded:

- **The product-row badge is deferred** (no backend read at any grain — `/products` fetches
  `totalAvailable` / `totalReserved` and nothing shortfall-shaped). The issue's ACs do not mention
  `/products`, so this is a Proposed-Solution reduction rather than an AC miss. It needs its own
  follow-up issue naming the endpoint it requires.
