# #711 — Tighten webhook replay window + Postgres-authoritative dedupe

Closes #711 (Security / HIGH).

## 1. Goal

Two interlocking security tightenings to close the replay-attack surface on inbound webhooks:

1. **Narrow the timestamp replay window** from the current ±5 min default to a configurable bounded value (default **120s**, clamped `[1s, 300s]` via `OL_WEBHOOK_SKEW_WINDOW_MS`).
2. **Make Postgres the authoritative dedup gate** using the already-present `UNIQUE (provider, connectionId, eventId)` constraint on `webhook_deliveries`. Adds Postgres as the **outer gate** before the existing Redis dedup. A captured-and-replayed webhook within the window is rejected by the durable constraint, not by an ephemeral Redis key.

## 2. Layer classification

- Backend / Application (`apps/api/src/webhooks/`).
- CORE port surface (`libs/core/src/webhooks/`).
- No FE, no migration (the table + unique constraint already exist from migration `1782000000000`).

## 3. Current state — what's there, what's missing

**Already present** (no change needed):
- `webhook_deliveries` table with `UNIQUE (provider, connectionId, eventId)` — migration `1782000000000-add-webhook-deliveries.ts:28`.
- `WebhookDeliveryRepositoryPort.upsert(...)` for audit-trail rows.
- `WebhookDedupService` (Redis-backed two-phase markProcessing → markDone).
- `WebhookAuthService.validateTimestamp(timestamp, skewWindowMs)` — the `skewWindowMs` parameter is plumbed, just defaults to 5 min.
- `webhook-ingestion.int-spec.ts` (the test scaffold).

**The gap**:
- `WebhookAuthService.DEFAULT_SKEW_WINDOW_MS = 5 * 60 * 1000` (`webhook-auth.service.ts:25`) — too loose.
- The Postgres unique constraint is enforced but **its dedup signal is unused**. Dedup decisions are made by Redis, which is correct today but ephemeral — a Redis flush/restart/blip can let a replay through even though the Postgres row would have caught it.
- `WebhookDeliveryRepositoryPort` has no `insertIfNew` method — every `upsert` call silently updates rather than signalling whether the row was newly created.

## 4. Design

### 4.1 Timestamp window

- New env var `OL_WEBHOOK_SKEW_WINDOW_MS`, parsed at service construction time.
- Default: `120_000` (120 s). Note: chose 120s over the issue's "≤60s" wording because the OSS-launch deployment topology is unknowable — operators self-hosting OL with PrestaShop on a different cloud, behind a load balancer, with NTP drift can plausibly see 5-30s of skew before they notice. Starting too tight breaks legitimate webhooks at deploy time with a non-obvious failure mode (401s, no root cause). 120s is still a 2.5x reduction in the replay surface (5 min → 2 min), and the env knob lets operators tighten to 60s when their topology is stable.
- Hard upper cap: `300_000` (300 s); values above clamp with `Logger.warn` at boot.
- Lower clamp: `1_000` (1 s); below would reject legitimate clock skew.
- `WebhookAuthService.validateTimestamp` continues to accept `skewWindowMs?: number` as an override (used in unit tests). Default is the new bounded env-driven value.

### 4.2 Postgres-authoritative dedup — keep Redis as the inner gate

**Why keep Redis** (revised from earlier draft, which proposed removing it):
- A Security/HIGH PR should minimise blast radius. Keeping `WebhookDedupService` reduces the diff substantially — the change becomes "add a gate" rather than "swap a gate".
- Redis remains correct under normal operation. Replacing it has rollout risk that isn't worth taking in the same PR as the window-tightening.
- Architectural cleanup (removing Redis dedup once Postgres is proven) tracked as a follow-up — see §7.

**New port method** on `WebhookDeliveryRepositoryPort`:

```typescript
/**
 * Attempts to insert a new webhook-delivery row keyed on
 * (provider, connectionId, eventId). Returns `{ isNew: false }` if the
 * row already exists (a replay — the existing delivery is returned for
 * the audit trail). Used by `WebhookService.processWebhook` as the
 * outer dedup gate (authoritative; Redis remains as the inner gate).
 */
insertIfNew(input: WebhookDeliveryUpsertInput): Promise<
  | { isNew: true; delivery: WebhookDelivery }
  | { isNew: false; existing: WebhookDelivery }
>;

/**
 * Deletes a webhook-delivery row by event-key. Called when downstream
 * publishing fails after `insertIfNew` succeeded — the source can
 * retry, the next attempt's `insertIfNew` will succeed again.
 */
deleteByEventKey(provider: string, connectionId: string, eventId: string): Promise<void>;
```

**Implementation** in `WebhookDeliveryRepository`:

```sql
-- insertIfNew
INSERT INTO webhook_deliveries (...)
VALUES (...)
ON CONFLICT (provider, connectionId, eventId) DO NOTHING
RETURNING *;

-- deleteByEventKey
DELETE FROM webhook_deliveries
WHERE provider = $1 AND connection_id = $2 AND event_id = $3;
```

TypeORM idiom: `queryBuilder.insert().orIgnore().returning('*').execute()` for `insertIfNew`. Empty `RETURNING` set → conflict → `findOne` returns the existing row.

### 4.3 New `WebhookService.processWebhook` flow

```
1. Validate timestamp (120s default).                  // fail → 401, no row
2. Verify signature (HMAC).                             // fail → 401, no row (audit lives in logs — see §4.5)
3. insertIfNew(row with status='received').             // !isNew → 202 silent (replay)
4. dedupService.markProcessing() in Redis.              // !isNew → 202 silent (replay caught by inner gate)
5. Publish event to event bus.
6. UPDATE row to status='published'.
7. dedupService.markDone() in Redis.

On step 5 failure (publish error):
  - dedupService.clearProcessing() in Redis            (mirrors current behaviour).
  - deleteByEventKey() in Postgres                     (NEW — closes the failure-recovery gap).
  - rethrow → 5xx → source can retry.
```

**Critical: failure-recovery semantics.** The earlier draft proposed leaving failed rows in `status='failed'`, which would have blocked all source-side retries via the unique constraint — a regression from the current Redis behaviour. The revised flow DELETES the row on publish failure, identical to `Redis.clearProcessing()` semantics. The next retry hits `insertIfNew` cleanly. Failed-publish audit lives in the logs (`Logger.error` at the publish call site, which already exists).

Replay semantics:
- Same `(provider, connectionId, eventId)` within the 120s window → step 3 returns `isNew=false` → **202** returned with no further work. (HTTP status matches current code, which uses `HttpStatus.ACCEPTED`.)
- Same triple outside the window → step 1 fails first → 401.
- Same triple after a publish failure → previous DELETE means step 3 returns `isNew=true` → retry proceeds.

### 4.4 Drop the failed-validation `recordDelivery` calls

Today's `WebhookService.processWebhook` records rows with `status='rejected'` after signature/timestamp validation failures (`webhook.service.ts:80-84, 92-96, 108-114, 129-134`). Under the new gating model where the unique constraint is the authoritative dedup gate, **a row inserted with `status='rejected'` would block any future legitimate retry of the same eventId** — a regression.

Resolution: failed-validation paths skip the row insert. They `Logger.warn` (which already happens) and throw. Operators querying for security events can grep the logs.

**Trade-off**: the `/webhooks/deliveries` admin endpoint loses visibility into rejected-validation attempts. For OSS launch this is acceptable; a structured "webhook security events" view is a follow-up if needed (see §7).

### 4.5 Concurrency

Two concurrent webhooks with the same `(provider, connectionId, eventId)` arrive simultaneously: both reach step 3, both attempt `INSERT ... ON CONFLICT DO NOTHING`. Postgres guarantees exactly one succeeds; the loser gets the empty `RETURNING` set and returns 202. No race, no double-publish.

If the winner fails at step 5 and DELETEs its row while the loser is mid-202-return: the loser already returned 202 with no work. The downstream consumer expects "at most one publish per eventId" — that contract holds (zero publishes in this edge case). The source's next retry will hit a clean slate and republish.

## 5. Implementation steps

| # | File | Action |
|---|------|--------|
| 1 | `libs/core/src/webhooks/domain/ports/webhook-delivery-repository.port.ts` | Add `insertIfNew(input)` and `deleteByEventKey(provider, connectionId, eventId)` to the port interface |
| 2 | `libs/core/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts` | Implement both new methods; `insertIfNew` via `INSERT ... ON CONFLICT DO NOTHING RETURNING *` with `findOne` fallback on conflict |
| 3 | `apps/api/src/webhooks/application/services/webhook-auth.service.ts` | Read `OL_WEBHOOK_SKEW_WINDOW_MS` env, clamp `[1_000, 300_000]`, default `120_000`. `Logger.warn` if input clamped at boot |
| 4 | `apps/api/src/webhooks/application/services/webhook.service.ts` | New flow per §4.3: insertIfNew (outer gate) before existing markProcessing (inner gate); DELETE row on publish failure; drop the failed-validation `recordDelivery` calls per §4.4 |
| 5 | `apps/api/src/webhooks/application/services/webhook-auth.service.spec.ts` | Add cases for the new default + env override + clamps |
| 6 | `apps/api/src/webhooks/application/services/webhook.service.spec.ts` (if exists) / new | Cases: (a) new event proceeds, (b) replay returns 202 silent without publishing, (c) publish failure deletes the row, (d) old timestamp throws before insert |
| 7 | `apps/api/test/integration/webhook-ingestion.int-spec.ts` | Add **replay test**: post same signed payload 3× within 5s → assert all 3 return 202, `webhook_deliveries` row count = 1, downstream message-publish count = 1. Add **stale-timestamp test**: post with `timestamp = now - 180_000` → assert 401, row count = 0. Add **failure-recovery test**: stub event publisher to throw → assert row deleted, subsequent retry succeeds |
| 8 | `docs/architecture-overview.md` § Webhook Ingestion Flow | Update to describe the two-gate (Postgres outer, Redis inner) model + 120s default window + env knob |
| 9 | quality gate | `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` |

Estimated diff: ~150 LoC added (new port methods + service refactor + tests + doc edit), ~30 LoC removed (failed-validation audit-row inserts). Net: ~120 LoC.

## 6. Validation

### 6.1 Architecture compliance
- New methods on the existing `WebhookDeliveryRepositoryPort` — no new port introduced.
- `WebhookService` continues to depend on the port via `@Inject(WEBHOOK_DELIVERY_REPOSITORY_TOKEN)`, not the concrete class.
- ORM-side changes stay in `infrastructure/persistence/repositories/`.
- No framework imports leak into `domain/`.
- `WebhookDedupService` untouched — hexagonal boundaries preserved.

### 6.2 Engineering standards
- File-header on all new/modified files.
- No `any`; use `unknown` + narrowing for TypeORM's `orIgnore` return shape.
- Service / port naming unchanged.
- Existing test-mocking strategy preserved (mock the port, not the concrete repo).

### 6.3 Tests
- Unit: cover every new branch in `WebhookService` — new event, replay (Postgres conflict), replay (Redis-only conflict via the existing markProcessing path), publish-failure (DELETE row + clearProcessing), stale timestamp (no row inserted).
- Integration: the four AC cases from the issue (3-replay → 1 row + 1 message; stale-timestamp → 0 rows; failure-recovery — and an explicit assertion that all three replays return 202, not 200).

### 6.4 Security
- **Window tightening**: documented threat-model — every second of window is a second of replay surface, but starting too tight breaks legitimate webhooks. 120s is the conservative midpoint with env-tunability for hardened deployments.
- **Postgres dedup is durable** — closes the "Redis blip lets replay through" failure mode while Redis remains as an inner safety net.
- **No new secret-handling surface**.
- **No status-code drift**: replay returns 202 (matches current `HttpStatus.ACCEPTED` on the success path).

## 7. Out of scope (separate follow-ups)

- **Remove `WebhookDedupService` entirely** once Postgres dedup is proven in production. The Redis gate becomes redundant once the Postgres path is the authoritative source of truth; deleting it is a clean architectural simplification that can land independently with measurement to back the removal.
- **Nightly GC job** to delete `webhook_deliveries` rows older than 30 days (issue AC §4). Adds a worker handler + cron — substantial enough to be its own PR. The table grows ~K rows/day at MVP load, so not urgent for OSS launch.
- **PrestaShop module EventIdGenerator determinism test** (issue AC last item). PHP-side unit test, ideally in `apps/prestashop-module/openlinker/tests/`. Separate from the TS-side dedup work.
- **Rejected-attempt audit table** (compensates for §4.4's loss of `status='rejected'` rows). If operators need to query "show me all signature-verification failures", a dedicated `webhook_security_events` table without a unique constraint is the right shape. Not needed for MVP — log-based grep covers it.
- **Admin endpoint for retrying failed deliveries**. Not relevant under the DELETE-on-failure model (the source's retry handles it), but if a row somehow ends up stuck (e.g., between PUBLISH and the UPDATE-to-published), an admin path may help. Defer until observed.
- **Renaming `WebhookDeliveryUpsertInput` → reflect the new `insertIfNew` use**. Cosmetic; defer until the surface stabilises.
