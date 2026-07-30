# Implementation Plan - Monotonic `webhook_deliveries.status` (#1916)

## 1. Understand the task

**Goal.** `webhook_deliveries.status` must never move backwards. Two decoupled
writers stamp the same row via `WebhookDeliveryRepository.upsert`, and the
`ON CONFLICT DO UPDATE` set-list assigns `"status" = EXCLUDED."status"`
unconditionally, so whoever writes *last* wins:

| Writer | Status written | Site |
|---|---|---|
| API ingress | `received` (insert), then `published` | `apps/api/src/webhooks/application/services/webhook.service.ts:167,220` |
| Stream consumer | `received` (test.* events), `job_enqueued`, `deadlettered` | `apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts:244,318,405` |

The consumer routinely wins the stream read before the API's follow-up write
lands, so `published` clobbers `job_enqueued` (and, in principle,
`deadlettered`). Result: a row with `status='published'` **and** a populated
`downstreamJobId` - a state the lifecycle does not otherwise permit - plus a
red `main` pipeline (run 30435342214: `webhook-ingestion.int-spec.ts:474`).

**Layer.** CORE - infrastructure/persistence (the SQL) + domain (the status
precedence policy).

**Non-goals.**
- Reordering the API's publish-then-record sequence. Recording `published`
  before publishing would misreport a failed publish, and the failure path
  (`webhook.service.ts:233+`) already deletes the row.
- Any schema change or migration. The column already stores every value in the
  union; only the conflict-resolution expression changes.
- Making non-status overlay columns non-regressing. `publishedMessageId` and
  `downstreamJobId` each have exactly one writer.
- Touching either caller. The guard must hold for every writer without a caller
  knowing about the other.

## 2. Research

- `WebhookDeliveryRepository.upsert`
  (`libs/core/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts:43-111`)
  builds a raw parameterized `INSERT ... ON CONFLICT DO UPDATE`. The raw-SQL
  approach is deliberate (header comment `:84-91`, #1511: TypeORM's lazy
  `InsertQueryBuilder` require resolves to `undefined` under jest's module
  sandbox from the long-lived consumer loop). Keep it - do not reintroduce
  `QueryBuilder.insert()`.
- The set-list is derived from `Object.keys(overlay)`, i.e. only
  caller-supplied columns are refreshed. `status` enters the overlay at `:66`.
- `WebhookDeliveryStatusValues` (`libs/core/src/webhooks/domain/types/webhook-delivery.types.ts:11-19`)
  is the `as const` union - the single source of truth for the status vocabulary.
- No consumer keys off the transient `published` state: the FE badge map
  (`apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx:27-34`)
  and the nav counter (`apps/web/src/app/hooks/use-nav-counts.ts`) read the
  status only for display / attention counting.
- `rejected` and `failed` have no writer today (auth-rejected deliveries throw
  before any row is written - ADR-005 dedup-gate invariant, #1814); they are
  ranked for forward-compatibility.

## 3. Design

Add a **rank ladder** next to the status union and resolve the conflict against
it, so a lower-ranked write is discarded:

```
received (0) -> published (1) -> job_enqueued (2) -> {deadlettered, failed, rejected} (3, sticky)
```

- `WEBHOOK_DELIVERY_STATUS_RANK: Record<WebhookDeliveryStatus, number>` lives in
  `webhook-delivery.types.ts`, beside `WebhookDeliveryStatusValues`, so the SQL
  and the union cannot drift.
- The repository derives the guard SQL **from that map** (no hand-written
  literal ladder). The emitted fragment:

  ```sql
  "status" = CASE
    WHEN (CASE EXCLUDED."status" WHEN 'received' THEN 0 ... ELSE -1 END)
       >= (CASE webhook_deliveries."status" WHEN 'received' THEN 0 ... ELSE -1 END)
    THEN EXCLUDED."status"
    ELSE webhook_deliveries."status"
  END
  ```

  `ELSE -1` on both sides is the defensive branch: an unrecognised value already
  in the column ranks below every known status, so it can always be advanced out
  of (a row can never wedge), while an unrecognised incoming value loses to any
  known current value.
- `>=` (not `>`) so re-writing the same status still refreshes `updatedAt` and
  any sibling overlay columns.
- Status literals are interpolated from our own `as const` array, never from
  user input; a module-load assertion pins them to `/^[a-z_]+$/` so the fragment
  can never carry anything quote-worthy. Every *value* in the statement stays a
  bound parameter, as today.

**Consequence to accept deliberately:** a `test.*` event settles at `published`
instead of `received`. The consumer's `status: 'received'` write for test pings
(`webhook-to-job.handler.ts:244`) is itself a regression - the event *was*
received and published, it just produces no job - and no consumer distinguishes
the two for test pings (`waitForTestPing`-style reads key on `eventType`, not
status).

## 4. Steps

1. **`libs/core/src/webhooks/domain/types/webhook-delivery.types.ts`** - add
   `WEBHOOK_DELIVERY_STATUS_RANK` with a doc comment naming the ladder and why
   the terminal states are sticky.
   *AC:* exhaustive `Record<WebhookDeliveryStatus, number>` (a new union member
   fails type-check until ranked).
2. **`libs/core/src/webhooks/index.ts`** - confirm the barrel already re-exports
   the types module (`export * from './domain/types/webhook-delivery.types'`);
   add only if missing.
   *AC:* `WEBHOOK_DELIVERY_STATUS_RANK` importable from `@openlinker/core/webhooks`.
3. **`.../repositories/webhook-delivery.repository.ts`** - build the guarded
   assignment from the rank map and substitute it for the plain
   `"status" = EXCLUDED."status"` entry in the set-list; keep every other
   overlay column last-write-wins. Comment *why* (the two-writer race), not what.
   *AC:* the generated set-list contains the CASE guard exactly once and no bare
   `"status" = EXCLUDED."status"`.
4. **Unit spec** `libs/core/src/webhooks/infrastructure/persistence/repositories/__tests__/webhook-delivery.repository.spec.ts`
   - drive `upsert` with a mocked TypeORM repository and assert the emitted SQL:
   the guard is present, every status in the union appears in both rank CASEs
   (drift test), and sibling overlay columns keep plain `EXCLUDED` assignment.
   *AC:* fails if the ladder and the union drift, or if the guard is dropped.
5. **Integration spec** `apps/api/test/integration/webhook-delivery-status-monotonic.int-spec.ts`
   - real Postgres via the shared harness; resolve the repository from the Nest
   container by token and exercise both race orderings plus the sticky-terminal
   cases against actual SQL.
   *AC:* worker-then-API leaves `job_enqueued`; API-then-worker also reaches
   `job_enqueued`; `published`/`job_enqueued` cannot overwrite `deadlettered`;
   a later write still stores `downstreamJobId` (non-status columns unaffected).
6. **Quality gate** - `pnpm lint`, `pnpm type-check`, `pnpm test`, plus the two
   webhook int-specs (`webhook-ingestion`, the new one).

## 5. Validation

- **Architecture:** SQL stays in infrastructure; the precedence policy is a pure
  domain constant. No new port, service, token, or module. Dependency direction
  untouched.
- **Naming:** `UPPER_SNAKE_CASE` const in a `*.types.ts` file; `*.spec.ts` unit
  spec under `__tests__/`; `*.int-spec.ts` integration spec in
  `apps/api/test/integration/`.
- **Testing:** the guard lives in SQL, so a mocked repository alone cannot prove
  it - hence the paired unit (fragment/drift) + integration (semantics) specs.
- **Security:** no user input reaches the SQL text; values stay parameterized.
- **Migration:** none (no schema change) - `migration:show` unchanged.
