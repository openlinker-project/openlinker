# Pre-Implement Analysis: Narrow `return-correction-matching.domain-service.ts` onto `ReturnLine.resolvedOrderLineId`

**Plan**: `docs/plans/implementation-plan-narrow-return-correction-matcher.md`
**Issue**: [#3312](https://github.com/openlinker-project/openlinker/issues/3312)
**Date**: 2026-09-21

---

## Verdict: **READY**

No reuse collisions, no critical contract breaks. Every artifact the plan proposes to touch was
confirmed present at the exact path/line the plan cites, and every widening is additive on the
wire (DTO field not validator-restricted; FE schema types `noMatchReason` as a loose `string`, not
an enum). One filename gap in the plan is closed below (§ Open Questions).

---

## Phase B — Reuse Audit

The plan proposes **zero new** ports, services, DI tokens, ORM entities, or capabilities — every
artifact it names is an existing type/function being widened or extended in place.

| Plan artifact | Classification | File |
|---|---|---|
| `InvoiceLine` interface | EXISTS → widen (add `orderLineId?`) | `libs/core/src/invoicing/domain/types/invoicing.types.ts:382` |
| `toInvoiceLine` mapper fn | EXISTS → modify (one field write) | `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:264` |
| `toShippingLines` mapper fn | EXISTS → **unchanged** (plan says so explicitly) | same file, `:299` |
| `CorrectionSnapshotLine` interface | EXISTS → widen (add `orderLineId?`) | `libs/core/src/returns/domain/domain-services/return-correction-matching.domain-service.ts:72` (confirmed) |
| `CorrectionReturnLineInput` interface | EXISTS → widen (add `resolvedOrderLineId`) | same file, `:81` (confirmed) |
| `ReturnCorrectionNoMatchReasonValues` | EXISTS → widen (add `'ambiguous-invoice-line'`) | `libs/core/src/returns/domain/types/return-correction-proposal.types.ts:67` |
| `classifyOne` fn | EXISTS → rewrite resolution order | same matching-service file, `~:228` |
| `describeCorrectionNoMatchReason` fn | EXISTS → add one `case` | same file, `:256` |
| `toMatcherInput` fn | EXISTS → modify (one field write) | `libs/core/src/returns/application/services/return-correction-proposal.service.ts:296` |
| `ReturnLine.resolvedOrderLineId` | EXISTS, already populated by #3171/#3172 | `libs/core/src/returns/domain/entities/return-line.entity.ts:35` |
| `return-proposal-panel.tsx` (FE) | EXISTS → modify (tone + banner condition) | `apps/web/src/features/returns/components/return-proposal-panel.tsx` |
| `return-proposal.copy.ts` (FE) | EXISTS → add one map entry | `apps/web/src/features/returns/lib/return-proposal.copy.ts:47` |

No `*.tokens.ts`, no `*.orm-entity.ts`, no `*Port`/`*.capability.ts` file is touched — confirmed by
the plan's own § 3 ("No new components required") and independently verified: none of the above
files declare a DI token, a `@Entity`, or a port interface.

**Reuse risk**: none identified. The plan does not reinvent `indexSnapshotByName`'s
`Map`-indexing shape — it explicitly reuses that pattern for the new id-keyed index (§ 6, step 7).

---

## Phase C — Backward-Compatibility Checklist

| Surface | Check | Result |
|---|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | Is any exported symbol removed/renamed? | **No break.** `InvoiceLine` is **not** exported from `libs/core/src/invoicing/index.ts` (confirmed by grep — only `InvalidInvoiceLineError` is re-exported from that file's error module); `CorrectionSnapshotLine` / `CorrectionReturnLineInput` are internal to the matching-service file and likewise not re-exported. `ReturnCorrectionNoMatchReasonValues` **is** exported from `libs/core/src/returns/index.ts:300` — the plan only **adds** a member, which is a source-compatible widening, not a removal/rename. |
| Port method signatures | Any implemented `*Port` signature changed? | **N/A — no port touched.** |
| DTO shapes | Field removed / made required / retyped? | **No break.** `noMatchReason` on the response DTO carries no `@IsIn`/enum decorator (confirmed — the field is a plain passthrough at `apps/api/src/returns/http/return-writes.controller.ts:616`); it is a **response**-only field, so widening its underlying union is additive for every consumer. FE (`apps/web/src/features/returns/api/return-proposal.schema.ts:41` and `returns.types.ts:421`) already types it as a loose `string`/`z.string().nullish()`, not a strict enum — confirmed no FE schema edit is required for the wire contract to keep working, matching the plan's own § "Out of Scope" note. |
| Symbol tokens (`*.tokens.ts`) | Any token removed/renamed? | **N/A — no token touched.** |
| ORM schema | Field/table change ⇒ migration required? | **No migration needed, and the plan is correct that none is.** `issuedLineSnapshot` is `@Column({ type: 'jsonb', nullable: true })` (`invoice-record.orm-entity.ts:199`) — confirmed. `orderLineId?: string` is a pure TS-level widening of the JSON shape stored in that column; no DDL change, no `scripts/check-migration-timestamps.mjs` concern. |
| `check:invariants` rules | Will the plan trip a cross-context-import, service-interface, or deep-barrel-import check? | **No.** `CorrectionSnapshotLine` stays a local restatement rather than importing `InvoiceLine` — the plan explicitly preserves the existing file's documented no-cross-context-import posture (`docs/architecture-overview.md § Cross-context dependencies in core` is not engaged, since `returns` already imports nothing new from `invoicing` here — both types are widened **independently**, in their own contexts). No new `*.service.ts` file is created, so `check-service-interfaces.mjs` has nothing new to check. `check-ui-vocabulary` **will** run against the one new FE string (step 8/12 in the plan) — the plan already flags this as the acceptance criterion for that step, so it is anticipated, not a surprise finding here. |

**No Critical findings. No Warning findings beyond what the plan itself already anticipates and gates on.**

---

## Open Questions

1. **One filename placeholder in the plan, now resolved**: § 9 Testing Strategy names the mapper's
   unit-test file as `order-to-issue-invoice-command.mapper.spec.ts` with a note "confirm exact
   name before writing." **Confirmed present at that exact path**:
   `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.spec.ts`.
   No plan edit needed — this note can be treated as resolved during implementation.

2. **Guard ordering (name-empty-check before id-lookup)** — the plan's own § 8 "Edge Cases"
   already surfaces this as a deliberate, reviewable choice rather than an oversight (a return
   line with no name is never matched even when its order-line join is known). Not a blocker;
   flagged here only so implementation does not silently resolve it either way without the
   reviewer's sign-off the plan requests.

3. **Exact wording of the new `describeCorrectionNoMatchReason` case and the FE copy-map entry**
   is left open by the plan itself ("final wording subject to copy review"). Not a gate concern —
   `check-ui-vocabulary` will catch a forbidden term at implementation time regardless of the
   exact phrasing chosen.

None of the above block a clean implementation start.

---

## Summary

The plan touches ten existing artifacts across two CORE contexts (`invoicing`, `returns`) plus one
existing frontend component and its copy map — it creates nothing new (no port, service, token,
entity, or migration) and every widening it proposes is additive and non-breaking on every
contract surface checked (barrels, DTOs, tokens, schema, invariants). The one filename gap the
plan flagged for itself is now confirmed. **Verdict: READY** — implementation can proceed against
the plan as written.
