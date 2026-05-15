<!--
Copy this file to NNN-kebab-case-title.md where NNN is the next free
3-digit number (see the index in ./README.md). Then fill each section.

Conventions:
- Length: aim for under 500 words. Exceed only when "Alternatives
  considered" genuinely needs more than three options.
- Status taxonomy: Proposed | Accepted | Superseded by ADR-NNN | Deprecated.
- Links: bare `#NNN` for issues/PRs, `[ADR-NNN](./NNN-...md)` for ADR
  cross-refs, relative `[file](../path)` for doc files. Avoid full
  GitHub URLs; `scripts/check-repo-urls.mjs` enforces this.
- ADRs are append-only. Never edit the body of an accepted ADR — write
  a new one that supersedes it.
-->

# ADR-NNN: [Short title]

- **Status**: Proposed
- **Date**: YYYY-MM-DD
- **Authors**: @handle

## Context

What problem are we solving? What constraints apply (technical, organizational, contractual)? Keep this section focused on the *situation* — not the decision itself.

## Decision

What did we choose? State the decision as a sentence or two; details belong in Consequences.

## Alternatives considered

- **Option A**: One-line description. Rejected because …
- **Option B**: One-line description. Rejected because …
- **Option C** (if relevant): …

Be honest about what was on the table. If only one option was seriously considered, this ADR may not need to be written — see [`README.md`](./README.md) § When to write an ADR.

## Consequences

**Pros:**
-
-

**Cons / trade-offs:**
-
-

**Migration path (if applicable):**
-

## References

- Related PRs: #NNN, #MMM
- Related issues: #NNN
- Related ADRs: [ADR-NNN](./NNN-related.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)

<!--
If this ADR supersedes an existing one, add the section below and
update the old ADR's Status line to `Superseded by ADR-NNN`. Do not
edit the old ADR's body — supersession is append-only on this end too.

## Supersedes

- [ADR-NNN](./NNN-old.md) — superseded because [one-line reason].
-->

