# Implementation Plan — #2073 Surface a repeatedly-failing lifecycle relay

**Issue**: [#2073](https://github.com/openlinker-project/openlinker/issues/2073) — Shipping — surface a repeatedly-failing lifecycle relay instead of logging it forever
**Parent epic**: #1032 (closed)
**Branch**: `2073-surface-failing-lifecycle-relay`

---

## 1. Problem

`ShipmentStatusSyncService.relayWaybillToParticipants` claims the waybill relay
(`Shipment.waybillRelayedAt`), attempts it, and **releases the claim on any
transient participant failure** so a later poll tick retries. That retry
behaviour is correct and deliberate (#1947 documents the three-way trade-off in
place).

What is missing is the terminal case. The service's own comment names it:

```ts
// The poll job deliberately stays `succeeded` (the next tick retries), so
// this log line is the only observable signal — `error` level for triage.
```

A relay that fails on **every** tick produces one `logger.error` per tick
forever. The job reports `succeeded`, no counter moves, no column changes,
nothing is operator-visible — and the marketplace silently never learns the
order shipped, so the seller keeps being asked for a tracking number.

The *classification* already exists (#1947 split `unsupported` into the
structural `no-capability` and the transient `adapter-unresolved`). Only the
**surface** is missing.

---

## 2. The five design questions, answered

### Q1 — What is the grain?

**Per shipment**, on the `shipments` table. Five columns, all prefixed
`waybillRelay*`.

The issue's own assumption blesses this: *"Order-grain (per shipment)
escalation is enough. Per-participant attribution … is #861's job; a first
version can name the failing participant in the message without persisting
per-target state."*

**How this avoids pre-empting #861.** #861 is per-destination **notify state** —
durable per-target claim/retry state that the relay *branches on*, so a
permanently-broken destination stops re-driving the source. Nothing here is
that. Two properties make the separation structural rather than promised:

- The relay's control flow is **untouched**. `transientlyUnreached`, the
  release, the all-or-nothing retry — byte-identical. Adding these columns
  changes what an operator can *see*, never what the relay *does*.
- `waybillRelayLastFailureConnectionId` is a **display field with no reader
  that gates anything** — the #2100 discipline (*"a badge may render it, and no
  GATE may read it"*). It records which participant was first in the failing
  set on the last attempt, so the operator's banner can say *"failing to relay
  to Allegro-Main"* instead of *"failing to relay"*. It is not a set, it is not
  consulted on the next attempt, and no retry decision reads it. A spec asserts
  no production code branches on it.

When #861 lands its per-target model, these columns are the roll-up above it,
or they are deleted — either way #861 is unconstrained.

### Q2 — What makes it "repeatedly" failing?

**A count**, with timestamps as evidence beside it.

The escalation predicate is `waybillRelayFailureCount >= threshold` and nothing
else. A time-based predicate would be wrong: the poll cadence sets how many
attempts fit in an hour, so "stuck for 2 hours" means a different number of
failed attempts on every deployment, while "N consecutive attempts could not
tell the marketplace" is cadence-independent in exactly the right way.

`threshold` comes from `OL_WAYBILL_RELAY_FAILURE_ALERT_THRESHOLD`, default `3`,
**clamped to `[2, 100]`**. The lower clamp is the point: AC-4 ("a transient
single failure does not escalate") becomes structurally unreachable rather than
merely the default — an operator cannot set `1` and turn every blip into an
alarm.

`waybillRelayFirstFailedAt` / `waybillRelayLastFailedAt` are carried as
evidence (the #1814 shape) and are **not** in the predicate. `updatedAt` cannot
serve as `lastFailedAt` — it moves on every write to the row.

### Q3 — Does it self-clear?

**Yes, on a successful relay, and only on a successful relay.**
`clearWaybillRelayFailures(id)` is a narrow conditional write
(`WHERE id = :id AND "waybillRelayFailureCount" > 0`) called on the success
path. In the healthy case it matches zero rows and costs nothing.

**There is deliberately no time-based auto-clear, and this is where #1814 must
not be copied.** `webhook_auth_rejections` needs a 24-hour freshness window
because its counter is an unbounded rolling count over a connection's whole
life with no natural reset — so staleness is the only way it can ever go quiet.
This counter has an explicit reset on success. A freshness window here would
silence the alarm while the waybill still never reached the marketplace, which
is precisely the defect the issue is about.

**Named limitation.** A shipment that reaches a terminal status carrying a
standing count is never re-attempted (the scan skips terminal rows), so its
count freezes. For `delivered` that is correct and wanted — the parcel arrived
and the marketplace was never told. For `cancelled`/`failed` the relay is moot
and the row is mild noise; `waybillRelayLastFailedAt` is what tells the two
apart at a glance, and the operator has the existing status filter. Auto-
clearing on cancellation was rejected as machinery bought to suppress a signal.

### Q4 — Is the write best-effort?

**The increment needs no best-effort wrapper, and the reset does. The asymmetry
is the whole answer, not an oversight.**

- **Increment**: folded *into* `releaseWaybillRelay` as one statement
  (`count = count + 1`, `firstFailedAt = COALESCE(firstFailedAt, now)`,
  `lastFailedAt`, `reason`, `connectionId`). This adds **no new failure mode** —
  the release is already an un-caught `await` on both failure paths today, so
  one statement means one outcome, exactly as now. It also makes the accounting
  structurally complete: *you cannot release the claim without counting the
  failure*. `releaseWaybillRelay` has exactly two callers, both failure paths in
  `relayWaybillToParticipants` (verified by grep across `libs` + `apps`), so
  there is no third caller that would count a non-failure.
- **Reset**: a genuinely new write on the success path, so it gets the #1814
  treatment — `try/catch`, `logger.warn`, swallow. The relay has already
  succeeded and is durable; failing it because the bookkeeping failed would let
  the recording of a success destroy the success.

### Q5 — Is there an operator surface?

**Yes — a durable fact *and* a surface.** A field an operator can only find by
opening the right row is not "operator-visible"; the filter is what makes it a
bucket.

1. `ShipmentResponseDto.waybillRelay` — a nested block carrying the counter,
   the timestamps, the reason code, the participant, **and a backend-derived
   `stuck` boolean**.
2. `GET /shipments?waybillRelayStuck=true` — the needs-attention bucket.
3. `apps/web`: a `Relay stuck` badge on the `/shipments` row + an alert banner,
   both driven by the boolean.

**The backend derives `stuck`; the frontend renders it.** `apps/web` cannot
import `@openlinker/core` (#591), so a frontend-side threshold comparison would
be a mirror needing a `check:invariants` script. Shipping the boolean means
there is no shared rule to mirror at all — strictly better than a guarded
mirror.

**Not doing: `outcome: 'business_failure'` on the poll job.** The issue offers
it, and it is wrong here. Three reasons: the poll job is a page-sweep over many
shipments and one stuck relay is not the job's outcome (the other shipments
synced fine); ADR-007's `business_failure` means *do not retry a permanent
condition*, while this condition is fixed by a re-auth and **the retry is the
recovery** — the next tick must run; and `outcome` is a partitioning per-job
field, so forcing an orthogonal per-shipment state into it is exactly the trap
#2100 declined when it shipped a non-partitioning field instead of a sixth
`OrderHealth` bucket.

---

## 3. Scope

**In**: `ShipmentStatusSyncService`'s waybill relay only — the one relay in the
tree that retries forever and reports only to the log.

**Out, with reasons**:
- `ShipmentDispatchNotificationService` — operator-triggered, one-shot, and it
  *returns* per-target outcomes to its caller, which surfaces them in the
  dispatch response. The operator sees the failure immediately. It is not the
  "logs forever" shape.
- `FulfillmentDispatchRelayService` (#2401) — work-grain, `fulfillment` context,
  and its claim is released for recovery by a differently-keyed later event
  rather than by an unbounded poll. Out of this issue's stated file set.
- Per-participant retry, a relay event stream, a per-target obligation table —
  **#861**, which is owed its own ADR.

---

## 4. Phases

### Phase 1 — Vocabulary + pure rules (core, `shipping`)

`libs/core/src/shipping/domain/types/waybill-relay-failure.types.ts` — new. Uses
the pure-rule exception to "types only" (`engineering-standards.md`): pure, it
*is* the rule for the type it sits with, and both halves change together.

- `WaybillRelayFailureReasonValues = ['rejected', 'adapter-unresolved', 'threw'] as const`
  + `WaybillRelayFailureReason`. Closed vocabulary. `'threw'` is the pre-per-target
  case (identifier resolution blew up before the loop), which carries no participant.
- `readWaybillRelayFailureReason(value: unknown): WaybillRelayFailureReason | null` —
  read-coercion, so a value this build does not recognise reads as absent rather
  than being asserted (#2100).
- `WAYBILL_RELAY_ALERT_THRESHOLD_DEFAULT = 3`, `_MIN = 2`, `_MAX = 100`.
- `resolveWaybillRelayAlertThreshold(raw: string | undefined): number` — pure,
  clamped; a non-numeric / non-finite value falls back to the default.
- `isWaybillRelayStuck(count: number, threshold: number): boolean`.
- `WaybillRelayFailure` — the readonly value object the entity carries.

**One resolver, every consumer.** The DTO derivation and the filter translation
both call `resolveWaybillRelayAlertThreshold` + `isWaybillRelayStuck`; the raw
constant is not exported, so a third call site cannot reopen a
reported-vs-enforced gap (#2229's rule).

### Phase 2 — Persistence

- `ShipmentOrmEntity`: five columns. `waybillRelayFailureCount` `int NOT NULL
  DEFAULT 0`; `waybillRelayFirstFailedAt` / `waybillRelayLastFailedAt`
  `timestamp NULL` (matching **every other timestamp on this table** — not
  `timestamptz`, which #1814's own table uses; consistency within the table
  wins and `synchronize` must agree with the migration);
  `waybillRelayLastFailureReason` `text NULL`;
  `waybillRelayLastFailureConnectionId` `uuid NULL`.
- Class-level `@Check('CHK_shipments_waybill_relay_failure_count', '"waybillRelayFailureCount" >= 0')`
  — declared on the entity **and** in the migration under the identical name,
  because the integration harness builds schema by `synchronize` and a
  migration-only constraint holds in production and silently not in tests.
- Class-level partial index
  `IDX_shipments_waybill_relay_failing` on `(waybillRelayLastFailedAt)`
  `WHERE "waybillRelayFailureCount" > 0`. The entity's existing comment warns
  that a partial predicate over a *mutable* column makes rows enter and leave
  the index on ordinary updates — that warning is about `status`, which changes
  over every shipment's life. This column moves only on a relay outcome, which
  is rare, and every row starts outside the index (default `0`), so the index is
  near-empty in steady state and shrinks as relays succeed. The comment will say
  so rather than leave the next reader to rediscover the tension.
- `Shipment` domain entity: **one** trailing constructor parameter,
  `waybillRelayFailure: WaybillRelayFailure | null` — not five positional ones,
  which would be five same-typed slots to misplace in a 24-parameter
  constructor. `null` means "no failures recorded" (count 0); that is the single
  representation of healthy.
- `ShipmentRepositoryPort`:
  - `releaseWaybillRelay(id, failure: RecordWaybillRelayFailureInput)` — the
    signature grows a **required** argument. Required, not optional: an
    omitted failure record is a silent decline, and there is no caller that
    legitimately releases without failing.
  - `clearWaybillRelayFailures(id): Promise<void>` — new.
  - `ShipmentFilters.waybillRelayFailureCountAtLeast?: number` — the repository
    filters on a **number**, never on the word "stuck". The policy (which number
    means stuck) stays in the one resolver above; the repository has no business
    reading env.
- `UpdateShipmentInput` gains **nothing**, so the ordinary patch path
  structurally cannot stomp these columns (`update()` writes only the fields
  present on the patch).

### Phase 3 — Migration

`apps/api/src/migrations/1876000000000-add-shipment-waybill-relay-failure-tracking.ts`
(watermark is `1875000002000`; new batch → `+1_000_000_000`).

- `up()`: five `ADD COLUMN`s, the named CHECK, the named partial index.
  `waybillRelayFailureCount` lands `NOT NULL DEFAULT 0` and **keeps** the
  default — unlike #2373's `direction`, which drops its default so an insert
  that fails to state a value fails loudly. The opposite is right here: `0` is
  the true and permanent meaning of "this shipment has had no relay failure",
  every existing row genuinely has none, and every future insert wants it.
- `down()`: drop index, drop constraint, drop the five columns.

### Phase 4 — Service wiring

`ShipmentStatusSyncService.relayWaybillToParticipants`:
- throw path → `releaseWaybillRelay(id, {reason: 'threw', connectionId: null})`
- transient path → `releaseWaybillRelay(id, {reason, connectionId})` from the
  **first** member of `transientlyUnreached` (`rejected` → `'rejected'`;
  `unsupported/adapter-unresolved` → `'adapter-unresolved'`). Every target is
  still logged individually — the log keeps full attribution, the column
  carries one for display.
- success path → `clearWaybillRelayFailures(id)`, best-effort.
- **`detail` is never persisted.** Only the closed reason code and the
  connection id reach the column. An adapter's free-text detail can carry a
  host, a port or a credential fragment (#2341's rule: the code is returned,
  the message is logged) — and this column reaches a browser, a wider audience
  than a server log. The log line is unchanged and still carries `detail`.

### Phase 5 — Read surface (API + FE)

- `ShipmentQueryService` / controller: `waybillRelayStuck=true` →
  `waybillRelayFailureCountAtLeast: resolveWaybillRelayAlertThreshold(...)`, in
  **one** seam so curl and the UI agree.
- `ShipmentResponseDto.waybillRelay: WaybillRelayResponseDto | null` with
  `{ failureCount, stuck, firstFailedAt, lastFailedAt, lastFailureReason,
  lastFailureConnectionId }`. No new role gating: the reason is a closed
  vocabulary and the connection id is already on the row unconditionally —
  neither is the carrier free-text `errorMessage` that #1826 redacts for a
  `viewer`.
- `apps/web`: mirror the type, render a `Relay stuck` badge in the row's status
  group — **beside** the severity word, never folded into it, because
  `deriveSeverityLabel` is a partition and a stuck relay is orthogonal (a
  `delivered` shipment can carry one). A page-local alert links to the filter.

### Phase 6 — Tests

- Unit (pure): threshold clamping incl. the `1 → 2` floor; reason coercion;
  `isWaybillRelayStuck` boundary.
- Unit (service): increment on transient failure, increment on throw, clear on
  success, clear is best-effort (a throwing clear does not fail the relay),
  reason/connection selection.
- Unit (FE): badge renders on `stuck`, absent otherwise.
- Integration: N failures make the row visible through
  `?waybillRelayStuck=true` and invisible below the threshold; a success clears
  it; the CHECK constraint exists and refuses a negative count (this is what
  covers the `synchronize` side of the entity/migration parity requirement).

---

## 5. Readiness gate (`/pre-implement`) — findings applied

Verdict: **NEEDS-REVISION → revisions applied → READY.** Two Critical-by-pattern
items, both contained; five Warnings, all folded in above and restated here.

**Reuse audit — everything proposed is genuinely NEW.** Grep for `failureCount` /
`attemptCount` / `retryCount` / `relayFailure` / `notifyState` / `notifiedAt` /
`lastFailedAt` / `consecutiveFailures` across `libs/core/src/shipping` and
`libs/core/src/orders` returns **zero hits**: no counter of any kind exists.
`deriveRetryabilityClass` is adjacent prior art but classifies a rejection *code*
with no counter and no lifecycle — a different question, no reuse available.

**C1 — `releaseWaybillRelay` gains a required argument.** Measured blast radius:
1 implementer, 2 production callers, 3 `toHaveBeenCalledWith(s.id)` assertions,
1 repository-spec call = **7 real edits**. Bare `jest.fn()` doubles in 7 other
specs are structurally typed and do not break. No plugin can implement a
repository port (`check-cross-context-imports.mjs` bans the import outright), so
there is no out-of-tree implementer. **Keep the required argument** — an optional
one is a silent decline, and the 3 breaking assertions are exactly the tests that
must now pin the failure record.

**C2 — the `Shipment` constructor parameter costs 12 files.** There is **no shared
`Shipment` fixture**; 11 specs each hand-roll a private `makeShipment`. This makes
the plan's single-value-object parameter evidence-backed rather than stylistic:
five positional params would be ~60 edits across 12 hand-rolled helpers with five
same-typed nullable slots to misplace. The entity's own convention comment mandates
append-at-the-end / no-default / required, so 12 edits is the house price.
**Not fixed here**: extracting a shared fixture is a cross-cutting refactor of 11
unrelated specs and belongs in its own change.

**W1 — the threshold must have exactly ONE reader per request.** The filter
translation (controller) and the `stuck` derivation (`ShipmentResponseDto`) are
two different places; reading env in both is the reported-vs-enforced gap #2229
exists to prevent. **Resolve once in the controller and pass it into `fromDomain`
as a REQUIRED argument**, exactly as `canWrite` already is. The DTO reads no env.

**W2 — migration timestamp verified.** Global tail across `apps/api/src/migrations`
*and* both plugin dirs in `scripts/plugin-migration-dirs.json` is `1875000002000`,
so `1876000000000` clears it and satisfies all three rules
`check-migration-timestamps.mjs` enforces.

**W3 — column type verified against the table, not the #1814 precedent.**
`1832000000007` adds `"waybillRelayedAt" TIMESTAMP` (no time zone) with a
`{ type: 'timestamp' }` decorator. The repo is mixed, so copying
`webhook_auth_rejections`' `timestamptz` would have diverged the two schema
sources for this table. Plain `timestamp`, quoted camelCase columns.

**W4 — the insert must not depend on a database default alone** (`lessons.md`,
out-of-band-UPDATE entry, trap 2 — a `synchronize`-built schema takes the default
from the DECORATOR). Three layers: assign `0` explicitly in `buildOrmEntity`,
declare `default: 0` on the `@Column`, and `NOT NULL DEFAULT 0` in the migration.
The write-set half is already satisfied: `update()` is a partial
`repository.update(...)` built from `UpdateShipmentInput`, which gains nothing, so
the patch path **cannot** stomp these columns.

**W5 — every member of the closed reason union must be REACHABLE** (`lessons.md`,
dead-guard entry, #2380). All three are reachable through the real service path,
and each is pinned by driving `relayWaybillToParticipants` with a real relay
result rather than by hand-constructing a failure record.

**No `check:invariants` rule is tripped.** Changes are intra-`shipping` plus
`apps/api` / `apps/web`; the controller already goes through
`IShipmentQueryService`, never the port. **No FE/BE mirror is created** — the
backend ships the derived boolean, so the browser holds no copy of the threshold
and no mirror script is needed. The shipping barrel cherry-picks every symbol
(only `./shipping.tokens` is a wildcard), so the new types file needs explicit
`export` / `export type` lines.

### Scope revisions applied

1. **The frontend banner is dropped.** `shipments-page.tsx` renders no `Alert`
   today; the one above-table banner is `ShipmentTriageStrip`, which is
   `canWrite`-gated and *cause-grouped for failed shipments* — a different
   grouping. A second banner mechanism is scope this issue does not need: the
   badge renders on every row an operator scans and the filter makes the bucket
   reachable. Named as a follow-up rather than silently cut.
2. **FE filter plumbing is four places**: `buildQuery` in `shipments.api.ts`, the
   `clearFilters()` key list, the `filtersActive` boolean, and the query-key
   factory. Recorded so a half-wired filter cannot ship.
3. **`shipments` was NOT added to the migration-parity `TABLES` list** — the
   fallback arm of this revision, taken deliberately. That spec diffs a table's
   ENTIRE migration-built schema against its `synchronize`-built one, and
   `shipments` predates most of this repo's migration discipline, so adding it
   blind risks failing CI on pre-existing drift in columns this change never
   touched. Docker is unavailable in the implementing environment, so the
   experiment could not be run and the result could not be read. Instead
   `apps/api/test/integration/shipment-waybill-relay-failure.int-spec.ts`
   asserts the half that matters here — that the CHECK, the partial index and
   the column types exist on the **`synchronize`** schema, which is the side a
   migration-only declaration would silently miss. Adding `shipments` to the
   parity list is worth its own issue.

**No new role gating.** `GET /shipments` is `@AnyRole()` and redacts
`errorMessage` for non-`shipments:write` roles. The new fields need none — the
reason is a closed code vocabulary (not carrier free text) and `connectionId` is
already exposed unconditionally on every row. Stated so the absence does not read
as an oversight.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| `releaseWaybillRelay` signature change breaks an out-of-tree implementer of `ShipmentRepositoryPort` | Gate-verified: the port is core-internal and plugins cannot even import it; required arg is the deliberate choice per Q4 |
| Counter drifts from reality if a future writer releases without counting | Impossible by construction — the two are one statement |
| Alarm never clears for a terminal shipment | Named limitation, Q3; `lastFailedAt` distinguishes active from frozen |
| Partial index churn | Predicate column moves only on relay outcomes; index near-empty by default |
| Adding `shipments` to the parity spec surfaces pre-existing drift | Back the table out, narrow assertion instead, record the finding (revision 3) |
