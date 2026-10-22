# Implementation Plan: auto-dispatch operator surface (refusals, preview, trigger, bench label)

- **Issue**: #2729 (epic #3514, pilot G09-02, P1)
- **Branch**: `2729-auto-dispatch-operator-surface` (local only, nothing committed or pushed)
- **Already on `main`**: `fulfillment.work.autoDispatch` + `AutoDispatchConfig` (enabled, `parcelTemplate`, `defaultWeightGrams`), default parcel box (#3571, merged 2026-10-16), routing-rule parcel profile (#3651)
- **Consumed by (open)**: #3572 (the settings form and the refusal/preview panels in `apps/web`)

---

## 1. Task summary

An operator cannot see why automatic labels fail, cannot try settings before saving them, cannot choose *when* the label is bought, and has no way to get a label for a packed parcel when auto-dispatch is off. This slice adds four backend pieces, all reusing the existing dispatch path and `resolveAutoDispatchParcel`:

1. `autoDispatch.trigger` (`on-accept` | `on-parcel-closed`), plus enqueue from the bench's own close event.
2. A per-connection read of recent refusals, split into "needs your input" and "retrying automatically".
3. A read-only dry-run endpoint over a DRAFT config.
4. `POST /bench/work/:workId/label` for work whose holder has auto-dispatch off (D46).

## 2. Scope and non-goals

**In scope**: items 1 to 4 above, the ADR-071 amendment, tests, `.env`/docs touch-ups.

**Non-goals**
- **Frontend** (settings form, refusal list, preview panel): that is #3572, which lists this issue as its dependency. Not built here.
- Per-delivery-method defaults (D18/#3571, done) and COD/insurance (#3578, #3580).
- Enabling routing itself (inert until the OMS is on and a holder is assigned, ADR-055).
- No bench route with a close/commit/finish/seal verb: `no-parcel-commit-route.spec.ts` stays unchanged and green.

## 3. Architecture mapping

| Piece | Layer / location |
|---|---|
| `trigger` in config | `libs/core/src/identifier-mapping/domain/types/auto-dispatch.types.ts` (`AutoDispatchTriggerValues`, coercion in `readAutoDispatchConfig`, `isPresentButInvalidAutoDispatchTrigger`) |
| Enqueue split | `apps/worker/.../fulfillment-work-dispatch.handler.ts` (on-accept only) and `apps/api/.../fulfillment-parcel-closure-notifier.service.ts` (on-parcel-closed) |
| Refusal read | `SyncJobRepositoryPort` new query + `ISyncJobsService` method; classification table in `libs/core/src/shipping/domain/auto-dispatch.ts` beside `AutoDispatchRefusalReasonValues` |
| Refusal + preview endpoints | `apps/api/src/shipping/` (or `fulfillment/`), `connections/:connectionId/auto-dispatch/{refusals,preview}`, `@Roles('admin','operator')` |
| Preview composition | app-layer `AutoDispatchPreviewService` (worklist + products + orders + routing), because the `fulfillment` leaf may not read siblings (ADR-053) |
| Bench label route | `apps/api/src/bench/http/bench-label.controller.ts` (existing controller, new `@Post('work/:workId/label')`) |
| ADR-071 amendment | `docs/architecture/adrs/071-pack-station-principal.md` |

## 4. Design decisions

0. **The refusal decision exists once** (decided with the user): a pure `planAutoDispatch(...)` in `libs/core/src/shipping/domain/` takes work, order record, routing resolution, variant weights, config and carrier requirements as plain arguments (no `shipping -> products` edge, which would close `products -> listings -> shipping`) and returns `{kind:'ready', input}` or `{kind:'refused', reason}`. The worker handler, the bench label route and the preview are thin loaders around it, so the preview cannot drift from the real purchase and a bench refusal is synchronous. The handler refactor must keep every `outcomeReason` it returns today.
1. **`trigger` reads like every other config knob**: absent or unrecognised reads as `on-accept`, and the call sites log a present-but-invalid value (the `isPresentButInvalid*` precedent from `stockSafetyBuffer`). `readAutoDispatchConfig` stays pure; it never logs.
2. **Exactly one producer fires per connection.** The accept path enqueues only when `trigger === 'on-accept'`; the close notifier enqueues only when `trigger === 'on-parcel-closed'`. Both use the same idempotency key `fulfillment:autoDispatch:{workId}`, so even a misread config cannot buy twice, and the handler's `already-has-label` guard stays the second line.
3. **The close-event enqueue is not a bench operation.** The notifier already runs when the last verification closes the parcel; reacting to it adds no route and no verb. The ADR-071 amendment records that reasoning.
4. **Refusals are a read over `sync_jobs`, not a new table.** The handler's outcome table (file header) decides the split, so the classification lives in one pure function over `outcomeReason`: `needs-input` for `no-weight`, `no-dimensions`, `no-address`, a settled `work-not-eligible`, `no-delivery-method`, `shipment-claimed-by-sibling-work`; `retrying` for jobs still on the retry ladder. `already-has-label` is `ok` and never appears.
5. **Dry-run writes nothing and buys nothing.** It calls only `resolveAutoDispatchParcel` / `mergeAutoDispatchParcelOptions` / `findMissingParcelRequirement` over recent works assigned to the connection, against the posted draft config, and flags the orders that would be refused with the same reason codes.
6. **The API says which connection it is about.** Both reads are keyed on the connection that HOLDS the work (`work.assignedConnectionId`), which is often the OMS connection or a 3PL, and the response states so (a `holderConnectionId` field plus `holderKind`), so #3572 can render it.

## 5. Steps

1. **Config**: add `AutoDispatchTriggerValues`, extend `AutoDispatchConfig` with `trigger`, `readAutoDispatchConfig`, `isPresentButInvalidAutoDispatchTrigger`; unit specs for absent, valid, garbage, and for `enabled: false` staying disabled.
2. **Accept producer**: gate `maybeEnqueueAutoDispatch` on `trigger === 'on-accept'`; log a present-but-invalid trigger; spec the three cases.
3. **Close producer**: in `FulfillmentParcelClosureNotifierService`, after a recorded `shipped`, read the holder's config and enqueue `fulfillment.work.autoDispatch` when `on-parcel-closed`; best-effort, never propagating (the notifier's own rule); API-side `JobEnqueuePort` injection.
4. **Refusal read**: repository query (`connectionId`, `jobType`, status/outcome predicate, `limit`, newest first), service method, pure classifier, controller + response DTO (order id, reason code, `since`, `bucket`). Uses `(connectionId, jobType, ...)` indexes that already exist; no migration.
5. **Preview**: service, request DTO (draft config validated through `readAutoDispatchConfig`-equivalent rules, `limit` capped), response per order (`orderId`, `workId`, weight, template, box, `refusal | null`). Never calls `dispatch`.
6. **Bench label route** (D46): `POST /bench/work/:workId/label`, empty body, `@Roles('admin','operator','packer')`. Loads the same inputs, calls `planAutoDispatch`, refuses 409 with a named reason (`auto-dispatch-on`, `already-has-label`, or any planner refusal), otherwise calls `IShipmentDispatchService.dispatch` synchronously (201). Not a close verb; `no-parcel-commit-route.spec.ts` unchanged.
7. **Docs**: ADR-071 amendment, `architecture-overview.md` § 28 bullet, `apps/worker/.env.example` only if a new env var appears (none planned).

## 6. Testing (written, not run locally; CI runs them)

- Unit: config coercion, both producers (mutually exclusive), refusal classifier (table-driven over every reason in `AutoDispatchRefusalReasonValues`), preview (refused, ok, no write), bench route refusals.
- Int-spec (real Postgres): refusal read returns the right rows per connection and bucket; preview leaves `shipments` and `sync_jobs` untouched.
- `no-parcel-commit-route.spec.ts` must pass unchanged.
- Locally only `pnpm lint` and `pnpm type-check`, per my standing rule.

## 7. Decisions taken (user, 2026-10-22)

1. The refusal read includes `business_failure` plus queued/dead jobs of this type that carry an error (the retry ladder).
2. D46 via the shared planner and a synchronous bench route (design decision 0), not a job flag.
3. "A weight recorded at the bench" is a documented no-op until such a field exists.
4. Frontend is excluded (#3572).
