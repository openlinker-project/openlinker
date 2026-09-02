# Implementation Plan: Automation at-most-one + inert-ambiguity gate for irreversible actions (#2362)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~4 hours

---

## 1. Task Summary

**Objective**: When several automation rules match one subject and more than one of them carries an
**irreversible** action (A1 `issue-sales-document`, A2 `dispatch-shipment`), fire **nothing** for those
rules, persist a `blocked` run naming **every** colliding rule, and let reversible-only rules dispatch
normally.

**Context**: ADR-041 §3a/§3b establishes that an order gets at most ONE originating fiscal document, and
§6 establishes that with several candidates and no unambiguous winner the system does nothing — *"for a
fiscal document a wrong pick is a legal event"*. Wave-2 spec §5.5 divergence 3 places the same rule at
automation runtime: two emails are recoverable, two labels are not. #2361 deliberately left the gate
out of `AutomationDispatchService` (its docblock says so) so that it could be composed here.

**Classification**: CORE (Application + Domain).

---

## 2. Scope & Non-Goals

### In Scope
- A pure domain service that partitions a matched-rule set into *dispatchable* and *blocked*.
- An application service composing that partition over the existing `AutomationDispatchService`.
- A `blocked` run record per blocked rule, carrying `blockedByRuleIds`.
- Widening `AutomationRunRecord` (never forking it).
- Unit tests for the pure rule and the gate service.

### Out of Scope
- Persisting run rows — **#2385** owns the `automation_runs` write path. This slice routes `blocked`
  through the *same single* recorder seam every other outcome already uses, so persistence arrives for
  `blocked` with #2385 rather than as a second write path.
- Any HTTP surface — **#2363**.
- Any schema change. `automation_runs.blockedByRuleIds` already exists (#2358); migration slot
  `1856000000000` stays unused and returns to the pool.
- Re-deciding the #2047 invoicing write-path guard. It is a separate, independent layer and stays
  untouched — this gate is *additional*, never a replacement.

### Constraints
- `dispatch()` returns `Promise<void>` and receives every matched rule (#2360's declared seam).
- The `automation_trigger_firings` claim is taken **before** dispatch, for `deadline-sweep` triggers.

---

## 3. Architecture Mapping

**Target Layer**: CORE — `libs/core/src/automation/domain/domain-services/` (pure rule) plus
`libs/core/src/automation/application/services/` (the composing service).

**Capabilities Involved**: none. This is intra-context policy; no capability port is touched.

**Existing Services Reused**:
- `AutomationDispatchService` (#2361) — delegated to, **not replaced**.
- `IAutomationRunRecorderService` / `AUTOMATION_RUN_RECORDER_TOKEN` (#2361) — the single run-reporting seam.
- `AUTOMATION_ACTION_IS_IRREVERSIBLE` / `isIrreversibleAction` (#2358) — the split is **read**, never restated.
- `AutomationRun.blockedByRuleIds` (#2358) — the column already exists for exactly this.

**New Components**:
- `domain/types/automation-gate.types.ts` — `AutomationBlockedRule`, `AutomationGateResult`.
- `domain/domain-services/gate-irreversible-automation-actions.ts` — the pure partition.
- `application/services/automation-irreversible-gate.service.ts` — `implements IAutomationDispatchService`.

**Core vs Integration Justification**: the rule is marketplace-neutral policy over OL's own persisted
rules. No adapter, no platform vocabulary; it cannot live in an integration.

---

## 4. Domain Research

### The shape the gate must have

Three properties, each with a failure mode if got wrong:

1. **Collision is keyed PER IRREVERSIBLE ACTION KIND, not "any two irreversible rules".**
   Issuing a fiscal document and buying a label are different acts on different resources; neither
   duplicates the other. A rule firing A1 and a sibling firing A2 are a perfectly legal pair an
   operator may deliberately author, and blocking them would refuse correct configuration. Two A1
   rules collide; two A2 rules collide; A1-vs-A2 does not.

2. **The partition is computed ONCE over the original matched set, with no cascade.**
   If rule X is blocked on A1, one might be tempted to "free" its A2 rival because X will not run
   anyway. That is silence-and-pick-one through the back door — a winner derived from a block — and
   ADR-041 §6 forbids it. Any action kind with ≥2 candidates blocks all of its candidates, full stop.

3. **Blocking is per RULE, not per step.** A rule's steps run in order and stop on first failure; there
   is no half-run. A rule blocked on any one of its irreversible actions is blocked entirely, and its
   `blockedByRuleIds` is the union of rivals across its irreversible actions, plus itself (the
   `AutomationRun` docblock: *"every rule that collided, this one included"*).

### The consumed-claim question (decided here, deliberately)

For a `deadline-sweep` trigger the emitter takes the durable `automation_trigger_firings` claim
**before** calling `dispatch`. A rule this gate blocks has therefore already consumed its
at-most-once claim and will never be re-offered on a later tick.

**Decision: accept it. Do not release the claim.** Three reasons:

- The collision is a **configuration** fact, not a transient one. Two active rules both matching the
  same subject with the same irreversible action collide identically on every subsequent tick.
  Retrying buys nothing and would write one `blocked` run per rule *per tick*, drowning the very log
  the AF-X attention state (#2387) reads.
- Releasing would need a durable *delete* on the claim table — reintroducing exactly the
  re-fire window the claim exists to close, on the money path.
- It is consistent with a decision #2358 already made for the same reason: the firings unique key
  deliberately excludes `definitionHash`, i.e. *editing a rule does not erase its firing record*. An
  operator who fixes the collision already has to re-trigger by hand; the claim behaving the same way
  is not a new cost.

### On "prefer a durable conditional write over an in-memory guard"

Honoured where it belongs, and deliberately **not** duplicated here:
- At-most-once *per (rule, subject)* is the durable `ON CONFLICT DO NOTHING` claim (#2360).
- At-most-once *per operation* is each shipped operation's own idempotency (`InvoiceService`'s
  per-order lock + `blocksIssuanceElsewhere`, `ShipmentDispatchService`'s own guard) — the §5.3
  admission rule, restated as property 4 of `AutomationDispatchService`'s docblock: *"executors
  DELEGATE; this service adds no idempotency. Building a second layer here would be a parallel path
  that can disagree with the first."*
- The ambiguity this issue is about is **simultaneous candidacy within one evaluation**. Every
  candidate arrives in one in-memory list from one pure evaluator call; there is no second writer to
  race, so a durable write could not observe anything the list does not already contain. Adding a
  third idempotency layer here would be the parallel path #2361 forbids.

---

## 5. Questions & Assumptions

### Assumptions
- `blockedByRuleIds` includes the blocked rule itself (per the `AutomationRun` docblock).
- `ruleId` on a blocked run is the rule the row is *about*; `outcome: 'blocked'`; `steps: []` (nothing
  ran, and an empty list is the honest statement — a fabricated `skipped` step would claim the rule
  reached the dispatcher).
- Rule order within a collision set follows the incoming `matchedRules` order (evaluation order), so
  the reported set is deterministic.

### Documentation Gaps
- None. §5.5 divergence 3, the `AutomationRun` docblock and `AUTOMATION_ACTION_IS_IRREVERSIBLE`'s own
  docblock together specify this fully.

### No ADR
This implements an already-recorded decision (spec §5.5 divergence 3 + ADR-041 §3a/§3b/§6 + ADR-056).
Per `engineering-standards.md § ADRs`, a routine feature addition implementing a decided policy does
not get its own ADR. The reasoning above is recorded on the service docblocks instead.

---

## 6. Proposed Implementation Plan

### Phase 1 — the pure rule

1. **`domain/types/automation-gate.types.ts`**
   - `AutomationBlockedRule { ruleId; collidingRuleIds: readonly string[]; actions: readonly AutomationActionKind[] }`
   - `AutomationGateResult { dispatchable: readonly AutomationRule[]; blocked: readonly AutomationBlockedRule[] }`
   - Acceptance: types only, no runtime beyond the shapes.

2. **`domain/domain-services/gate-irreversible-automation-actions.ts`**
   - `gateIrreversibleAutomationActions(rules: readonly AutomationRule[]): AutomationGateResult`
   - Build `Map<AutomationActionKind, AutomationRule[]>` over irreversible steps only, using
     `isIrreversibleAction`. Any key with `length >= 2` contributes every one of its rules to the
     blocked set. Blocked rule ids are collected once; `dispatchable` preserves input order.
   - Pure: no I/O, no clock, no argument mutation. A spec scans its own source to assert that
     (mirroring `evaluate-automation-rules.spec.ts`).
   - Acceptance: unit tests cover — two A1 rules block both; two A4 rules block neither; one A1 + one
     A2 block neither; a rule carrying both A1 and A2 blocked by an A1 rival reports the union;
     three A1 rules all block; empty input yields empty result.

### Phase 2 — widen the recorder contract

3. **`application/interfaces/automation-run-recorder.service.interface.ts`**
   - Add optional `readonly blockedByRuleIds?: readonly string[]` to `AutomationRunRecord`, documented
     as populated only for `outcome === 'blocked'`. **Widened, not forked** — #2385 persists this
     record verbatim into `automation_runs`, where the column already exists.
   - `LoggingAutomationRunRecorder` renders it in its log line when present.
   - Acceptance: existing recorder callers compile untouched (the field is optional).

### Phase 3 — the composing service

4. **`application/services/automation-irreversible-gate.service.ts`**
   - `implements IAutomationDispatchService`; injects the concrete `AutomationDispatchService` and
     `AUTOMATION_RUN_RECORDER_TOKEN`.
   - `dispatch(input)`: partition → record one `blocked` run per blocked rule (best-effort, never
     throws — same contract as `AutomationDispatchService.record`) → delegate the dispatchable rules to
     `AutomationDispatchService.dispatch` with the same `trigger` / `facts` / `now`.
   - Delegates **nothing** when `dispatchable` is empty (no empty dispatch call).
   - Warn-logs each block naming both the rule and its rivals, so a blocked firing is visible in the
     process log today, before #2385's persistence lands.
   - Acceptance: unit tests cover — two A1 rules ⇒ delegate never called, two `blocked` records each
     naming both ids; two A4 rules ⇒ one delegate call with both rules, no `blocked` record; mixed
     set ⇒ reversible rules delegated while the colliding pair is blocked; a recorder throw does not
     abort the delegation.

5. **`automation.module.ts`**
   - Register `AutomationIrreversibleGateService`; repoint `AUTOMATION_DISPATCH_SERVICE_TOKEN` at it.
     `AutomationDispatchService` stays a provider (now injected by the gate, no longer by the token).
   - Acceptance: a boot-time DI spec proves the wiring is real by resolving the token from a compiled
     `AutomationModule` and asserting it is the gate — and the binding's necessity is proven by
     removing it locally and watching the spec fail before restoring it.

6. **`index.ts`**
   - Export the gate types, the pure function, and the service class (matching how #2361 exported
     `AutomationDispatchService`).

### Phase 3b — neighbour honesty (plan tech-review, both IMPORTANT)

5b. **`application/interfaces/automation-trigger-emission.service.interface.ts`**
   - Amend the `firedRuleIds` docblock. It currently reads *"what was dispatched"*, and the emitter
     builds it from `toDispatch` BEFORE calling `dispatch()` — so after this change it includes a rule
     the gate blocked, which fired nothing. `dispatch()` stays `Promise<void>`: threading a result back
     would put the money verdict into the emitter, which #2360's seam docblock forbids. The field must
     therefore say what it now means — *handed to dispatch*, with `automation_runs` the authority on
     what actually fired.

5c. **`automation.module.ts` + `automation-dispatch.service.ts` + `index.ts`**
   - The module's inline comment says #2362 "composes over this service rather than replacing it
     again" — true of the composition, wrong about the binding once the token points at the gate.
     Update it, and state on `AutomationDispatchService`'s own docblock that it is no longer what
     `AUTOMATION_DISPATCH_SERVICE_TOKEN` resolves to, since the class stays value-exported from the
     barrel and an out-of-context caller importing it would otherwise get the un-gated dispatcher with
     no compiler complaint.

5d. **`gate-irreversible-automation-actions.ts` docblock**
   - State why this is a `domain-services/` file and not a pure-rule addition to
     `automation-action.types.ts`: it decides over a COLLECTION of rules, so it fails clause 2 of the
     `engineering-standards.md § pure-rule exception` ("it IS the rule for the type it sits with").
     Without that note a later reader tidies it in beside `AUTOMATION_ACTION_IS_IRREVERSIBLE`.

5e. **The consumed-claim docblock states the operator consequence**
   - Not just that the claim is consumed, but that deactivating the losing rule does NOT re-arm the
     firing record (#2358's unique key excludes `definitionHash`), so remediation is followed by a
     manual trigger. That is the surprising half.

### Phase 4 — quality gate

7. `pnpm lint` (reads `LINT_EXIT=`, never a wrapper's exit code), `pnpm type-check`, **full** `pnpm test`.
   No migration, so `migration:show` is unchanged — but run it to confirm nothing pending.

---

## 7. Alternatives Considered

### Alternative 1: put the gate inside `AutomationDispatchService`
Rejected. #2361's docblock states the reason explicitly: collapsing matched rules inside the
dispatcher moves the money decision where the dry run (#2363) cannot show it and where the `blocked`
outcome could never be reported separately. Composition also keeps #2361's tests meaningful.

### Alternative 2: block on "two rules carrying any irreversible action"
Rejected — see §4 property 1. It refuses a legitimate A1+A2 pair, i.e. it makes the gate stricter
than the invariant it enforces, which is the failure mode #2240 recorded for mirrored destination gates.

### Alternative 3: release the firing claim for a blocked rule so a later tick can retry
Rejected — see §4. Deterministic re-collision, per-tick log flooding, and a durable delete that
reopens the re-fire window the claim exists to close.

### Alternative 4: a new durable "irreversible action claim" table keyed `(subject, action)`
Rejected. It would be a third idempotency layer over operations that already own theirs (§5.3's
admission rule), able to disagree with them; and it cannot observe anything the in-memory matched
list does not already contain, because every candidate arrives from one pure evaluator call.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Pure rule in `domain/domain-services/`, beside `evaluate-automation-rules.ts`.
- ✅ Service implements an existing `I*Service` with a sibling `*.service.interface.ts`
  (`check-service-interfaces.mjs` satisfied).
- ✅ No new cross-context edge — the context's one sibling edge stays `order-lifecycle`.
- ✅ Types in `*.types.ts`; `as const` unions unchanged.

### Risks
- **The blocked path is currently unreachable in practice.** A1 and A2 both resolve to
  `UnavailableActionExecutorService` today (#2361), so no shipped rule can carry a *working*
  irreversible action. The gate operates on the rule's declared `actions`, not on executor
  availability, so it arms the moment A1/A2 land — and is fully tested now. Stated on the service
  docblock so a reader does not mistake "never observed" for "not wired".
- **Rule-set size.** The partition is O(rules × steps) with steps ≤ 3; negligible.

### Backward Compatibility
- ✅ A single matched rule, or an all-reversible set, dispatches byte-identically to #2361.
- ✅ `AutomationRunRecord` widened with an optional field — no existing caller changes.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests
- `domain/domain-services/__tests__/gate-irreversible-automation-actions.spec.ts` (the pure rule +
  the purity source scan).
- `application/services/__tests__/automation-irreversible-gate.service.spec.ts` (delegation,
  recording, best-effort recorder).
- `application/services/__tests__/automation-dispatch.service.spec.ts` — unchanged, proving the
  composition did not alter the dispatcher.

### Integration
- The existing automation boot int-spec extended to assert `AUTOMATION_DISPATCH_SERVICE_TOKEN`
  resolves to the gate (the DI-gate step above).

### Acceptance Criteria (from #2362)
- [ ] Two active A1 rules matching one order fire nothing and persist a conflict reason naming **both** rules
- [ ] Two active A4 rules both fire (reversible actions are not conflicts)
- [ ] The #2047 write-path guard is still reached and still refuses independently
- [ ] Tests added; no boundary violations

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (composes #2361, reads #2358's map, reuses #2361's recorder seam)
- [x] Idempotency considered (and explicitly *not* duplicated — §4)
- [x] Error handling comprehensive (recorder never throws; no new throw path)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan tech-review applied (Phase 3b): `firedRuleIds` docblock, stale wiring comments, pure-rule placement note, claim-consequence note

---

## Related Documentation

- `docs/specs/product-spec-oms-wave2-operator-experience.md` §5.4 / §5.5 / §5.6
- `docs/architecture/adrs/041-sales-document-routing-policy.md` §3a / §3b / §6
- `docs/architecture-overview.md` § 23 Automation, § 14 Invoicing (#2047), § 17 Sales Documents (#2100)
