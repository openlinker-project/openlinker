# Pre-implement gate — Orders table redesign (#1713)

**Verdict: READY**

Grounded against fresh `main` (4bc702cb) via two deep Explore passes (FE list surface + backend DTO/sort/adapter surface). No reuse collisions, no contract-surface breaks. All backend touches are additive.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| Merged `shipment` / `money` columns, composite sort headers | NEW (FE-internal column config) | `orders-list-page.tsx` columns useMemo; no shared primitive needed — `DataTable` renders a non-sortable column's `header` node verbatim. |
| `applySort(key)` FE helper | NEW (extracted from existing `onSortChange`) | logic already inline at `orders-list-page.tsx` onSortChange; extraction only. |
| Items summary / payment-badge view-model helpers | NEW | add to `features/orders/lib/order-health.ts`; reuses existing `fulfillmentBadge`/`slaBadge`/`deriveOrderHealth`. |
| `payment` sort key | PARTIAL (extend) | `OrderRecordSortValues` (`order-record.types.ts`) + `applySort` switch (`order-record.repository.ts`) already hold `total`/`customer`/`fulfillment` JSONB sorts; mirror `->>'paymentStatus'`. |
| Source `externalUrl` | PARTIAL (extend) | `IncomingOrder` type gains optional field; adapters' `getOrder` populate; `order-record.service.ts` persist methods already write the snapshot — add one key. No new port/service. |
| Allegro salescenter URL helper | NEW (sibling of existing) | `allegro-hosts.ts` already has `getAllegroWebBaseUrl(env)`; add `getAllegroSalesCenterOrderUrl`. |
| PrestaShop base URL access | EXISTS (reuse) | `connection.config.baseUrl` already read in `prestashop-order-source.adapter.ts:173`. |

No new ports, services, DI tokens, ORM entities, or capabilities. Nothing reinvented.

## Backward-compat findings

| Surface | Change | Severity | Note |
|---|---|---|---|
| `@openlinker/core/orders` barrel — `OrderRecordSortValues` | add `'payment'` | none (additive to `as const`) | No consumer breaks; FE `OrderSortValues` mirror is additive too. |
| `IncomingOrder` type | add optional `externalUrl?` | none (additive, optional) | Adapters populate opportunistically; absent ⇒ link hidden. |
| `OrderRecordResponseDto` / `OrderSyncStatusResponseDto` | **none** | none | Source URL rides in the `orderSnapshot` JSONB (already `Record<string, unknown>`), which `toDto` returns verbatim — **no API DTO change, no per-row lookup**. |
| ORM schema | **none** | none | URL persisted as a snapshot JSONB key, not a column ⇒ **no migration**. |
| `ParsedOrderSnapshot` (FE) | add optional `sourceExternalUrl?` | none (additive) | Zod schema extend. |
| `check:invariants` | none expected | none | Backend edits stay within orders context + adapters that already import the orders barrel; no new cross-context/deny-pattern imports; no repo-URL-guard trip. FE not walked. |
| FE column id rename `fulfillment`→`shipment`, `total`→`money` | internal | none | Not a published contract; `SORT_KEY_TO_COLUMN`/`COLUMN_TO_SORT_KEY` kept consistent; server sort keys unchanged. |

## Open questions (non-blocking)

1. **Master-shop (destination) link** — decided **deferred** to a follow-up issue (PrestaShop admin URL needs token + admin-dir, not in config). Out of scope for this PR.
2. **Erli source URL scheme** — if no confirmable seller-panel order URL, Erli's source link is simply hidden (graceful degradation). Not a blocker.
3. **Composite sort-header discoverability** — two headers each carrying multiple sort buttons is dense/non-standard; verify on the live UI (`/verify`) before finalizing; fallback is splitting back to separate columns.
4. **Payment ordering** — alphabetical (`awaiting<cod<paid<refunded`) is fine for MVP; semantic ordinal optional. Expression index migration optional (low row counts).

## Conclusion

Proceed. The FE redesign is self-contained over data the list already loads; the two backend additions (`payment` sort, source `externalUrl` via snapshot) are additive and migration-free. Follow the sequenced commits in the plan §4 (steps 1-6; step 7 deferred).
