# Readiness Gate: `fulfillment_works` / `_lines` / `_holds` schema (#2392, `W3a-3`)

**Plan**: `docs/plans/implementation-plan-fulfillment-work-schema.md`
**Date**: 2026-08-30
**Base**: `oms-programme-wave-3a` @ `77b6e58e8`
**Verdict**: **NEEDS-REVISION** — two plan amendments (G-1, G-2), no contract break, no reuse collision.

The revisions are small and mechanical. Nothing in the plan's architecture is wrong; two statements
in it are *incomplete* in ways that would have been discovered mid-implementation.

---

## 1. Reuse findings

Exhaustive grep of `libs/ apps/ scripts/ docs/` for `FulfillmentWork`, `fulfillment_work`,
`fulfillment_hold`, `FulfillmentHold`, `FULFILLMENT_WORK`, `FulfillmentModule`,
`FulfillmentWorkRepository`, `FulfillmentPersistenceError`.

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `fulfillment_works` table | **NEW** | no such table in any migration |
| `fulfillment_work_lines` table | **NEW** | idem |
| `fulfillment_holds` table | **NEW** | idem; `order_holds` is the *order*-grain sibling, deliberately distinct |
| `FulfillmentWorkRepositoryPort` | **NEW** | zero hits outside docs |
| `FulfillmentWorkRepository` | **NEW** | zero hits outside docs |
| `FulfillmentModule` | **NEW** | zero hits outside docs |
| `FULFILLMENT_WORK_REPOSITORY_TOKEN` | **NEW, and reserved** | `fulfillment.tokens.ts:9-12` names it for #2392 |
| `FulfillmentPersistenceError` | **NEW** | zero hits |
| `FulfillmentWork*` vocabulary types | **ALREADY EXISTS → reuse** | `libs/core/src/fulfillment/domain/types/` (#2391) — expected |
| `HoldReason` | **ALREADY EXISTS → reuse** | `order-lifecycle/domain/types/hold-reason.types.ts:47,58,66` |
| `checkFulfillmentWorkLineCapacity` | **ALREADY EXISTS → mirror** | `fulfillment-work.types.ts`; the DB `CHECK` is its twin |

**No (c)-class persistence collision anywhere.** Every other hit is either #2391's vocabulary or
prose in a docblock/plan anticipating this slice.

---

## 2. Backward-compatibility findings

| Surface | Assessment | Severity |
|---|---|---|
| Top-level barrels | purely additive (`FulfillmentModule` + one token); no symbol removed or renamed | none |
| Port signatures | no existing `*Port` touched | none |
| DTO shapes | none touched — this slice ships no HTTP surface | none |
| Symbol tokens | `fulfillment.tokens.ts` goes `export {}` → one Symbol. The `export {}` was load-bearing *only* while the file had no export; adding a real one preserves module-ness, so the barrel's `export *` still compiles | none |
| ORM schema | three new tables + migration `1864000000000` | Warning (expected, planned) |
| `check:invariants` | see § 3 | Warning (one action required) |

Additive-only. Nothing in the tree consumes `@openlinker/core/fulfillment` today (#2391 shipped the
vocabulary ahead of its consumers), so the blast radius of a barrel change is zero.

---

## 3. Guard-by-guard clearance

| Guard | Trips? | Deciding logic |
|---|---|---|
| `barrel-purity.spec.ts` | **No** for the module/entities/repo; **YES** for `HoldReason` unless registered | walker `continue`s unless the specifier starts with `@openlinker/core/` — *"a leaf need not be framework-free… `@nestjs/*`, `typeorm`, `node:*` are ordinary infrastructure dependencies"*. `sales-documents` is the precedent that gained a module, repositories and ORM entities and stayed a valid leaf. |
| `check-no-injection-contracts.mjs` | No | already registered; R3 matches exact specifiers; modules/entities/repos invisible to it |
| `check-cross-context-imports.mjs` | No | `HoldReason` matches none of the four deny patterns (`RepositoryPort$`, `OrmEntity$`, `Adapter$`, `Dto$`) and falls under the catch-all allow-shape for plain types |
| `check-service-interfaces.mjs` | **No — out of scope** | its predicate requires `application/services/` **and** `.service.ts`; an `infrastructure/persistence/repositories/*.repository.ts` matches neither |
| `check-workspace-dep-declarations.mjs` | No | inspects `@openlinker/*` specifiers only; `typeorm` / `@nestjs/*` not examined; no new package edge |
| `check-architecture-gates.mjs` | No | its three rules scan ADR markdown, `Connection.config` knob helpers, and the products capability-rung dir — none matched |
| `check-migration-timestamps.mjs` | No | `1864000000000` free and strictly greater than both baselines (§ 4) |
| `check-ui-vocabulary.mjs` | No | but note it registers `FulfillmentWork` as a **forbidden UI term**; this slice touches no `apps/web` file, and must not |

**Confirmed count: 35 unique checks** (61 segments incl. `--self-check` pairs).

---

## 4. Migration number — cleared

- Dirs scanned: `apps/api/src/migrations` + the single manifest entry
  `libs/integrations/allegro/src/migrations` (`scripts/plugin-migration-dirs.json`).
- Max on `origin/main`: **`1849000000003`** (127 core files + Allegro's `1767900000000`).
- Max on the working tree: **`1863000000000`** (147 core files, all prefixes unique; 20 new-on-branch).
- **`1864000000000` is free and strictly greater than both.** ✅

Rule-2 regex, `check-migration-timestamps.mjs:60`:
```js
const CLASS_RE = /export\s+class\s+\w+?(\d+)\s+implements\s+MigrationInterface/;
```
`\w+?` is lazy, so the captured group is the *trailing* digit run — the class name must stay
alphabetic before the timestamp. `CreateFulfillmentWorks1864000000000` satisfies it.

---

## 5. Required plan revisions

### G-1 (BLOCKING for the plan text) — `isHoldReason` is unavailable to this leaf

The plan's D-1 authorises the `HoldReason` **type** import but says nothing about how the column is
read back, and § 4 leaves `reason`'s coercion unstated. The house rule is *"narrow-or-fallback on
read, never a blind cast"* — **and it cannot be followed here.**

`automation` narrows via `isHoldReason`, a **value** import
(`automation-condition.types.ts:37-38`). It may do that because it is not a registered leaf.
`fulfillment` is, and `barrel-purity.spec.ts` rejects a sibling value import *unconditionally,
regardless of the allow-set*:
```ts
expect(typeOnly ? located : `FORBIDDEN VALUE IMPORT — ${located}`).toBe(located);
```
Importing the guard would cost the leaf property; restating the union locally is what ADR-053
§ Alternatives rejects by name.

**Resolution**: type-only import of `HoldReason`; the ORM column stays `varchar(64)` typed `string`;
`toDomain` casts at the boundary — the in-tree `ReturnLine` precedent
(`entity.custodyState as ReturnCustodyState`, `moneyState`, `disposition`), which does exactly this
for three of its four vocabulary columns. Record the constraint in the repository docblock so the
cast reads as a decision, not an oversight.

**Corollary**: use the `import type { … }` *statement* form. `barrel-purity.spec.ts` classifies an
inline `import { type X }` as a VALUE import.

### G-2 (minor) — state the `ol_fulfillmentwork_*` id shape and why no override is added

The plan assumes the prefix without justifying it. `formatInternalId('FulfillmentWork')` yields
`ol_fulfillmentwork_<32-hex>` via the lowercase fallback. An override would first require a
`CoreEntityTypeValues` member, because `ENTITY_TYPE_ID_PREFIX` is
`Partial<Record<CoreEntityType, string>>` — a wider change with no benefit. `returns` (#2327) and
`inventory` locations take exactly this path (`formatInternalId('Return')` / `'Location'`, no member,
no override), and `return.orm-entity.ts:14-16` documents it. Accept the fallback; say so.

---

## 6. Open questions carried forward

**OQ-1 — `shipment_lines.fulfillmentWorkId` (plan D-8). CONFIRMED NOT DELIVERABLE.**
Independently verified: no `shipment_lines` table, ORM entity or migration exists on this branch or
on `origin/main`. Every hit across `libs/` and `apps/` is **zero**; all matches are in `docs/`.
`libs/core/src/shipping` declares one entity, `@Entity('shipments')`, with no line-level child.

Decisive new evidence: **#2391's own merged plan already assigns this column to #2402** —
`docs/plans/implementation-plan-fulfillment-context.md:53`. Combined with #2392's own text
("wired in `W3a-13`"), the plan of record and the issue agree that #2402 owns the wiring; the AC
line in #2392 is the outlier, and it presumes a table no wave has created.

The plan's option (a) — defer, ship nothing for this AC, state it plainly — is therefore **not a
reinterpretation** but alignment with the parent plan. No revision needed; flagged to the human.

**OQ-2 — the `fulfillment_works` grouping index is non-unique** (plan § 4). Creation idempotency is
#2395's to define. Recorded so #2395 knows the index is deliberately permissive rather than an
oversight.

**OQ-3 — the worker harness `reset()` truncates a hardcoded short list** that will not include the
fulfilment tables. Harmless for this slice (the boot spec resolves tokens and writes no rows), but a
later worker int-spec that writes fulfilment rows must extend it.

---

## 7. Verdict

**NEEDS-REVISION.** Apply **G-1** and **G-2** to the plan, then implement. No reuse collision, no
contract break, every guard cleared, the migration number confirmed free. OQ-1 is a scope reduction
sanctioned by the parent plan and needs a human's acknowledgement rather than a plan change.
