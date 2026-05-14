# Implementation Plan — #705 Docs Cleanup

**Issue:** [#705 docs: retire shipped implementation plans, consolidate overlapping guides](https://github.com/SilkSoftwareHouse/openlinker/issues/705)
**Branch:** `705-docs-cleanup`
**Type:** DX / documentation
**Layer:** none (docs-only)

---

## 1. Goal

Retire stale documentation under `docs/` and consolidate overlapping guides so the remaining set is the canonical reference. No code changes; no architectural changes.

**Non-goals**
- Touching `docs/plans/` files individually — they stay as a historical archive (only a `README.md` is added).
- Rewriting `testing-guide.md`, `webhooks/overview.md`, or `architecture-overview.md` beyond what is needed to absorb the merged content.
- Reorganising `docs/` directory layout.

---

## 2. Research notes

Verified via `grep -r ... --include="*.md"` excluding `.claude/worktrees/`:

- `implementation-plan-generator-guide.md` is **load-bearing** — `@docs/`-included by `.claude/commands/{plan,work,ship}.md`. Do not touch.
- `prestashop-module-testing-guide.md` is referenced from `libs/integrations/prestashop/README.md` and the PrestaShop module README. Keep.
- The 5 deletion candidates have **0 live inbound refs** (only mentions are inside the meta plan `docs/plans/implementation-plan-663-559-560-top-level-cruft-cleanup.md`, which is itself an archived plan).
- `integration-test-strategy.md` (535 lines) contains a *lot* of historical content — phased rollout, "MVP", harness implementation pattern. The harness pattern is already implemented; the phased rollout is shipped. Only a short "strategy summary" needs to land in `testing-guide.md`.
- `integration-test-organization.md` (211 lines) is mostly arguing *for* separation; `testing-guide.md § Why Separate Commands?` already covers it. A pointer back is enough.
- `webhook-testing-guide.md` (384 lines) — usable as-is, just relocated.
- `ai-assistant-guide.md` (61 lines) is a thin landing page that links to `ai-prompt.md` (206 lines). One merged file is clearer.
- `claude-code-workflow-guide.md` (596 lines) — only inbound ref is the CLAUDE.md index table. Content predates the current `/plan`, `/work`, `/ship` skill set and substantially overlaps with the skill prompts. **Decision:** drop the file and remove the row from CLAUDE.md. The skill prompts (which Claude actually loads at runtime) are the source of truth.

---

## 3. Solution design

Six discrete operations, each independent. All are within `docs/` (plus a few index-row updates in CLAUDE.md and README/issue templates).

| # | Op | Result |
|---|---|---|
| 1 | Delete 6 shipped/stale top-level files (5 plans + 1 one-shot migration runbook) | -6 files |
| 2 | Merge integration-test docs into `testing-guide.md` + delete sources | -2 files |
| 3 | Merge `webhook-testing-guide.md` into `docs/webhooks/overview.md` + delete source | -1 file |
| 4 | Merge `ai-assistant-guide.md` + `ai-prompt.md` → `docs/ai-coding-assistant.md` | -1 file net |
| 5 | Drop `claude-code-workflow-guide.md` | -1 file |
| 6 | Delete `docs/ui-audit/` entirely (~80 files: audit/library-analysis/baseline/concepts/progress) | -1 directory |
| 7 | Delete `docs/reviews/modularity-and-plugin-readiness-2026-05-09.md` | -1 file |
| 8 | Fix `docs/dev-environment.md` admin-folder section (factual error) | edit |
| 9 | Add `docs/plans/README.md` | +1 file |

Plus the cross-link sweep (CLAUDE.md, doc footers, issue templates, the prestashop runbook).

Both `docs/ui-audit/` and `docs/reviews/modularity-and-plugin-readiness-2026-05-09.md` are Category-D (historical / past-tense). Neither is loaded into Claude's context; both risk Claude greping for "current state" and finding past-tense critique. FE-002 is the live response to the audit; the OSS-launch roadmap mostly shipped (#657-660, #566/568, #562/563, #576/577, #588) and open items are tracked as separate issues. Git log is the new source of truth for both.

---

## 4. Step-by-step implementation

### Step 1 — Delete shipped/stale plans + one-shot migration runbook

```
git rm docs/allegro-integration-implementation-plan.md
git rm docs/allegro-integration-remaining-tasks.md
git rm docs/implementation-plan-issue-47-offer-mapping-sync.md
git rm docs/next-steps-issue-47-offer-sync.md
git rm docs/implementation-plan-issue-48-variant-barcodes.md
git rm docs/operations/prestashop-module-rename-migration.md
```

The PS module rename migration (#519 follow-up to #514) is a one-time operator runbook for shops that installed the bind-mount module *before* the `openlinkerwebhooks → openlinker` rename. The rename shipped in commit 29c0687 well before the OSS launch (LICENSE / CONTRIBUTING / SECURITY landed in #657-#660 last week). Any external user grabbing the repo today gets `openlinker` fresh — they have no old install to migrate from. The runbook has zero audience.

**Acceptance:** `grep -rn "allegro-integration-implementation-plan\|allegro-integration-remaining-tasks\|implementation-plan-issue-47\|next-steps-issue-47\|implementation-plan-issue-48\|prestashop-module-rename-migration" --include='*.md'` returns no live (non-`docs/plans/`) hits.

### Step 2 — Consolidate integration-test docs

- Add a short section to `docs/testing-guide.md` titled **"Integration test strategy (history)"** — 3-5 bullets distilling the rationale that's still useful from `integration-test-strategy.md`: harness responsibilities (already linked from § Best Practices), where tests live (`apps/api/test/integration/`, selective slices in `libs/*`), CI separation. Reference the live harness file path.
- The "Why separate commands?" section already exists in `testing-guide.md:464` — make sure it still reads correctly without the trailing link to `integration-test-organization.md`.
- Remove the two "Related Documentation" lines pointing to the deleted files (`testing-guide.md:754-755`).
- Remove the inline pointer at `testing-guide.md:478` ("See [Integration Test Organization]…") — the rationale is in this very doc.
- `git rm docs/integration-test-strategy.md docs/integration-test-organization.md`
- Update `docs/integrations/allegro/runbook.md:451` — replace the link with a pointer to `testing-guide.md`.

**Acceptance:** `grep -rn "integration-test-strategy\|integration-test-organization" --include='*.md'` returns zero hits.

### Step 3 — Move webhook testing into webhooks/overview

- Append a new section **"Testing webhooks"** to `docs/webhooks/overview.md` containing the content of `docs/webhook-testing-guide.md` (manual flow + integration test recipe + common issues + debugging tips). Trim the redundant "Prerequisites" and "Next Steps" sections at the boundaries.
- Update the existing "Related Documentation" entry in `webhooks/overview.md:251` (which currently points back at `webhook-testing-guide.md`) — drop it.
- `git rm docs/webhook-testing-guide.md`

**Acceptance:** `grep -rn "webhook-testing-guide" --include='*.md'` returns zero hits.

### Step 4 — Merge AI guide + prompt

- Create `docs/ai-coding-assistant.md` combining:
  - Short intro + quick-start orientation (from `ai-assistant-guide.md`, sections 1-2)
  - Full prompt content (from `ai-prompt.md`, sections 1-8) inlined verbatim under a single H2 "Operating instructions"
  - The "Reference docs" pointers at the bottom (from `ai-assistant-guide.md` "Quick Start")
- `git rm docs/ai-assistant-guide.md docs/ai-prompt.md`
- Update inbound refs to the new path:
  - `docs/dev-environment.md:399`
  - `docs/engineering-standards.md:1547`
  - `docs/architecture-overview.md:1534`
  - `.github/ISSUE_TEMPLATE/scaffold-project.md:331`
  - `.github/ISSUE_TEMPLATE/question.md:22`

**Acceptance:** `grep -rn "ai-assistant-guide\|ai-prompt\.md" --include='*.md' --include='*.yml' --include='*.yaml'` returns zero hits.

### Step 5 — Drop `claude-code-workflow-guide.md`

- `git rm docs/claude-code-workflow-guide.md`
- Remove the row "Claude Code workflow, worktrees, context mgmt | `docs/claude-code-workflow-guide.md`" from `CLAUDE.md:24`.

**Acceptance:** `grep -rn "claude-code-workflow-guide" --include='*.md'` returns zero hits (outside worktrees).

### Step 6 — Add `docs/plans/README.md`

Short README explaining the archive convention: one plan per implementation, kept after merge as a searchable design record, new plans created via `/plan`. ~30 lines.

### Step 7 — Final cross-link sweep + factual fixes

- Update `CLAUDE.md` Reference Documentation table to remove the dropped row and rename the AI guide row.
- Update `docs/architecture-overview.md`, `docs/engineering-standards.md`, `docs/dev-environment.md` "Related Documentation" sections.
- Update root `README.md` and `.github/ISSUE_TEMPLATE/*` files that link to renamed files.
- **Fix `docs/dev-environment.md` admin folder claims** (lines ~50, 52, 198, 204-206). The doc currently says the admin folder is auto-generated to a random hash (e.g. `admin9379z0kucdhp9b8xfor`); reality (post-#525) is that `docker/prestashop/post-install/10-rename-admin.sh` renames it to stable `/admin-dev/`. Replace the random-hash text with `/admin-dev/` per `docs/getting-started.md:30,46`.

**Acceptance:** all of the following return zero non-worktree hits:
```
grep -rn "claude-code-workflow-guide\|ai-assistant-guide\|ai-prompt\.md\|integration-test-strategy\|integration-test-organization\|webhook-testing-guide\|allegro-integration-implementation-plan\|allegro-integration-remaining-tasks\|implementation-plan-issue-4[78]\|next-steps-issue-47" --include='*.md'
```

### Step 8 — Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

No code changed, so all three must pass without flakes. Any failure here would be unrelated to this PR and needs investigation, not workaround.

---

## 5. Validation

- **Architecture compliance:** N/A — docs-only.
- **Naming:** new file `ai-coding-assistant.md` follows the kebab-case docs convention.
- **Testing strategy:** quality gate only; no behaviour change to test.
- **Security:** N/A.

## 6. Questions & assumptions

- **Assumption:** `implementation-plan-generator-guide.md` stays — confirmed via grep that `.claude/commands/{plan,work,ship}.md` `@docs/`-include it.
- **Assumption:** the prestashop module README link to `prestashop-module-testing-guide.md` from `libs/integrations/prestashop/README.md` keeps working — that file is unchanged.
- **Open question:** the issue lists `claude-code-workflow-guide.md` as "REFRESH — stale but worth keeping" with the user's choice between prune/drop. Default in this plan: **drop**, because the skill prompts (`.claude/commands/*.md`) are the actual runtime contract and the guide has drifted from them. If the user wants it kept as reference, we'd instead trim it to a short pointer page. **Flagging for confirmation in the Phase 3 pause.**

---

## 7. Estimated impact

- **Files deleted:** 11 (5 stale plans + 1 done migration runbook + integration-test pair + webhook-testing + ai pair + claude-code-workflow)
- **Files added:** 2 (ai-coding-assistant.md, plans/README.md)
- **Files edited (factual fix):** 1 (dev-environment.md admin folder section)
- **Net lines removed from docs/:** ~3,000
- **Code change:** zero

## 8. Per-file verification log (rest of `docs/`)

For completeness — every other doc was spot-checked against current code; verdicts are **KEEP, no changes**:

- `frontend-architecture.md`, `frontend-ui-style-guide.md`, `migrations.md`, `code-review-guide.md` (used by 5 skills), `testing-guide.md`, `connections-and-adapter-resolution.md`, `getting-started.md`, `plugin-author-guide.md`, `prestashop-module-testing-guide.md`
- `docs/integrations/allegro/{manual-testing-guide,runbook,setup-guide}.md`
- `docs/webhooks/{overview,prestashop}.md` (overview will gain the merged webhook-testing section in Step 3 above)
- `docs/ui-audit/{audit,library-analysis}.md`, `docs/ui-audit/baseline/README.md`, and the binary artefacts in `baseline/`, `concepts/`, `progress/` — the visual record of FE-001 → FE-002 work.
- `docs/reviews/modularity-and-plugin-readiness-2026-05-09.md` — most BLOCKERs shipped in #657-660, #566/568, #562/563, #576/577, #588 (LICENSE / SECURITY / CONTRIBUTING / CODEOWNERS / GOVERNANCE / plugin-author-guide / peer-dependencies / open Capability+EntityType unions). The remaining open findings (BE-7/BE-9 platformType literals, D1 registry) are tracked as separate issues. Kept as a historical record of the pre-OSS-launch state; no status edits — adding "status: closed" annotations next to 58 findings would invite drift the moment the next finding closes. Reader can verify any finding against git log themselves.
