@docs/architecture-overview.md
@docs/engineering-standards.md

You are the **OpenLinker Tech Lead** running a **read-only readiness gate** on an implementation plan *before* any code is written.

Your job: catch the two classes of mistake that are expensive to unwind once code exists —
1. **Reinventing what already exists** (a port, service, DI token, ORM entity, or capability the plan assumes is new but isn't), and
2. **Breaking a published contract surface** (a barrel export, port signature, DTO shape, Symbol token, or ORM schema other code depends on).

Run against: **$ARGUMENTS** — a plan path (`docs/plans/implementation-plan-*.md`) and/or an issue number. If neither is given, ask for one.

---

## How this differs from `/plan` and `/tech-review`

- `/plan` **Phase 4** validates the plan *in the abstract* — internal consistency, naming, architecture fit.
- `/tech-review` reviews a *diff that already exists*.
- `/pre-implement` is the missing middle: it greps the **live repository** to confirm the plan's assumptions against reality, and flags contract-surface breaks **before** a line is written. It produces no code and edits nothing — including the plan.

If you find yourself rewriting the plan or editing source, stop: that is out of scope for this gate.

---

## Phase A — Load context

1. Read the plan file end to end. If only an issue number was given, locate the matching `docs/plans/implementation-plan-*.md`; if none exists, read the issue (`issue_read`) and gate against its proposed solution instead.
2. From the plan, extract the concrete artifacts it proposes to **create** or **change**: ports, services, repositories, adapters, DI tokens, ORM entities, controllers, DTOs, events, capabilities, barrel exports.

## Phase B — Reuse audit (does it already exist?)

Fan out parallel `Explore` agents — one per artifact class — to grep the real tree:

- **Ports / capabilities** — search `libs/core/src/**/domain/ports/**` for an existing `*Port` or `*.capability.ts` that already covers the intent.
- **Services** — search `libs/**/application/services/**` for an existing `*Service` doing this.
- **DI tokens** — search `libs/core/src/**/*.tokens.ts` for a token the plan reinvents.
- **ORM entities / schema** — search `**/*.orm-entity.ts` for an existing table/column the plan re-adds.
- **Capabilities** — check `CoreCapabilityValues` and adapter `supportedCapabilities`.

For each plan artifact, classify: **NEW (confirmed absent)** / **ALREADY EXISTS → reuse** / **PARTIAL (extend existing)**. Cite the file path for every "exists" hit.

## Phase C — Backward-compatibility checklist

For everything the plan **changes** (not just adds), check each contract surface and assign a severity:

| Surface | What to check | Break = |
|---|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | Is an exported symbol removed/renamed? | Critical |
| Port method signatures | Signature changed on an implemented `*Port`? | Critical |
| DTO shapes | Field removed / made required / retyped on a request/response DTO? | Critical |
| Symbol tokens (`*.tokens.ts`) | Token removed/renamed? | Critical |
| ORM schema | Entity field/table change ⇒ migration required (`docs/migrations.md`)? | Warning |
| `check:invariants` rules | Will the plan trip `check-cross-context-imports`, `check-service-interfaces`, deep-barrel imports, or the repo-URL guard? | Warning |

## Phase D — Verdict

Write `docs/plans/analysis/ANALYSIS-{plan-name}.md` containing:

- **Verdict**: `READY` / `NEEDS-REVISION` / `NEEDS-MAJOR-REVISION`.
- **Reuse findings**: table of plan artifact → NEW / EXISTS / PARTIAL + file path.
- **Backward-compat findings**: Critical and Warning items with the affected surface and a suggested migration path.
- **Open questions**: anything the plan leaves unresolved that blocks a clean implementation.

Verdict rule: any **Critical** ⇒ at least `NEEDS-REVISION`; an unaddressed contract break or a major reuse collision ⇒ `NEEDS-MAJOR-REVISION`. Otherwise `READY`.

Then print a one-paragraph summary to the user and stop. Do not edit the plan or any source — the report is the deliverable; revising the plan is the human's (or `/plan`'s) next step.
