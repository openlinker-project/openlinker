# Pre-implement gate: automation trigger emission (#2360, T4 + T5)

**Date**: 2026-08-26
**Plan**: `docs/plans/implementation-plan-automation-trigger-emission.md`
**Verdict**: **READY** — with three Warnings to honour during implementation. No Critical findings.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `AutomationTriggerFiringRepositoryPort` + impl | **NEW** (confirmed absent) | zero hits repo-wide; #2358 shipped `AutomationTriggerFiring` entity + ORM entity + table with **no** repository |
| `AutomationDispatchPort` / `NoopAutomationDispatcher` | **NEW** | zero hits |
| `IAutomationTriggerEmissionService` | **NEW** | zero hits |
| `AutomationDeadlineSweepService` | **NEW** | zero hits (`isDeadlineSweepTrigger` in `automation-trigger.types.ts` is the #2358 mode predicate — reuse it, do not restate the split) |
| `automation.trigger.deadlineSweep` job type | **NEW** | no `automation` member in `JobTypeValues` |
| Tokens for the three new bindings | **NEW** | `automation.tokens.ts` holds only `AUTOMATION_RULE_REPOSITORY_TOKEN`, `AUTOMATION_RULES_SERVICE_TOKEN` |
| `findDispatchDeadlineCandidates` | **PARTIAL → extend** | no paged candidate reader exists on `IOrderRecordService`, but the repository already has the `notShipped` + `dispatchByAt` window predicates (`order-record.repository.ts:935-949`) used by the SLA buckets. **Reuse that predicate; do not author a second definition of "still needs dispatching"** — two spellings will drift and the operator's SLA badge and the automation will then disagree about the same order. |
| `automation_trigger_firings` table | **ALREADY EXISTS → reuse** | migration `1851000000000`, unique index `UQ_automation_trigger_firings_rule_subject`, verified green 14/14. Plan's "no migration" holds; slot `1856000000000` genuinely unneeded. |

No reuse collisions. Every "new" artifact is confirmed absent.

---

## Backward-compatibility findings

**Critical**: none.

- `IOrderRecordService.markPacked(internalOrderId, packedByUserId): Promise<OrderRecord>` — signature
  **unchanged** by the plan (the guard boolean is captured internally from the repository, which already
  returns it). No barrel export removed or renamed; no port method signature changed; no DTO retyped;
  no token removed; no ORM schema change.

### Warnings

**W1 — Lane coverage is a boot gate, so the job type and its handler must land in the same commit.**
`SyncJobHandlerRegistry.assertFullLaneCoverage()` (`sync-job-handler.registry.ts:108`, called from
`handler-registration.service.ts:365`) fails worker boot naming any `JobTypeValues` member with no
registered handler+lane. Adding `automation.trigger.deadlineSweep` to the union without registering
the handler is a hard boot failure, not a lint warning. Plan phase 4 already groups them — keep them
grouped.

**W2 — `check-service-interfaces` covers both new services.** The script scopes
`libs/core/src/<ctx>/application/services/*.service.ts` and requires an `implements` clause naming an
`I*Service` (with a sibling interface file) or a `*Port`. The plan declares
`IAutomationTriggerEmissionService` but leaves `AutomationDeadlineSweepService` without one — it needs
its own `*.service.interface.ts`, or `pnpm lint` fails.

**W3 — `findByTrigger` returns active *and* inactive rules, deliberately.** Its docblock:
*"Every rule on this trigger, active or not — the per-trigger index page."* The plan says "load active
rules", which implies a new port method or a pre-filter. **Neither is wanted**: `evaluateAutomationRules`
already classifies an inactive rule as `rule-inactive` and excludes it from `matched`, so passing the
full set is both correct and the only way the #2363 dry run can explain *"your rule is switched off"*.
Pre-filtering in the emission service would silently delete that reason. Recommendation: pass every
rule the repository returns and let the evaluator decide — and say so in the docblock, because the
"optimisation" of filtering in SQL will look attractive to the next reader.

### Invariant scripts — no trips expected

- `check-cross-context-imports`: both new edges are allow-shaped — `automation → orders` via
  `IOrderRecordService` (an `I*Service`), `orders → automation` via an `I*Service` + Symbol token.
  Neither touches a `*RepositoryPort`, `*OrmEntity`, `*Adapter` or `*Dto` across the boundary.
- `barrel-purity`: `automation` is **not** in `ZERO_SIBLING_EDGE_LEAVES`, so new sibling edges are
  permitted; it already carries the `order-lifecycle` value edge.
- `check-migration-timestamps`: no migration added.

---

## Open questions

1. **The `automation ↔ orders` barrel cycle** is real (plan D-note + R3). The mitigation cited —
   `ModuleRef.get(..., { strict: false })` on the `orders → automation` direction — is the shipped
   #2157 `InvoiceService → IFiscalRegistrationService` precedent, so the shape is proven. Worth an
   integration boot spec asserting the graph resolves, mirroring
   `invoicing-auto-issue-boot.int-spec.ts`, since a DI cycle surfaces at boot rather than at type-check.
2. **`NoopAutomationDispatcher` means nothing fires end-to-end in this slice.** That is correct and
   intended, but it makes every AC about *dispatch* unverifiable here. The plan should be explicit that
   its ACs terminate at "the firing was recorded and handed to the dispatcher" — otherwise a reader
   will reasonably expect a label to be bought.
