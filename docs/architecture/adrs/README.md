# Architecture Decision Records (ADRs)

OpenLinker uses Architecture Decision Records to capture the **why** of architectural choices: what we picked, what we rejected, and what the trade-offs are. ADRs complement [`docs/plans/`](../../plans/) (the *what* of implementation) and [`docs/architecture-overview.md`](../../architecture-overview.md) (the current state of the system).

If you've ever asked "why does this work this way?" and couldn't find an answer in the code, an ADR is what was missing.

## When to write an ADR

Write one when **any** of the following holds:

- A choice affects multiple bounded contexts or the plugin contract.
- The decision has non-trivial trade-offs and at least one alternative was seriously considered.
- Future maintainers might ask "why didn't we just do X instead?"
- A future change would require coordinated migration across packages.

## When NOT to write an ADR

Don't write one for:

- Local refactors confined to one file or module.
- Bug fixes.
- Adding a feature without architectural impact.
- Routine dependency upgrades.

These belong in commit messages and PR descriptions.

## Conventions

### Numbering

ADRs are numbered sequentially with a 3-digit zero-padded prefix: `001`, `002`, … Filenames follow `NNN-kebab-case-title.md`. The title line in the ADR itself reads `# ADR-NNN: Title`.

### Status

- **Proposed** — under discussion, not yet adopted.
- **Accepted** — adopted; current direction.
- **Superseded by ADR-NNN** — replaced; kept in place for historical context.
- **Deprecated** — decision no longer applies; no replacement (e.g., the feature was removed).

ADRs are **append-only**. Never edit an accepted ADR's body to change the decision — write a new ADR that supersedes it.

### Dates

- **Forward-looking ADRs** (written at decision time): use today's date.
- **Retrospective ADRs** (documenting a decision that already shipped): use the date the underlying decision merged to `main`. Preserves historical accuracy and lets readers correlate the ADR with the code state.

### Authors

- **Forward-looking ADRs**: list the primary author and any co-authors (`@handle`).
- **Retrospective ADRs**: use `Authors: OpenLinker maintainers (retrospective documentation of decisions made across PRs #NNN, #MMM)`. Avoids speaking-for-someone-else on multi-author decisions and makes the multi-source nature of the record explicit.

### Length

Aim for **under 500 words**. Exceed only when the "Alternatives considered" section genuinely needs more than three options to be honest. The discipline forces sharp decisions; a 2000-word ADR usually reads like a design doc and should live in `docs/plans/` instead.

### Linking

Use canonical OpenLinker link styles:

- **Issues / PRs**: bare `#NNN` markdown. GitHub auto-links them within this repo.
- **Other ADRs**: relative path `[ADR-NNN](./NNN-...md)`.
- **Doc files**: relative path `[file](../file.md)`.
- **External GitHub URLs**: avoid unless absolutely necessary. The `scripts/check-repo-urls.mjs` invariant enforces canonical `SilkSoftwareHouse/openlinker` URLs and will fail the build on full URLs that drift.

## Cross-linking from architecture-overview.md

When an ADR documents a section of `docs/architecture-overview.md`, add a single italic pointer line at the top of that section, immediately after the section header:

```markdown
## Capability Abstractions (Business Roles)

*See [ADR-002](./architecture/adrs/002-capability-ports-with-sub-capabilities.md) for the decision rationale and rejected alternatives.*

Instead of coding directly against specific systems …
```

One pointer per section, identical format every time.

## How to write a new ADR

1. Copy [`template.md`](./template.md) to `NNN-kebab-case-title.md` where `NNN` is the next free 3-digit number (check the index below).
2. Fill in each section. Keep it short — the goal is "future maintainer can answer 'why?' in 90 seconds."
3. List 1–3 seriously-considered alternatives with one-line rationale for rejection each.
4. Open the PR. Reviewers focus on whether the decision is well-stated and the alternatives section is honest, not on prose polish.
5. If an existing ADR is superseded by your new one, update the old ADR's Status line to `Superseded by ADR-NNN` and add a `## Superseded by` section pointing at the new ADR. Do not edit the old ADR's body.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-001](./001-hexagonal-architecture-and-bounded-contexts.md) | Hexagonal architecture and bounded contexts | Accepted | 2024-10-01 |
| [ADR-002](./002-capability-ports-with-sub-capabilities.md) | Capability ports with sub-capability composition | Accepted | 2026-01-15 |
| [ADR-003](./003-plugin-sdk-trust-model.md) | Plugin SDK trust model | Accepted | 2026-04-30 |
| [ADR-004](./004-identifier-mapping-service.md) | Identifier mapping as core service with single seed | Accepted | 2024-11-15 |
| [ADR-005](./005-postgres-authoritative-job-dedup.md) | Postgres-authoritative job dedup with Redis Streams as transport | Accepted | 2026-05-13 |
| [ADR-006](./006-credentials-encryption-at-rest.md) | AES-256-GCM credentials encryption with prod-gate | Accepted | 2026-05-15 |
| [ADR-007](./007-syncjob-status-vs-outcome-split.md) | SyncJob status-vs-outcome split | Accepted | 2026-04-15 |
