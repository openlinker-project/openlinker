# Pre-implement analysis — master capability ladder (#2220 / #2221)

Gate run against `docs/plans/implementation-plan-master-capability-ladder.md` before any code was written.

## Verdict: **NEEDS-REVISION**

One Critical type-level break plus one misclassified "NEW" artifact that already exists. The *design* is sound —
guard-only rung, watermark discipline, WooCommerce-only scope, no inventory rung — and every load-bearing
assumption checked against the live tree held, including the two most likely to have been wrong (the retro-fill
argument and the `dates_are_gmt` serialization).

## Critical

**C1 — `sweepCursorKey('product-delta', …)` does not compile. `kind` is a closed union.**

```ts
// apps/worker/src/sync/bounded-sweep.ts
export function sweepLockKey(kind: 'product' | 'inventory', connectionId: string): string   // :79
export function sweepCursorKey(kind: 'product' | 'inventory', connectionId: string): string // :84
```

Plan § 4 proposes `sweepCursorKey('product-delta', …)` — a `TS2345`. The test plan's "lock contention → skip"
needs `sweepLockKey`, which carries the same union. Chosen resolution: **widen both unions** (additive, keeps one
key-format owner). Note the widened formatter emits `master.product-delta.sweep:connection:{id}`, which does not
match the plan's stated `master.product.delta.sweep:connection:{id}` — one spelling must win. The plan must also
name the **lock** key, not only the cursor key.

**C2 — `master-job-payloads.types.ts` is marked NEW but already exists.** It ships
`MasterProductSyncByExternalIdPayloadV1`, `MasterInventorySyncByExternalIdPayloadV1`,
`MasterProductSyncAllPayloadV1`, `MasterInventorySyncAllPayloadV1` — all barrel-exported and imported by both
`syncAll` handlers. File-table row 4 must read **extend**, reusing the existing `pageLimit` doc convention
(`:22-27`).

## Reuse audit

| Plan artifact | Class | Evidence |
|---|---|---|
| `modified-since-lister.capability.ts` | **NEW** | Only 5 `domain/ports/capabilities/` dirs exist (fiscalization, invoicing, listings, orders, shipping). |
| `inventory/…/capabilities/` (deferred) | **NEW / correctly deferred** | Matches ADR-048 d1 + d7. |
| Any `ModifiedSinceLister` / delta capability | **ABSENT** | Grep for `ModifiedSince|listExternalIdsModifiedSince|syncDelta`: nothing. |
| `ProductFilters.updatedSince` | **ABSENT on products** | All `updatedSince` hits are orders-scoped (`order.types.ts:61`, `prestashop-query.builder.ts:28,108`). ADR-048's rejected alternative is genuinely un-taken. |
| `master.product.syncDelta` job/handler | **NEW** | `sync-job.types.ts:15-77`; no delta handler present. |
| `master-job-payloads.types.ts` | **EXISTS → extend** | See C2. |
| `runBoundedSweep` | **EXISTS → reuse (caveat C1)** | Signature matches the plan exactly: `readPage(offset, budget) → SweepPage`, cursor held entirely on any failure, `nextCursor: null` on completion. |
| `ISyncCursorsService` watermark | **EXISTS → reuse** | `:18,32` — `getCursor → Promise<string\|null>`, `advanceCursor(…, value: string)`. `:29` puts monotonic comparison on the caller; "advance only on completion" satisfies it. |
| `dates_are_gmt=true` serialization | **VERIFIED SAFE** | `woocommerce-http-client.ts:77-79` — `String(v)` via `URLSearchParams`. Same as the shipped `woocommerce-order-source.adapter.ts:63-64,71`. |
| WC `offset → page` | **EXISTS → reuse verbatim** | `woocommerce-product-master.adapter.ts:64-74`. |
| `defaultEnabled: false` | **EXISTS → reuse** | `scheduler.service.ts:88` field, `:162` precedent, resolution `:471-476,491`. |
| Guard-only rationale | **VERIFIED CORRECT** | `integrations.service.ts:108` and `:191` both gate on `connection.enabledCapabilities`. The retro-fill trap is real. |

## Warnings

- **W1 — budget (≤500) vs WC's hard `per_page` cap of 100.** `SWEEP_BUDGET_MAX = 500`, but WC 400s above 100 —
  the reason `master-product-sync-all.handler.ts:74-77` keeps a separate `DEFAULT_PAGE_SIZE = 100` (#1723). The
  plan's `readPage` sketch passes the budget through as `per_page`. Clamp one or the other; say which.
- **W2 — `orderby=modified&order=asc` is not stable paging.** A row re-modified mid-run moves toward the tail,
  shifting later rows back by one, so one unread row is skipped for that cycle. Acceptable (next cycle re-reads;
  writes are idempotent) but the plan claims a stability it does not have.
- **W3 — FE `JobType` mirror unmentioned** (`apps/web/src/features/sync-jobs/api/sync-jobs.types.ts:52-68`). Not a
  runtime break — the mirror is already partial and `SyncJob.jobType` is `string`, and no invariant script guards
  it — but omitting it means the job never appears in the jobs-list filter. Make it an explicit choice.
- **W4 — `docs/capabilities.md` needs a new *section*, not a row.** No `ProductMasterPort` section exists. A new
  section plus the architecture-overview "46 sub-capabilities" → 47.
- **W5 — env vars under-specified.** Row 9 promises three; only `OL_MASTER_DELTA_LOOKBACK_SECONDS` is named. The
  descriptor needs `enabledEnvVar` + `cronEnvVar`.

## Clean (checked, zero impact)

No ORM/migration (the watermark rides `connection_cursors` via the service). No Symbol tokens added or renamed.
No DTO break — `JobTypeValues` only *widens*, so `@IsIn(JobTypeValues)` at `enqueue-sync-job.dto.ts:26` accepts a
superset. No `Record<JobType,…>` or exhaustive `switch` keyed by `JobType` anywhere. `products/index.ts` is purely
additive. `check-service-interfaces` untouched. `check-cross-context-imports` fine — `ALLOW_PATTERNS` includes
`/^is[A-Z][A-Za-z]+$/` (`:524`) and `ModifiedSinceLister` default-allows at `classifyName` (`:595`).
`check-workspace-dep-declarations` fine — the WooCommerce package already declares `@openlinker/core`.

## Concurrence on the plan's own open question 1

The gate **concurs with a separate job type**: `sweepCursorKey`'s per-kind namespacing, the distinct cadence, and
#2222's full-pass-only prune all argue against a shared handler carrying a permanent prune guard.
