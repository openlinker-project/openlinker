# Implementation Plan: Schedule the PrestaShop order poll as the reconciliation backstop (#904)

**Date**: 2026-05-31
**Status**: Ready for Review
**Estimated Effort**: ~half day
**Issue**: #904 (Phase 3 of epic #900). Prereqs #902 / #903 / #906 / #909 all merged.

---

## 1. Task Summary

**Objective**: Add a periodic PrestaShop **order poll** as the reconciliation backstop that heals missed/dropped webhooks. Webhooks (Phases 1–2) are the low-latency primary path; the poll is the slow, idempotent safety net.

**Context (grounded)**: PrestaShop registers only `prestashop-fulfillment-status-sync` today — **no** order poll. Allegro registers `allegro-orders-poll` (every 5 min). The `PrestashopOrderSourceAdapter` + the `marketplace.orders.poll` job already exist and work over the `date_upd` watermark cursor — they're simply never scheduled. The poll handler reads `cursorKey` from the payload (`orders-poll.handler.ts`), so the scheduler task chooses the cursor key.

**Classification**: Integration (PrestaShop plugin scheduler-task registration). No CORE change, no new job type, no schema, no migration.

---

## 2. Scope & Non-Goals

### In Scope
- Register a `prestashop-orders-poll` `SchedulerTaskConfig` in `buildPrestashopSchedulerTasks()`, enqueuing the existing `marketplace.orders.poll` job (mirror Allegro's `allegro-orders-poll`).
- Relaxed, **env-configurable** cadence (default every 10 min — backstop, not workhorse) + env gate + page limit.
- Unit test on the task config + a convergence assertion that webhook + poll for the same order produce exactly one ingested order.
- Document the webhook-primary / poll-backstop posture + the new env vars.

### Out of Scope
- Any change to `PrestashopOrderSourceAdapter`, the `marketplace.orders.poll` handler, or `OrderIngestionService` — all already work.
- The idempotency mechanism itself — already shipped (#906 lock, #909 core update-or-create). This PR only *relies* on it.
- New job type / schema / migration.

### Constraints
- Mirror the established `SchedulerTaskConfig` + `OL_<PLATFORM>_*` env conventions exactly (Allegro `orders-poll` is the reference).
- No regression to the existing `prestashop-fulfillment-status-sync` task.

---

## 3. Design

**Single new task** in `libs/integrations/prestashop/src/infrastructure/scheduler/prestashop-scheduler-tasks.ts`, appended to the returned list, env-gated:

| Field | Value |
|---|---|
| `taskId` | `'prestashop-orders-poll'` |
| `platformType` | `'prestashop'` |
| `jobType` | `'marketplace.orders.poll'` |
| `cronExpression` | env `OL_PRESTASHOP_POLL_INTERVAL_CRON`, default `'0 */10 * * * *'` (every 10 min; 6-field to match the PS file's existing style) |
| `enabledEnvVar` | `'OL_PRESTASHOP_POLL_SCHEDULER_ENABLED'` (default enabled; re-checked each tick) |
| `generatePayload` | `{ schemaVersion: 1, cursorKey: 'prestashop.orders.dateUpd', limit: <pageLimit> }` `satisfies MarketplaceOrdersPollPayloadV1` |
| `generateIdempotencyKey` | `` `marketplace:${connection.id}:orders:poll:${timestamp}` `` (same shape as Allegro) |

- **Page limit** env-configurable: `OL_PRESTASHOP_POLL_PAGE_LIMIT` (default 100), parsed defensively like the fulfillment task's `pageLimit`.
- **Cursor key `prestashop.orders.dateUpd`** — verified free (no existing PS-orders cursor key in the repo). Per-`(connectionId, cursorKey)` storage; the poll handler + ingestion read/write the `date_upd` watermark under it.
- **No new wiring**: the task plugs into the same `SchedulerTaskRegistryService` machinery the fulfillment task already uses (registered via `createPrestashopPlugin().register(host)` → scheduler service cron-schedules it). Plugs in at boot wherever the scheduler runs.

### Convergence (acceptance #2)
Both trigger paths terminate at the **idempotent** `OrderIngestionService.syncOrderFromSource`:
- **Webhook** (#902/#903): `marketplace.order.sync` → `syncOrderFromSource`.
- **Poll** (this PR): `marketplace.orders.poll` → ingestion enqueues one `marketplace.order.sync` per feed item → `syncOrderFromSource`.

`syncOrderFromSource` resolves the existing destination order mapping and update-or-creates (#909), serialized by the per-order create lock (#906) — so a webhook-ingested order is **not** re-created by a later poll. This guarantee is pre-existing and already unit-tested in `orders`; this PR does not add idempotency code, only a test that asserts the convergence (see §5).

---

## 4. Questions & Assumptions
- **A1**: Cadence default 10 min (`0 */10 * * * *`). Backstop, not primary — relaxed to limit PS WS load. Tunable via `OL_PRESTASHOP_POLL_INTERVAL_CRON`.
- **A2**: `cursorKey: 'prestashop.orders.dateUpd'` — new constant; verified no collision. The poll path is cursor-safe (advances only after successful enqueue — existing `OrderIngestionService.ingestOrders` behavior).
- **A3**: Page limit 100 default (matches Allegro). Env `OL_PRESTASHOP_POLL_PAGE_LIMIT`.
- **A4**: No `eventTypes` filter on the payload (poll ingests all order changes — the backstop should be comprehensive). `MarketplaceOrdersPollPayloadV1.eventTypes` is optional; omitted.

---

## 5. Implementation Plan

### Phase A — register the task
1. `prestashop-scheduler-tasks.ts` — append the `prestashop-orders-poll` task (table in §3), env-gated by `OL_PRESTASHOP_POLL_SCHEDULER_ENABLED`. Update the file-header JSDoc: now two tasks; add the webhook-primary / poll-backstop posture note + the three new env vars.

### Phase B — tests
2. **New** `__tests__/prestashop-scheduler-tasks.spec.ts` (mirror `allegro-scheduler-tasks.spec.ts`):
   - orders-poll task present by default; `platformType='prestashop'`, `jobType='marketplace.orders.poll'`.
   - `generatePayload()` → `{ schemaVersion:1, cursorKey:'prestashop.orders.dateUpd', limit:100 }`; idempotency-key shape.
   - `OL_PRESTASHOP_POLL_SCHEDULER_ENABLED=false` → task omitted.
   - `OL_PRESTASHOP_POLL_INTERVAL_CRON` / `_PAGE_LIMIT` overrides honored.
   - regression: `prestashop-fulfillment-status-sync` still present.
3. **Convergence test**: locate the existing #906/#909 idempotency coverage in `orders`. If it already asserts "repeated `syncOrderFromSource` for the same external order → single destination create", extend its description to name the webhook+poll convergence (no duplicate logic). If not cleanly covered, add a focused unit test on `OrderIngestionService` / `OrderSyncService`: two `syncOrderFromSource` calls for the same `externalOrderId` → `createOrder` invoked once (second resolves the existing mapping). **Decision to confirm**: extend-existing vs add-new (see §7).

### Phase C — docs
4. Document the env vars + posture: the PS scheduler-tasks file header (primary doc) + a one-line note in `docs/architecture-overview.md` § Webhook Ingestion Flow / Order Sync data-flow (webhook = trigger, poll = reconciliation backstop).

### Phase D — quality gate
5. `pnpm lint && type-check && test`; then targeted `pnpm test:integration` for the PS/scheduler + orders slices (full suite if time allows, per the manifest-capability ripple lesson — though no manifest capability changes here).

---

## 6. Alternatives Considered
- **Schedule in core, not the plugin** — rejected: scheduler tasks are per-plugin contributions (`SchedulerTaskRegistryService`), and the cursor/feed are PS-specific. The plugin owns its poll cadence.
- **Aggressive cadence (5 min like Allegro)** — rejected for a *backstop*; webhooks are primary for PS, so a relaxed 10-min poll limits WS load while still healing misses promptly.
- **New `prestashop.orders.*` job type** — rejected: `marketplace.orders.poll` already handles PS via the cursor key.

---

## 7. Risks
- **Double-ingest** — mitigated by #906 + #909 (idempotent `syncOrderFromSource`); asserted by the convergence test.
- **Cursor key choice** — `prestashop.orders.dateUpd` must be the *only* key used for PS order polling. Verified no other usage; the scheduler task is the sole producer.
- **WS load** — relaxed cadence + page limit cap it; both env-tunable.
- **Convergence-test placement** (open decision §5.3) — extend existing idempotency spec vs add a new focused one. Default: **extend existing** if it cleanly covers the repeated-call case (avoids duplicate coverage); else add a thin new unit test. Confirm before implementing.

---

## 8. Acceptance Criteria (#904)
- [ ] PrestaShop orders ingest automatically with no manual job enqueue, even if a webhook is missed (task registered + scheduled).
- [ ] Webhook + poll for the same order → exactly one ingested order (convergence test).
- [ ] Cadence + page limit env-configurable; posture documented.
- [ ] `prestashop-fulfillment-status-sync` unaffected.
- [ ] `pnpm lint && type-check && test` green; targeted integration green.

---

## 9. Alignment Checklist
- [x] Integration-layer only; mirrors the `SchedulerTaskConfig` + `OL_<PLATFORM>_*` conventions.
- [x] Reuses existing job + payload type + cursor mechanics (no new taxonomy).
- [x] Idempotency relied upon (#906/#909), asserted by test.
- [x] Env-configurable + documented.
- [x] No schema / migration.

---

## Related
- Epic #900 (final phase); ADR-015 (webhook = trigger, poll = truth). Prereqs #902, #903, #906, #909.
