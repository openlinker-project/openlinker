# Implementation Plan: Automation action executors (#2361)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: replace `InertAutomationDispatchService` (#2360's declared seam) with a real dispatcher that,
for every matched rule, runs its ordered action steps against **already-shipped operations**, stops on the
first failure, records which step failed, and is observable at every non-executing exit.

**Context**: spec §5.3 admits an action only if it invokes an operation OpenLinker already ships end-to-end
with its own idempotency and failure handling solved. #2360 left `dispatch()` inert on purpose so that
#2361 (executors) and #2362 (at-most-one gate) arrive as a provider swap rather than a change under a
live caller.

**Classification**: CORE / Application.

---

## 2. Scope & Non-Goals

### In scope
- `AutomationActionExecutorPort` + the per-step result shape the runner and #2385 both speak.
- A registry mapping all six actions to executors, carrying the **four pruned actions** and their reasons.
- `AutomationDispatchService` — the sequential, stop-on-first-failure runner.
- Executors for **A3** and **A4** — the only two whose shipped operation an automation can actually reach.
- Explicit, observable `unavailable` executors for **A1, A2, A5, A6**, each naming its blocking gap.
- A run-recording seam (`IAutomationRunRecorder`) with an inert logging implementation.
- A boot-time DI gate proving the swap wires in both host processes.

> **Revised after the `/pre-implement` gate.** The first draft classified A1 and A4 as clean delegations.
> Grepping the live tree disproved that for A1 and qualified it for A4 — see §5. Four of the six actions
> have no operation an automation can reach, so this slice ships the framework plus the two that work.

### Out of scope
- `automation_runs` persistence and per-step column shape — **#2385**.
- The at-most-one / inert-ambiguity gate for irreversible actions — **#2362**.
- HTTP surfaces (CRUD, evaluate, run log) — **#2363**.
- Order-activity timeline events (§5.6b) — a rendering of #2385's record.
- Building the missing hold / shipment-payload operations (see §5).

### Constraints
- `OrdersModule` imports `AutomationModule`, so **`AutomationModule` must gain no static sibling module
  edge** — a `automation → invoicing → orders → automation` Nest DI cycle, and a CJS barrel-load cycle
  one layer down.
- No migration. Migration slot `1856000000000` is reserved for this issue and is **not** expected to be used.

---

## 3. Architecture Mapping

**Target layer**: CORE, `libs/core/src/automation/`.

**Existing services reused (delegated to, never reimplemented)**

| Action | Shipped operation | Token / barrel | Shape |
|---|---|---|---|
| A3 `relay-status-to-source` | `IOrderLifecycleRelayService.relay({internalOrderId, originConnectionId, event})` | `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN`, `@openlinker/core/orders` | synchronous, best-effort per target, never throws per participant |
| A4 `send-email` | `MailerPort.sendEmail({to, subject, text})` | `MAILER_TOKEN`, `@openlinker/core/users` | synchronous transport call |
| — order read (A4's buyer address) | `IOrderRecordService.getOrderRecord(id)` | `ORDER_RECORD_SERVICE_TOKEN`, `@openlinker/core/orders` | snapshot read |

`AUTO_ISSUE_TRIGGER_SERVICE_TOKEN` is deliberately **not** taken: A1 is unavailable in this slice
(§5 finding 1), so it reuses nothing and no dependency on `invoicing` is introduced.

**With A1 and A2 unavailable, no executor in this slice can spend money or dispatch a parcel.** That is
the single most important risk property of the change.

**New components**
- `domain/ports/automation-action-executor.port.ts` — the port every executor implements.
- `domain/types/automation-step-result.types.ts` — `AutomationStepResult` + `AutomationStepStatus`.
- `application/interfaces/automation-run-recorder.interface.ts` + an inert logging implementation.
- `application/services/executors/*.executor.ts` (six) + `automation-action-executor.registry.ts`.
- `application/services/automation-dispatch.service.ts` — replaced in place (the file is named for the
  contract; #2360 already anticipated the class being swapped).

**Core vs Integration**: entirely CORE — every delegate is a core application service; no adapter is touched.

---

## 4. Domain research (what actually exists)

Verified against the branch (`598ddde96`), not assumed:

- **A1** — `IInvoiceService.issueInvoice` needs a fully composed `IssueInvoiceCommand`; the *order-shaped*
  entry point is `AutoIssueTriggerService.onOrderTransition`, which needs a full `Order` (the caller loads
  it — the one-way-edge rule keeps `OrdersModule` out of `InvoicingModule`). Returns a
  `SalesDocumentBlockOutcome`, which is exactly the observability vocabulary this dispatcher wants.
- **A3** — `IOrderLifecycleRelayService.relay`. `originConnectionId` **excludes** that participant from the
  targets; `ShipmentDispatchNotificationService` sets the precedent of passing a non-participant connection
  id when OL itself is the origin. An automation has no participant origin, so it passes a sentinel.
- **A4** — `MailerPort` lives in the **users** context (`MAILER_TOKEN`), and is bound today only in
  `apps/api/src/auth/auth.module.ts`. **The worker has no binding**, and automation fires from the worker
  (T4 deadline sweep, T5 via `OrderRecordService`). Lazy resolution therefore degrades observably rather
  than crashing a job.
- **A2** — `ShipmentDispatchInput` requires `recipient` and `parcel`, both documented as **not derivable
  from a persisted order** (`shipment-dispatch.types.ts`) and supplied by the operator via the HTTP DTO. It
  carries no `carrierId` / `serviceId` / `packagePresetId`; carrier is resolved from routing. **Package
  presets do not exist anywhere in the tree.**
- **A5/A6** — `libs/core/src/order-lifecycle/` is a vocabulary-only leaf. There is **no** `order_holds`
  table, ORM entity, migration, repository, service or token. #2338/#2339 have not landed on this branch or
  on `origin/main`.

---

## 5. Questions & Assumptions

### Findings that change the issue's premise (escalate, do not invent)

1. **A1's entry point is unreachable from an automation.** `AutoIssueTriggerService.onOrderTransition`
   takes an `Order` and reads `order.items` / `order.totals`; its only caller is `OrderIngestionService`,
   which already holds one. An automation holds an id. `OrderRecord.orderSnapshot` does hold the resolved
   `Order` (documented, for `recordStatus === 'ready'`), but it is `Record<string, unknown>` and JSONB
   round-trips `Order.placedAt` / `createdAt` from `Date` to **ISO string** — so a cast type-checks and is
   silently wrong downstream. A faithful reconstruction is a real deserializer with date revival, owned by
   the `orders` context. **Reported, not cast.**
2. **A2 has no shipped orderId-only operation, and its spec'd parameters do not map onto the seam.**
   The §5.3b table names carrier / service / package preset / COD; `ShipmentDispatchInput` accepts none of
   the first three and needs `recipient` + `parcel` that its own file header documents as not derivable
   from an order. Package presets do not exist anywhere in the tree. **Reported, not built.**
3. **A5/A6 have no shipped operation at all** — `order-lifecycle` is a vocabulary-only leaf; no
   `order_holds` table, service or token exists on this branch or on `origin/main`. #2339 has not landed.
4. **A4's port is unbound in the worker.** `MAILER_TOKEN` is provided only by `apps/api`'s `AuthModule`,
   and its adapter lives under `apps/api/src/auth/`, which the worker cannot import. Automation fires from
   the worker. A4 therefore executes in the API process and, in the worker, must report the missing
   binding as a `failed` step naming it. Giving the worker a mailer means relocating the adapter to a
   host-shared home — an app-composition change, out of this slice.

### Assumption
- The three unavailable actions are **registered, not omitted**. The write path already accepts them
  (#2359 legality), so an operator can save such a rule today; a missing registry entry would make the
  firing silent, which is the defect class this programme keeps closing. They execute to a `failed` step
  carrying `unavailableReason` naming the blocking issue.

### Documentation gap
- §5.3b assumes package presets exist. They do not. Recorded here rather than papered over.

---

## 6. Implementation Plan

### Phase 1 — Vocabulary

1. **`AutomationStepResult`** — `domain/types/automation-step-result.types.ts`
   - `AutomationStepStatusValues = ['done','nothing-to-do','failed','skipped']`.
   - `AutomationStepResult { stepIndex, action, status, detail?, syncJobId?, failureReason?, unavailableReason? }`.
   - Docblock states: **#2385 persists this verbatim into `automation_runs.steps`**; the `syncJobId` field is
     the §5.6 link to the job detail, carried inside the step (no column of its own — the run entity's own
     docblock already says so).
   - Acceptance: unit-tested coercion guard; barrel-exported.

2. **`AutomationActionExecutorPort`** — `domain/ports/automation-action-executor.port.ts`
   - `execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult>`; input carries the
     narrowed `AutomationAction`, the `AutomationSubjectFacts`, the rule (for `{rule.name}` merge fields),
     `stepIndex` and `now`.
   - Acceptance: no executor throws for a business condition — a failure is a returned `failed` step.

3. **Merge fields** — `domain/domain-services/render-automation-template.ts`
   - The closed nine-field list of §5.3b, **rendering an unrecognised `{…}` verbatim**.
   - Pure, no I/O; takes an already-assembled context object.
   - Acceptance: `{ordr.reference}` survives untouched; each of the nine renders; absent value renders the
     spec's stated fallback (*"not yet"* / *"no deadline"* / *"no hold"*).

### Phase 2 — The runner

4. **`IAutomationRunRecorder`** + `LoggingAutomationRunRecorder`
   - `record({rule, trigger, facts, outcome, steps, firedAt})`. Bound to `AUTOMATION_RUN_RECORDER_TOKEN`;
     #2385 swaps the binding, exactly as this issue swaps #2360's.
   - Acceptance: every dispatch path calls it exactly once per rule, **including the zero-step and
     all-failed paths** — that is the observability requirement.

5. **`AutomationDispatchService`** (replaces `InertAutomationDispatchService`)
   - Per matched rule: resolve each step's executor from the registry, run **in order**, stop on the first
     `failed`, mark every later step `skipped` (so "did not run" is recorded, not inferred from absence).
   - Outcome derivation: any `failed` → `failed`; every step `nothing-to-do` → `nothing-to-do`; else `done`.
   - A rule whose steps all resolve is still recorded; a per-rule throw is caught, recorded as `failed` and
     does **not** abort sibling rules.
   - **An action with no registry entry returns a `failed` step naming it** — never a throw (which would
     abort sibling rules), never a silent skip. `satisfies` makes this unreachable at compile time, but
     the registry is keyed from a persisted `jsonb` column, so a rule saved by a newer build and read by
     an older one is exactly the shape this arm exists for.
   - `dispatch()` keeps returning `Promise<void>` — the interface is #2360's and #2362 composes on top.
   - Acceptance: a failing step 2 of 3 yields `[done, failed, skipped]` and outcome `failed`.

6. **`AutomationActionExecutorRegistry`**
   - A `Record<AutomationActionKind, AutomationActionExecutorPort>` built with `satisfies`, so a new action
     fails to compile rather than dispatching to nothing.
   - Its docblock carries the **four pruned actions verbatim with their §5.3 reasons** (`mark-packed`,
     `propose-credit-note`, `adjust-stock`/`restock`, `call-a-webhook`) so they are not re-proposed.
   - Acceptance: a spec asserts the registry keys equal `AutomationActionValues` and that none of the four
     pruned names appears anywhere in the module.

### Phase 3 — Executors

Files are named `*.service.ts` under `application/services/executors/` — deliberately, so that
`check-service-interfaces.mjs` (scope: `*.service.ts` under `application/services/`) **walks** them and
they pass positively by implementing a non-repository `*Port`. A `*.executor.ts` name has no precedent in
`libs/core` and would merely escape the guard's scope.

7. **A3 `RelayStatusToSourceExecutorService`** — `relay({internalOrderId, originConnectionId: <automation
   sentinel>, event: {type:'dispatched', trackingNumber?}})`; every target `unsupported`/`rejected` is
   reported in `detail`, a wholly-unsupported relay is `nothing-to-do`. Needs only the subject id, which is
   why it is the one action that maps cleanly.
8. **A4 `SendEmailExecutorService`** — resolves the recipient (`buyer` → the order snapshot's
   `customerEmail`, which under `OL_STORE_PII=false` is absent → `failed` with a stated reason, never a
   silent skip), renders subject/body through the merge-field function, delegates to `MailerPort.sendEmail`.
   An unresolvable `MAILER_TOKEN` (the worker) is a `failed` step naming the missing binding.
9. **A1/A2/A5/A6 `UnavailableActionExecutorService`** — one parameterised class, four registry entries,
   each naming its blocking gap in `unavailableReason` (#2339 for holds; the payload gap for shipments; the
   missing order-shaped read for sales documents). Returns `failed`, logged at `warn`.

### Phase 4 — Wiring and the boot gate

11. **One lazy delegate resolver** — `AutomationDelegateResolverService` owns the whole pattern:
    a lazy `require()` of the sibling barrel plus `ModuleRef.get(token, {strict:false})`, returning `null`
    when the token is not bound in this process. Following `InvoiceService.resolveFiscalRegistrationService`,
    whose ~40-line docblock documents both the Nest DI cycle and the CJS barrel-load cycle this avoids.
    **One resolver, not one per executor** — four copies would be four places to drop the `try/catch` or to
    "tidy" the lazy `require` into a top-level import and close the barrel cycle at boot, silently and
    process-wide. `AutomationModule.imports` stays empty.
12. **`automation.module.ts`** — swap the `AUTOMATION_DISPATCH_SERVICE_TOKEN` binding; add the six
    executors, the registry, the resolver and the recorder. **One provider binding changes**, as #2360
    promised.
13. **Boot gate** — `apps/worker/test/integration/automation-dispatch-boot.int-spec.ts`: boot the worker
    graph and assert what is genuinely invariant there — `AUTOMATION_DISPATCH_SERVICE_TOKEN` resolves to
    the real class (not the inert one), and the registry covers every `AutomationActionValues` member.
    It must **not** assert that every delegate token resolves: `MAILER_TOKEN` deliberately does not in the
    worker (§5 finding 4), so such an assertion would fail on correct behaviour. The mailer's absence is a
    `failed` step, covered by a unit test. Sets `OL_PII_HASH_SALT` itself rather than relying on leakage
    from a sibling spec file.

---

## 7. Alternatives Considered

1. **Static `AutomationModule.imports: [InvoicingModule, OrdersModule, UsersModule]`** — rejected: closes a
   Nest DI cycle (`OrdersModule` already imports `AutomationModule`) and a CJS barrel cycle underneath it.
2. **Bind the real dispatcher from a host composition module** — rejected: `AutomationTriggerEmissionService`
   injects the token from `AutomationModule`'s own injector, so an outside binding never wins.
3. **Omit A2/A5/A6 from the registry** — rejected: a savable rule that fires and does nothing, silently.
4. **Persist `automation_runs` here** — rejected: #2385 owns that write path; two writers is how a firing
   shows succeeded in one place and failed in another (§5.6's "one record, four readings").
5. **Derive `recipient`/`parcel` for A2 from the order** — rejected: the shipped seam documents them as
   not derivable; inventing a resolver is the parallel path §5.3 forbids.

---

## 8. Validation & Risks

- ✅ Hexagonal: port in `domain/ports`, executors in `application/services`, no infrastructure.
- ✅ Cross-context contract: only `I*Service` / `*Port` / `*_TOKEN` symbols cross, all lazily.
- ✅ No new job type ⇒ no ADR-050 lane-coverage change.
- ✅ Idempotency: none reimplemented — A1 keys inside `AutoIssueTriggerService`, A3 is a best-effort relay,
  A4 is a transport call. A2's claim guard (`shipmentDispatchLockKey`) is unreached because A2 is unavailable.
- **Risk — double-fire on A1/A2.** Mitigated for A1 by the delegate's own `invoice:{cid}:{orderId}` key plus
  #2047's per-order lock and write-path guard; A2 cannot fire. The rule-level at-most-one gate is #2362's,
  composed *after* this dispatch and reading `AUTOMATION_ACTION_IS_IRREVERSIBLE` (never restating it).
- **Risk — `MAILER_TOKEN` unbound in the worker.** Surfaces as a `failed` step naming the missing binding,
  and is caught at boot by the gate spec.
- Backward compatible: the inert dispatcher had no persisted effects to preserve.

---

## 9. Testing Strategy & Acceptance Criteria

**Unit** (`libs/core/src/automation/**/__tests__/`): step-result coercion; merge-field rendering incl. the
verbatim-unknown rule; registry totality; the runner's `[done, failed, skipped]` ordering and outcome
derivation; each executor's mapping of its delegate's outcomes; the unavailable executor's reason.

**Integration** (`apps/worker/test/integration/automation-dispatch-boot.int-spec.ts`): the DI gate above.
Proven real by removing a provider and observing the failure.

**Acceptance**
- [ ] No executor reimplements idempotency, retry or provider handling.
- [ ] A failing step 2 of 3 stops the list and records the failing step.
- [ ] The four pruned actions are absent, with reasons in a docblock.
- [ ] Every non-executing exit is recorded through the recorder seam.
- [ ] `pnpm lint` / `type-check` / `test` green.

---

## 10. Alignment Checklist

- [x] Hexagonal architecture
- [x] CORE vs Integration boundaries respected
- [x] Existing patterns (ModuleRef lazy resolution, provider-swap seam, `satisfies` totality)
- [x] Idempotency considered (delegated, never rebuilt)
- [x] Error handling comprehensive (no silent decline)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] Execution-ready
