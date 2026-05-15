---
name: Implementation (maintainer)
about: A scoped implementation task derived from a Product Design issue (or a trivial fix that needs no product refinement).
title: '[IMPL] '
labels: ['implementation']
assignees: ''
---

> **For maintainers.** This issue type is for engineering work derived from a Product Design issue, an established pattern, or a bug fix. See the [refinement workflow](../../docs/contributors/refinement-workflow.md) for context.

## Design source

Pick one (delete the others):

- **Product Design parent:** Part of #N — see spec at `docs/specs/product-spec-{N}-{slug}.md`
- **Established pattern:** Extends existing pattern at [file/module path]; no product refinement needed
- **Bug fix:** Fixes bug #N; no product refinement needed
- **Tech debt:** Refactor / cleanup; rationale: [why now]

## Scope

[What this specific implementation issue covers. Should be a subset of the parent Product Design's scope, or a single coherent change.]

## Acceptance criteria

User-visible criteria first; technical criteria second.

- [ ] [User-visible behavior — e.g., "operator clicks X and sees Y"]
- [ ] [User-visible behavior]
- [ ] [Edge case handled]
- [ ] Tests added (unit + integration where applicable)
- [ ] Documentation updated if user-facing behavior changes
- [ ] No new ESLint warnings or type errors introduced

## Effort estimate

- [ ] **S** — 1–3 days
- [ ] **M** — 3–7 days
- [ ] **L** — 1–2 weeks
- [ ] **XL** — ⚠️ split into smaller issues before starting

## Dependencies

- **Blocked by:** #N, #N (must be merged first)
- **Blocks:** #N, #N (these can't start until this is done)
- **Independent** (this issue can be picked up immediately)

## Out of scope for THIS issue

- [Explicit cut from parent scope — what NOT to do here, even if tempting]
- [Another cut]

## Architecture notes (optional)

- New ports/adapters? [name them]
- New domain entities? [name them]
- Touches FE / API / Worker / Core / Integration? [pick]
- Migration needed? [yes/no — if yes, see `docs/migrations.md`]

## Next step after merge

- [ ] Closes Product Design parent #N (if last child)
- [ ] No further action — feature complete
- [ ] Triggers follow-up: #N
