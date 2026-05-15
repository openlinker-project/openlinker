# Implementation Plan — #725 Architecture Decision Records (ADR) practice

## 1. Understand the task

**Goal.** Establish a formal ADR practice at `docs/architecture/adrs/`, seed it with retrospective ADRs documenting OpenLinker's load-bearing architectural decisions, and wire the practice into engineering standards + contributor docs so future decisions get captured at decision-time, not retrospectively.

**Layer.** DX / Docs only. No runtime code touched. No architectural changes — this PR captures decisions that *already shipped*.

**Explicit non-goals.**
- Migrating existing `docs/plans/*.md` content into ADRs. Plans capture the *what* of implementation; ADRs capture the *why* of architecture. They coexist, with ADRs cross-linking plans/PRs where useful.
- Formal community-RFC process for proposals. Out of scope; defer until OSS contributor pressure justifies it.
- Tooling for ADR generation (CLI scaffolders, status-tracker scripts). Manual markdown is fine.
- Changing any existing architectural decision. ADRs document, they don't relitigate.

## 2. Research findings

### 2a. Where decisions live today

- **`docs/architecture-overview.md`** — current state with some why-rationale interleaved (e.g., the #371 monochrome accent rationale, the #594 ORM-entities sub-barrel reasoning). Good for "what is the system today"; weak for "why did we choose this over X".
- **`docs/plans/*.md`** — 210+ implementation plans. Each has a "Design" + "Validation" section, but plans are scoped to *one feature*. They don't cover cross-cutting architectural decisions (e.g., "why capability ports over a mega-port", "why Postgres-authoritative dedup over Redis-only").
- **PR descriptions + commit messages** — high signal but ephemeral. Searching for "why did we pick X" across 700+ PRs is impractical for new contributors.
- **Issue bodies** — sometimes long enough to function as a partial ADR (e.g., #711, #709 both have proposal sections). Not discoverable in `docs/`.

The proposal in #725 explicitly positions ADRs as the missing piece: a small append-only collection capturing the *why* + *alternatives considered* + *trade-offs* for cross-cutting decisions, separate from per-feature plans.

### 2b. ADR conventions

Standard "lightweight ADR" format is Michael Nygard's original — Status / Context / Decision / Consequences. The issue body's template extends this with "Alternatives considered" (already implicit in Consequences, but worth making explicit so future readers see the rejected options without reverse-engineering them). I'll use the issue's template verbatim.

Common numbering: `NNNN-kebab-case-title.md` with 4-digit zero-padded prefix. Append-only — superseded ADRs stay in place, status updated to `Superseded by ADR-XXXX`. New decisions get the next number.

Status taxonomy I'll use (matches industry practice + issue's template):
- `Proposed` — under discussion, not yet adopted
- `Accepted` — adopted; current direction
- `Superseded by ADR-XXXX` — replaced; kept for history
- `Deprecated` — decision no longer applies; no replacement (e.g., feature was removed)

### 2c. Retrospective ADRs to write

The issue lists 7. Source material for each:

| ADR | Topic | Primary source |
|---|---|---|
| 0001 | Hexagonal architecture + bounded contexts | `docs/architecture-overview.md § High-Level Architecture` + `§ Hexagonal Architecture Structure` |
| 0002 | Capability ports with sub-capability composition | `docs/architecture-overview.md § OfferManagerPort`; `docs/engineering-standards.md § Port sub-capabilities`; PRs #337, #359 |
| 0003 | Plugin SDK trust model | `docs/architecture-overview.md § Plugin Manager / Integrations`; PR #593 (`@openlinker/plugin-sdk`); `docs/plugin-author-guide.md` |
| 0004 | Identifier mapping as core service | `docs/architecture-overview.md § Identifier Mapping Service` |
| 0005 | Postgres-authoritative job dedup with Redis Streams as transport | #711 issue body + PR; `docs/architecture-overview.md § Webhook Ingestion Flow` |
| 0006 | AES-256-GCM credentials encryption with prod-gate | #709 issue body + PR |
| 0007 | SyncJob status-vs-outcome split | #391, #400 issue bodies + PRs; `docs/architecture-overview.md § Sync Manager` |

Each ADR ~150-300 words. Total ~1500-2000 words across 7 ADRs.

### 2d. Wiring into existing docs

Three integration points the issue calls out:

1. **`docs/engineering-standards.md`** — add a "When to write an ADR" section. Position it between `## Code Review Guidelines` and `## ESLint & Prettier Configuration` so it sits in the workflow section, not the coding-standards section.
2. **`CONTRIBUTING.md`** — short paragraph in `## Architecture` referring contributors to the ADR practice for non-trivial changes.
3. **`.github/PULL_REQUEST_TEMPLATE.md`** — optional checkbox: "ADR written/referenced if this PR makes an architectural decision." Place in the existing checkboxes section, not as a hidden detail.

Optional per the AC: cross-link from `docs/architecture-overview.md` to relevant ADRs. I'll add a one-line "See ADR-0NNN" pointer in each affected section (capability ports, identifier mapping, sync manager, plugin manager).

## 3. Design

### 3a. Directory layout

```
docs/
└── architecture/
    └── adrs/
        ├── README.md                                       # practice, when-to-write, status taxonomy, index
        ├── template.md                                      # copy-paste template
        ├── 0001-hexagonal-architecture-and-bounded-contexts.md
        ├── 0002-capability-ports-with-sub-capabilities.md
        ├── 0003-plugin-sdk-trust-model.md
        ├── 0004-identifier-mapping-service.md
        ├── 0005-postgres-authoritative-job-dedup.md
        ├── 0006-credentials-encryption-at-rest.md
        └── 0007-syncjob-status-vs-outcome-split.md
```

`docs/architecture/` is a new directory. Today everything lives flat in `docs/`. Nesting under `architecture/` gives room for future siblings (e.g., `docs/architecture/diagrams/`, `docs/architecture/glossary.md`) without polluting the top level.

### 3b. README.md content outline

- One-sentence pitch: ADRs capture the *why* of architecture; they complement `docs/plans/` (the *what* of implementation).
- "When to write an ADR" checklist — lifted from the issue body.
- "When NOT to write an ADR" anti-checklist — also from the issue body.
- Status taxonomy + supersession protocol.
- Numbering convention.
- Index table: ADR-NNNN → title → status. Updated on every new ADR.
- Pointer to `template.md`.

### 3c. Template content outline

Verbatim from the issue body, plus:
- A "References" section as the final block (related PRs, plans, issues — keeps them discoverable).
- A note at the top instructing authors to copy the file and increment the number.

### 3d. ADR content shape

Each retrospective ADR follows the template strictly:
- **Status**: `Accepted` (these all shipped already)
- **Date**: the date the underlying decision shipped, NOT today's date — preserves historical accuracy
- **Authors**: derive from the PR's author / commit history; primary author + co-authors as listed in commits
- **Context** (~80 words): what problem we were solving
- **Decision** (~80 words): what we chose
- **Alternatives considered** (~100 words): 1-3 rejected options with one-line rationale each
- **Consequences** (~100 words): pros / cons / migration path
- **References** (~3-5 links): PR, issue, related ADRs, primary doc section

Total per ADR: ~400 words including headers/markdown.

### 3e. Wiring updates

**`docs/engineering-standards.md`** — new section before `## ESLint & Prettier Configuration`:

```markdown
## Architecture Decision Records (ADRs)

Non-trivial architectural decisions are captured in `docs/architecture/adrs/`. Write an ADR when:
- A choice affects multiple bounded contexts or the plugin contract
- The decision has non-trivial trade-offs and at least one alternative was seriously considered
- Future maintainers might ask "why didn't we just do X instead?"

Don't write one for local refactors, bug fixes, or routine dependency upgrades. See [`docs/architecture/adrs/README.md`](./architecture/adrs/README.md) for the full practice.
```

**`CONTRIBUTING.md § Architecture`** — append:

```markdown
For non-trivial architectural changes, consider writing an ADR. See
[`docs/architecture/adrs/README.md`](./docs/architecture/adrs/README.md)
for when and how. Existing ADRs document load-bearing decisions
(hexagonal architecture, capability ports, plugin trust model, …)
and are a useful read before proposing changes that touch them.
```

**`.github/PULL_REQUEST_TEMPLATE.md`** — add to the existing checklist section (after the migration checkbox, before DCO sign-off):

```markdown
## ADR

- [ ] If this PR makes a non-trivial architectural decision (affects
      multiple contexts, plugin contract, or has alternatives worth
      documenting), an ADR is included under
      `docs/architecture/adrs/` or referenced in the PR description.
      See [`docs/architecture/adrs/README.md`](../docs/architecture/adrs/README.md).
      Tick this box for PRs that don't make architectural decisions
      too — it's trivially satisfied.
```

### 3f. Cross-links from `docs/architecture-overview.md`

Light-touch — one `*See [ADR-NNNN](./architecture/adrs/NNNN-...md) for the decision rationale.*` line under each affected section. Avoid rewriting the section. The four sections that map to retrospective ADRs:
- `## Capability Abstractions` → ADR-0002
- `## Identifier Mapping Service` → ADR-0004
- `## Plugin Manager / Integrations` → ADR-0003
- `## Sync Manager` → ADR-0007
- `## Webhook Ingestion Flow` → ADR-0005

ADR-0001 (hexagonal) and ADR-0006 (encryption) don't have a single dedicated section in `architecture-overview.md`; they're cross-cutting. I'll add ADR-0001 to the top-level `## High-Level Architecture` header and ADR-0006 to the section that mentions credentials.

## 4. Step-by-step plan

1. **`docs/architecture/adrs/README.md`** — write practice doc + index table.
2. **`docs/architecture/adrs/template.md`** — write template.
3. **`docs/architecture/adrs/0001-hexagonal-architecture-and-bounded-contexts.md`** — retrospective ADR.
4. **`docs/architecture/adrs/0002-capability-ports-with-sub-capabilities.md`** — retrospective ADR.
5. **`docs/architecture/adrs/0003-plugin-sdk-trust-model.md`** — retrospective ADR.
6. **`docs/architecture/adrs/0004-identifier-mapping-service.md`** — retrospective ADR.
7. **`docs/architecture/adrs/0005-postgres-authoritative-job-dedup.md`** — retrospective ADR.
8. **`docs/architecture/adrs/0006-credentials-encryption-at-rest.md`** — retrospective ADR.
9. **`docs/architecture/adrs/0007-syncjob-status-vs-outcome-split.md`** — retrospective ADR.
10. **`docs/engineering-standards.md`** — add ADR section.
11. **`CONTRIBUTING.md`** — append ADR paragraph.
12. **`.github/PULL_REQUEST_TEMPLATE.md`** — add ADR checkbox.
13. **`docs/architecture-overview.md`** — add 5 cross-link pointers.
14. **Quality gate** — `pnpm lint` (must pass; markdown-only changes shouldn't trigger anything, but the `check:invariants` script runs).
15. **Commit + push + open PR with `Closes #725`**.

## 5. Validation

- **Architecture compliance**: docs only; no code touched. No architectural impact.
- **Naming**: ADR files match `NNNN-kebab-case.md`. README + template follow established docs/ conventions.
- **Testing**: docs change; no tests needed. Lint must still pass.
- **Security**: no security surface.
- **Quality gate**: `pnpm lint` runs `check:invariants`; markdown changes shouldn't affect any of them.

## Open questions

- **Dating ADRs**: I'm using the underlying decision's ship date (extracted from `git log` for the merge commit), not today's date. Preserves historical accuracy and helps future readers correlate ADRs with code state. The issue's template says `Date: YYYY-MM-DD` without specifying; I'll annotate the README that retrospective ADRs use the original decision date.
- **Authors**: For retrospective ADRs the "author" is ambiguous — the PR author wrote the code; the ADR is being written by me retrospectively. I'll list the original PR author and add `(retrospective: @ai/claude-code, this PR)` to make the dual provenance explicit.
- **Scope of retrospective ADR-0001**: "Hexagonal architecture + bounded contexts" is the broadest decision in the codebase and could easily balloon to 1000+ words. I'll keep it disciplined at ~400 words, mostly pointing at `architecture-overview.md` for detailed structure and using the ADR space for *why we picked hexagonal* and *what we rejected* (e.g., layered/MVC, vertical slices, event-driven-only). The README will note that ADR length is a feature, not a bug — short ADRs encourage authors to make sharp decisions.

## Risks

- **Author attribution drift.** Listing past PR authors in retrospective ADRs could feel like attribution theatre. Mitigation: keep author lines short and factual; cite the merge PR for evidence. If a past author objects, ADRs are append-only — supersede with a corrected version.
- **Cross-link rot.** Adding `*See ADR-0NNN*` pointers in `architecture-overview.md` creates drift risk if an ADR is later superseded. Mitigation: ADRs are append-only, so the pointer-target file never disappears. Status changes on the ADR itself, not the doc that links to it.
- **PR template fatigue.** Adding another optional checkbox to the PR template risks "tick everything" noise. Mitigation: the checkbox text explicitly says "Tick this box for PRs that don't make architectural decisions too — it's trivially satisfied" (mirrors the migration-checkbox pattern already in the template). Keeps the checkbox useful as a prompt without forcing real engagement when not relevant.
