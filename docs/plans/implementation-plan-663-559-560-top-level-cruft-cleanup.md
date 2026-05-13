# Implementation Plan — Top-level cruft cleanup (#663, #559, #560)

Three related findings from `#670` (OSS launch readiness) and Modularity
Thread A (`#547`): the repo root contains 6 stale `ISSUE_*.md` planning
files plus an empty `.md` file. For an internal repo these are
inconsequential; for a public-facing OSS repo they dominate the
first-glance file list above `LICENSE` / `README.md` / `CONTRIBUTING.md`
and make the project look unfinished.

## Goals

- **#663** — Repo root contains only standard OSS files + project
  config. No `ISSUE_*.md` planning docs, no empty `.md`.
- **#559** — Move-or-delete the six top-level `ISSUE_*.md` files.
- **#560** — Delete the zero-byte `.md` file.

## Non-goals

- **Re-litigating the content** of any `ISSUE_*.md`. The work each one
  describes has shipped (the corresponding GitHub issues #30/#40/#44/
  #46/#47/#48 are closed or superseded). The files are historical
  planning artifacts only.
- **Rewriting `docs/next-steps-issue-47-offer-sync.md` /
  `docs/implementation-plan-issue-47-offer-mapping-sync.md`.** Both
  reference issue #47 by name but neither has an inline hyperlink to
  the root-level `ISSUE_47.md` (verified with grep). They stay where
  they are; this PR does not touch their content.
- **Renaming the legacy files.** They keep their existing names so
  `git log --follow` continues to work cleanly. Renaming on the same
  PR as the move would muddy the history.

## Layer classification

Pure **DX / Governance / Docs**. No code, no architecture impact, no
migrations, no tests required.

## Decision — outright delete (Option B, user choice)

Both #663 and #559 frame the disposition as "move-or-delete". The work
each file described has shipped, so the content is no longer actionable
and the only forward-facing question is recovery — i.e., is the chance
that someone needs to read one of these files again ≥ the cost of
keeping them visible in `docs/plans/legacy/`?

Verdict from the user: **delete outright**. Rationale:

- Content is preserved in git history. `git show <commit>:ISSUE_30.md`
  reconstructs the file at any point; `git log -- ISSUE_30.md` walks
  the commits that touched it.
- The corresponding GitHub issues (#30, #40, #44, #46, #47, #48) are
  the discoverable home for anyone retracing the work — not loose
  files in `docs/plans/legacy/`.
- A `legacy/` directory invites accretion ("oh, this old plan can go
  there too") and a separate review of what "still useful" means.
  Skipping it short-circuits that.

No `docs/plans/legacy/` directory, no README index, no migration.

## Implementation steps

### Step 1 — Delete the six `ISSUE_*.md` files

```bash
git rm ISSUE_30.md ISSUE_40.md ISSUE_44.md ISSUE_46.md ISSUE_47.md ISSUE_48.md
```

The corresponding GitHub issues (#30, #40, #44, #46, #47, #48) are the
canonical home; the content is preserved in git history.

**Disposition summary for the PR body** (so reviewers don't need to
read git history to know what shipped):

| File | Issue | What it described | Status |
|---|---|---|---|
| `ISSUE_30.md` | #30 | Allegro MVP integration (event-journal orders + offer-quantity commands) | Shipped — Allegro adapter package + `docs/allegro-integration-implementation-plan.md` |
| `ISSUE_40.md` | #40 | Wire InventorySyncService to propagate inventory to Allegro | Shipped — see `libs/core/src/inventory/application/services/inventory-sync.service.ts` |
| `ISSUE_44.md` | #44 | Allegro → OL → PrestaShop order routing for buyers without existing customer/address data | Shipped — `libs/core/src/customers/` (projections + email-fallback identity) |
| `ISSUE_46.md` | #46 | Option B sync architecture (orchestration in CORE, thin worker handlers, generic job names) | Shipped — Modularity Thread E + status/outcome separation (#391 / #400) |
| `ISSUE_47.md` | #47 | Allegro offer → internal-variant identifier mapping for order-item resolution | Shipped — see `docs/next-steps-issue-47-offer-sync.md` + `docs/implementation-plan-issue-47-offer-mapping-sync.md` |
| `ISSUE_48.md` | #48 | Persist EAN/GTIN on `ProductVariant` for Allegro offer linking | Shipped — `docs/architecture-overview.md § Products` |

### Step 2 — Delete the empty `.md` (#560)

```bash
git rm .md
```

### Step 3 — Verify repo root is clean

After the deletes, `ls -la` at root should show only:

- Standard OSS docs: `LICENSE`, `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md`,
  `CLAUDE.md`
- Project config: `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `tsconfig*.json`, `nest-cli.json`,
  `jest.config.js`, `Dockerfile`, `docker-compose.yml`,
  `.eslintrc.js`, `.prettierrc`, `.prettierignore`, `.gitignore`,
  `.gitattributes`, `.npmrc`, `.worktreeinclude`
- The `.git/` directory (always)

No `ISSUE_*.md`, no `.md` (empty).

### Step 4 — Quality gate

Per CLAUDE.md, run in order:

1. `pnpm lint` (includes `check:invariants`)
2. `pnpm type-check`
3. `pnpm test`

None of the gate steps will exercise the deleted files. The real
verification is the eyeball test on `ls -la`.

### Step 5 — Self-review

Walk diff against #663 / #559 / #560 acceptance criteria. Confirm:
- All six `ISSUE_*.md` are gone from the working tree.
- Empty `.md` is gone.
- No new files at repo root.
- No in-repo links broken by the deletes (verified with grep in
  research phase — neither `docs/next-steps-issue-47-offer-sync.md`
  nor `docs/implementation-plan-issue-47-offer-mapping-sync.md` link
  to the root-level files).

## Risks

- **External links to `https://github.com/SilkSoftwareHouse/openlinker/blob/main/ISSUE_30.md`** (or similar) may break post-merge. Unknown if such links exist; the repo is private today so any external reference is necessarily internal. Acceptable cost; recovery via `git show <commit>:ISSUE_30.md` against the parent commit.
- **My disposition table in the PR body may misstate one file's shipped status.** The cost of getting one row wrong is low — the deletions are pure metadata, no functional impact — but worth a quick sanity-check by the maintainer.

## PR body checklist

- [ ] All 6 `ISSUE_*.md` deleted via `git rm` (content recoverable from history).
- [ ] Empty `.md` deleted.
- [ ] Repo root `ls -la` shows only standard OSS files + project config.
- [ ] No internal links broken (grep-verified in research phase).
- [ ] Closes #663, #559, #560.

## Out-of-PR follow-ups

- None expected. This is a self-contained cleanup; no admin toggles,
  no downstream work unlocked beyond closing the three issues.
