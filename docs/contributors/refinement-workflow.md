# Refinement Workflow

This document defines how OpenLinker maintainers turn an idea into shipped code. It exists because the most expensive bugs are features that nobody needs — and the cheapest way to prevent them is to refine the product question before committing engineering time.

## The two tiers

Every non-trivial feature passes through two distinct tiers of refinement:

```
Idea
  ↓
┌────────────────────────────────────────────────────────────┐
│ Tier 1 — Product refinement                                │
│ Question: should we build it? what exactly? for whom? why? │
│ Output: product spec in docs/specs/                        │
│ Skill: /refine-product <issue>                             │
│ ⏸ Gate: "commit engineering time?" YES / NO / DEFER       │
└────────────────────────────────────────────────────────────┘
  ↓ YES
┌────────────────────────────────────────────────────────────┐
│ Tier 2 — Technical refinement                              │
│ Question: how exactly to build it?                         │
│ Output: implementation plan in docs/plans/ + ADRs          │
│ Skill: /plan <issue> (per implementation issue)            │
│ ⏸ Gate: "ready for /work?" YES / NO                       │
└────────────────────────────────────────────────────────────┘
  ↓ YES
┌────────────────────────────────────────────────────────────┐
│ Implementation                                             │
│ Skill: /work <issue>                                       │
│ Output: merged PR                                          │
└────────────────────────────────────────────────────────────┘
```

The tiers are **sequential and gated**. You cannot skip Tier 1 by being clever about Tier 2. The whole point of Tier 1 is to validate that the engineering time about to be spent in Tier 2 + implementation is well-spent.

## When you can skip Tier 1

Tier 1 is **not** required for:

- **Bug fixes** — the problem is the bug; refinement happens by reading the bug report
- **Established patterns** — adding a second adapter for an existing port (e.g. `ShopifyOrderSourceAdapter` after `AllegroOrderSourceAdapter` exists) doesn't need a new product spec
- **Tech debt** — refactors, dependency upgrades, test improvements
- **Maintenance** — fixing flaky tests, doc cleanups, dev-env improvements

For these, file an `[IMPL]` issue directly with `Design source: established pattern / bug fix / tech debt`.

## When Tier 1 is mandatory

- **New user-facing capabilities** — anything that an operator, merchant, or agency would describe as "a feature"
- **New bounded contexts or domain concepts** — adding "Shipments" as a first-class entity, introducing a new capability port type
- **Cross-cutting changes** — touching multiple bounded contexts in service of a coherent user-facing goal
- **Strategic bets** — initiatives that consume >2 weeks of engineering time

If in doubt: file a Product Design issue. The cost of unnecessary refinement is a few hours of writing. The cost of unnecessary code is months of maintenance.

## Issue types

OpenLinker uses two **maintainer-only** issue types alongside the existing contributor templates:

### Product Design issues (`product-design` label)

- **Created by:** maintainers, often by converting a community feature request
- **Template:** `.github/ISSUE_TEMPLATE/product-design.md`
- **Lifecycle:** stays open as an epic until all child implementation issues are closed and post-launch validation confirms the spec
- **Output:** product spec at `docs/specs/product-spec-{N}-{slug}.md` + N implementation children

### Implementation issues (`implementation` label)

- **Created by:** maintainers, typically spawned from a Product Design parent's Phase E
- **Template:** `.github/ISSUE_TEMPLATE/implementation.md`
- **Lifecycle:** closed by a single PR via `Closes #N`
- **Output:** merged code + tests + docs

Contributor issue types (`feature_request`, `bug_report`, `developer_task`, `new_integration`, `question`) are unchanged and remain the entry point for community contributions.

## Tier 1: Product refinement — phase by phase

The `/refine-product <issue>` skill executes four phases. Each ends in a ⏸ gate where the maintainer must explicitly confirm before the next phase starts.

### Phase A — Problem definition

**Goal:** lock down whose pain we're solving, how painful, and why now.

**Activities:**
- Restate the problem in concrete terms (who, how often, how painful)
- Identify the affected persona (size, sophistication, volume, geography)
- Surface ambiguities in the original issue body

**Artifact:** `## 1. Problem` and `## 2. Affected persona` in the spec doc

**Gate A:** maintainer confirms the problem statement or asks for re-framing

### Phase B — Evidence & user research

**Goal:** validate (or invalidate) the problem statement against actual user signal.

**Activities:**
- Inventory existing evidence (past interviews, support tickets, community discussions)
- Identify gaps requiring new research
- Optionally: conduct discovery interviews (3–5 users, 5–10 specific questions)
- Use the `product-researcher` subagent for competitor analysis and community signal aggregation

**Artifact:** `## 3. Evidence & user research` in the spec doc (with cited sources)

**Gate B:** maintainer confirms evidence supports the problem statement, or returns to Phase A if not

### Phase C — Solution exploration

**Goal:** explore the solution space without committing to a specific shape.

**Activities:**
- Produce 3–5 candidate solution shapes with trade-offs
- Compare against problem fit, persona fit, strategic fit, risk
- Define success metrics (specific, measurable, time-bounded)
- Honestly evaluate the "do nothing" alternative

**Artifact:** `## 4. Solution exploration` in the spec doc

**Gate C:** maintainer picks the chosen shape (or a hybrid)

### Phase D — Product specification

**Goal:** produce the contract that Tier 2 must implement.

**Activities:**
- Write user stories in "As [persona], I want [outcome], so that [benefit]" form
- Write user-visible acceptance criteria
- List explicit out-of-scope items with reasons
- Define success metrics with numbers and timeline
- Identify product-direction risks (not technical risks)

**Artifact:** complete spec doc with `Status: phase D complete — ready for implementation breakdown`

**Gate D — the big gate:** maintainer commits engineering time, defers, or closes

### Phase E — Spawn implementation issues (only on Gate D = YES)

**Goal:** create the GitHub issues that engineering will pick up.

**Activities:**
- Identify independently shippable implementation slices
- Create `[IMPL]` issues with `Part of #N` reference to the parent
- Link from parent Product Design issue body

**Artifact:** GitHub implementation issues, all linked to parent

## Tier 2: Technical refinement — via `/plan`

After Phase E, each implementation issue lives independently. Maintainers (or contributors who pick them up) use the existing `/plan <issue>` skill if the technical work is non-trivial, then `/work <issue>` for execution.

**Use `/plan` when:**
- The issue introduces a new architectural concept (new port type, new bounded context, new persistence pattern)
- Multiple ADRs are needed
- The work spans multiple layers and requires coordination

**Skip `/plan` and go straight to `/work` when:**
- The issue extends an established pattern
- The architecture is fully determined by existing conventions
- The change is small enough that a plan adds noise rather than clarity

`/plan` produces `docs/plans/implementation-plan-{N}-{slug}.md` and may produce ADR drafts at `docs/architecture/adrs/` if non-trivial architectural decisions are made.

## Artifacts and where they live

| Artifact | Location | Created by |
|---|---|---|
| Product spec | `docs/specs/product-spec-{N}-{slug}.md` | `/refine-product` (Phase A-D) |
| Implementation plan | `docs/plans/implementation-plan-{N}-{slug}.md` | `/plan` |
| ADRs | `docs/architecture/adrs/ADR-{NNN}-{slug}.md` | `/plan` or ad-hoc per ADR practice (#725) |
| Product Design issues | GitHub | maintainers |
| Implementation issues | GitHub | maintainers (Phase E) |
| Merged code + tests | repository | `/work` |

## Resume and recovery

Refinements span hours to weeks. The workflow must survive interruption:

- **Resume `/refine-product`:** re-running the skill on the same issue number reads the existing spec doc and picks up from the recorded `Status:` header
- **Multi-session continuity:** spec doc header always reflects current phase; previous-phase artifacts are immutable (don't rewrite Phase A findings after they were confirmed)
- **Mid-refinement scope change:** if Phase C or D reveals that Phase A's problem statement was wrong, the workflow loops back rather than forcing forward. Note the regression in the spec doc.

## When refinement fails

It's a valid outcome — and a healthy one. Two failure modes:

### "Don't build" outcome (Gate D = NO)

- Close the Product Design issue with `state_reason: not_planned`
- Archive the spec doc to `docs/specs/archive/`
- Record the reasoning in the closing comment — future maintainers asking the same question deserve to find your answer

### Indefinite defer (Gate D = DEFER)

- Leave issue open with `Status: phase D complete — deferred pending [reason]`
- Do not spawn implementation issues
- Revisit when the deferring condition changes (e.g., "deferred until we have a DACH design partner")

## Principles

1. **Default to "don't build."** Most features that survive Tier 1 do because their problem statement held up to scrutiny. Most features that don't survive shouldn't have been built.
2. **Cite evidence.** Every product claim should have a source — an interview note, a support ticket, a competitor doc URL. Hypotheses are fine, but they must be labelled as such.
3. **Surface alternatives.** Refinement is exploration, not advocacy for a predetermined solution.
4. **Persist progress.** Every phase update writes to the spec doc, so the workflow survives interruption and audit.
5. **Time-box gates.** A Tier 1 gate that's been open for 2+ weeks is a signal that something else is wrong (lack of conviction, missing evidence, wrong issue scope) — not a signal to lower the standard.
6. **Calibrate to project stage** (see below).

## Project-stage calibration

The same workflow runs on a pre-revenue OSS prototype and on a mature platform with 10k customers. Output depth must scale to stage.

OpenLinker is in **Stage 1: pre-paying-customer**. Until we have ≥3 paying customers (Cloud subscribers) or ≥10 design-partner deployments, spec docs follow these caps:

| Section | Stage 1 cap | Stage 2+ guidance |
|---|---|---|
| Out-of-scope list | **Top 5–7 items** that someone might actually ask about | Comprehensive list once support tickets surface the questions |
| Risks | **Top 3–5 product-direction risks** | Add engineering risks once you have operational scars |
| Success metrics | **Skip OR replace with qualitative "definition of done"** | Quantitative metrics only when telemetry/analytics infra exists |
| Anti-metrics | **Skip entirely** | Add when you can actually instrument them |
| Effort estimate | **Rough order-of-magnitude only** ("~M effort", "~5–6 weeks") | Day-by-day breakdown belongs in Tier 2 implementation plans, not spec |
| User stories / acceptance criteria | **Always required** | Always required |
| Decision log | **Always required** | Always required |

**The test:** for every section before writing, ask *"will anyone actually use this — measure it, reference it, audit against it?"* If the answer is "no — it's just here because product specs are supposed to have it", **skip the section**. Filler sections are worse than missing sections: they make the doc look comprehensive while contributing zero signal.

**Common slop to avoid in Stage 1:**

- Success-metric percentages we have no infrastructure to measure ("80% adoption within 7 days")
- Anti-metrics we'll never instrument ("abandon rate > 20% triggers re-review")
- Persona-fit verification sub-sections (circular self-congratulation)
- "Cross-cutting acceptance criteria" that are really engineering concerns
- Long out-of-scope lists where every item is "obvious v2"
- Risk catalogs with engineering risks (R5: rate limits, R8: validation drift, etc.) — those belong in implementation plans
- Comprehensive "stakeholder alignment" sections when there are 1–2 maintainers

A 1-page conviction spec that captures the real reasoning beats a 10-page spec that buries it in compliance theatre.

## Related documents

- `docs/architecture-overview.md` — the technical context that constrains Tier 2 design
- `docs/engineering-standards.md` — code-level conventions that Tier 2 must follow
- `docs/architecture/adrs/` — Architecture Decision Records produced during Tier 2 (see #725)
- `docs/specs/README.md` — what lives in the spec directory and how to navigate it
- `.claude/commands/refine-product.md` — the Tier 1 skill itself
- `.claude/commands/plan.md` — the Tier 2 skill
- `.claude/commands/work.md` — implementation skill
