# Product Specs

This directory holds **product specifications** produced by Tier 1 of the [refinement workflow](../contributors/refinement-workflow.md). A product spec answers _what_ we're building, _for whom_, and _why_ — and locks that down before any engineering work begins.

## What lives here

- `product-spec-{N}-{slug}.md` — one file per Product Design GitHub issue
- `archive/` — specs that were refined but ultimately not built (preserved for posterity and as evidence against re-asking the same question)

## What does NOT live here

- **Implementation plans** — those live in `../plans/` and are produced by Tier 2 refinement (`/plan`)
- **Architecture Decision Records** — those live in `../architecture/adrs/`
- **Strategic / business documents** — those are not committed to the repo
- **Raw customer interview transcripts** — privacy. Sanitized findings only.
- **Roadmaps or quarterly plans** — those are not the same as per-feature specs

## Spec doc structure

Every spec follows this skeleton. Sections are filled out incrementally by the four phases of `/refine-product`. **Stage 1 calibration applies** — see [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md#project-stage-calibration) — some sections are skipped or simplified until OpenLinker has telemetry and a customer base.

```markdown
# Product Spec — #N {slug}

**Status:** phase X in progress | phase X complete | ready for implementation | deferred | archived
**Parent issue:** [#N](https://github.com/openlinker-project/openlinker/issues/N)
**Started:** YYYY-MM-DD
**Last updated:** YYYY-MM-DD

## 1. Problem
(Phase A — always required)

## 2. Affected persona
(Phase A — always required)

## 3. Evidence & user research
(Phase B — cite sources, always required)

## 4. Solution exploration
(Phase C — chosen shape + key sub-decisions + resolved open questions; always required)

## 5. Product specification
(Phase D — user stories + acceptance criteria; always required; user-visible AC only — engineering AC belongs in implementation plans)

## 6. Out of scope
(Phase D — top 5-7 items only; not an exhaustive future-feature catalog)

## 7. Definition of done
(Phase D — 3-5 qualitative bullets answering "what does the maintainer need to see before declaring v1 a success?". Stage 1 default. Replace with quantitative success metrics only when telemetry/analytics infra exists.)

## 8. Risks
(Phase D — top 3-5 product-direction risks only; engineering risks belong in implementation plans)

## 9. Implementation breakdown
(Phase E — list of spawned implementation issues; populated only if Gate D = YES)

## 10. Decision log
(Per phase: what was decided, who decided, why — always required)
```

**Sections explicitly NOT in the template** (avoid the slop):

- ❌ Anti-metrics — at Stage 1 there's no instrumentation to detect them
- ❌ Persona-fit verification subsection — circular self-congratulation
- ❌ Stakeholder alignment matrix — there are 1–2 maintainers, not 20 stakeholders
- ❌ Day-by-day effort breakdown — belongs in Tier 2 implementation plans
- ❌ Quantitative success metrics with %s — Stage 1 has no way to measure them

## Conventions

- **Filename:** `product-spec-{N}-{kebab-case-slug}.md` where `N` is the parent Product Design issue number
- **Status header:** always reflects current phase — never leave stale
- **Decision log:** append-only. If a decision is reversed, add a new entry referencing the prior one — don't rewrite history
- **Cite sources:** every external claim links to a URL, interview note, or ticket number
- **Plain language:** specs are read by future maintainers including non-engineers. No NestJS jargon. No file paths from the codebase. Save that for the implementation plan.

## Lifecycle

```
docs/specs/product-spec-N-slug.md            Product Design issue #N
   ↓ (refinement complete,                       ↓
      Gate D = YES, Phase E done)                CLOSED with state_reason: completed
remains in docs/specs/ —                         (refinement process done)
referenced by impl plans in ../plans/            impl children track impl
   ↓ (all impl children merged)                  on their own (open until PRs merge)
remains in docs/specs/ — historical record

OR

docs/specs/product-spec-N-slug.md            Product Design issue #N
   ↓ (Gate D = NO, "don't build")                ↓
moved to docs/specs/archive/                     CLOSED with state_reason: not_planned
                                                 (reasoning recorded in closing comment)
```

**The Product Design issue tracks the refinement process; the spec doc is the canonical record.** When refinement completes (Phase E done), the issue closes — leaving the spec doc in place as the lasting artifact. Impl children track impl progress independently; closing the PD issue does NOT depend on or block impl work.

See [refinement workflow § "Why close on Phase E"](../contributors/refinement-workflow.md#product-design-issues-product-design-label) for full rationale.

## See also

- [Refinement Workflow](../contributors/refinement-workflow.md) — how specs get produced
- [`docs/plans/`](../plans/) — implementation plans that consume specs
- [`docs/architecture/adrs/`](../architecture/adrs/) — Architecture Decision Records
