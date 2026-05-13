# Implementation Plan — PR template + CODEOWNERS + GOVERNANCE.md (#566, #568)

Two HIGH-severity findings from Modularity Thread B (#548 / #546) that
together formalize what reviewers expect from PRs and who is responsible
for which areas of the repo. Necessary for "we're prepared to accept PRs
from strangers" — required before the org transfer (#641) puts the repo
in front of external contributors.

## Goals

- **#566** — Add `.github/PULL_REQUEST_TEMPLATE.md` with a contributor
  checklist (commands, tests, `Closes #N`, DCO sign-off, integration
  status). Mirrors the workflow already documented in `CONTRIBUTING.md`
  so contributors don't have to discover it from the conversation
  history.
- **#568** — Add `.github/CODEOWNERS` mapping each maintained area to
  the responsible owner(s), and a one-page `GOVERNANCE.md` covering
  review SLA, merge authority, and the explicit rule that integrations
  may be owned by external maintainers.

## Non-goals

- **Bringing in additional maintainers today.** The repo today has a
  single member with merge authority (`piotrswierzy`). CODEOWNERS will
  reflect that reality with a forward-compatible structure (per-path
  routes, ready to be split when teams exist on the new org). This PR
  does NOT name external maintainers or grant new permissions.
- **Enabling CODEOWNERS-required-review branch protection.** That is a
  repo-settings toggle (admin task) and depends on `.github/CODEOWNERS`
  existing first. The file ships here; the toggle is a post-merge admin
  step, called out in the PR body.
- **Drafting per-adapter maintainership.** The audit recommends mapping
  `libs/integrations/allegro/` and `libs/integrations/prestashop/` to
  "specific maintainers" — but today both are maintained by the same
  person. Forward-compatible structure now, real owners after #641 lands
  the new org's team membership.
- **Re-enabling the disabled `cd.yml` workflow.** #568 mentions it as
  evidence ("it's not even clear who can merge"); the fix is to document
  who can merge in GOVERNANCE.md, not to turn the CD pipeline back on.
- **Fixing the URL drift in `.github/ISSUE_TEMPLATE/config.yml`** (still
  points at `piotrswierzy/openlinker`). Tracked separately in #664.

## Layer classification

Pure **DX / Governance / Docs**. No code, no architecture impact, no
migrations, no tests required.

## Open decisions (please flag in review)

1. **Sole owner today.** CODEOWNERS today resolves to a single GitHub
   handle (`@piotrswierzy`). The file lists per-package routes so the
   structure is ready to receive real team membership after the org
   transfer (#641), but every route resolves to the same person until
   then. Confirm the handle is correct — memory has email
   `p.j.swierzy@gmail.com` but the GitHub username is `piotrswierzy`
   (visible on the repo's recent merge commits).
2. **Review SLA.** I'll propose **2 business days** for first reviewer
   acknowledgement and **5 business days** to either approve or request
   changes on a well-scoped PR. Larger PRs may take longer. These are
   conventional OSS defaults — adjustable.
3. **Plugin / adapter ownership policy.** GOVERNANCE.md will explicitly
   state that maintainership of an integration (`libs/integrations/<x>/`)
   may sit with a non-core maintainer — i.e., a plugin author can own
   review of their own adapter once they've proven themselves on the
   project. This is from the #568 acceptance.
4. **Branch protection.** Today `main` likely has no required-review
   rule. Once CODEOWNERS exists, the admin can enable
   "Require a pull request before merging" + "Require review from Code
   Owners" + "Restrict who can push to matching branches" (admin task,
   post-merge follow-up, not done in this PR).

## Implementation steps

### Step 1 — `.github/PULL_REQUEST_TEMPLATE.md` (#566)

**File:** `.github/PULL_REQUEST_TEMPLATE.md` (new)

Sections:
- **Title reminder** at the top — Conventional Commits format
  (`feat:`, `fix:`, `docs:`, …) per
  `docs/engineering-standards.md § Pull Requests`. Links to
  `CONTRIBUTING.md § Commits` for the full type list. Discoverable to
  first-time contributors who haven't read the standards doc yet.
- **Summary** — what changed and why, 1–3 bullets.
- **Closes** — explicit `Closes #N` placeholder.
- **Test plan** — how a reviewer verifies the change.
- **Quality gate checklist** — three required checkboxes matching the
  `pnpm lint`, `pnpm type-check`, `pnpm test` triple from CLAUDE.md,
  plus one optional checkbox: *"If you touched integration-test paths
  (`apps/api/test/integration/**` or any plugin's `infrastructure/
  adapters/`), also ran `pnpm test:integration`"* — gated on Docker
  availability so it doesn't block contributors without Docker on a
  pure-unit PR.
- **Migrations** — checkbox + reminder when an ORM entity changed
  (per `docs/migrations.md`).
- **DCO sign-off** — reminder to commit with `-s` per `CONTRIBUTING.md`.
- **New adapter status** (collapsed `<details>` block) — for PRs that
  introduce a new integration package: declare `alpha` / `beta` /
  `stable` so reviewers know what bar to apply. Cribbed verbatim from
  the #566 audit recommendation.
- **Screenshots** (collapsed) — for UI changes. Per
  `docs/frontend-ui-style-guide.md § Responsive`, FE PRs must attach
  shots at **three widths**: 360×812 (mobile), 768×1024 (tablet),
  1440×900 (desktop). Mobile + tablet are first-class per the
  project's responsive parity matrix.

Format: minimal HTML, mostly raw markdown. Keep collapsible sections
small so the PR body stays scannable. Don't duplicate everything
`CONTRIBUTING.md` already covers — link to it.

### Step 2 — `.github/CODEOWNERS` (#568)

**File:** `.github/CODEOWNERS` (new)

Structure:
```
# Default owner — everything not matched below
*                                  @piotrswierzy

# Core domain (libs/core) — owned by the core team
libs/core/                         @piotrswierzy

# Shared utilities (libs/shared) — owned by the core team
libs/shared/                       @piotrswierzy

# Plugin SDK (libs/plugin-sdk) — public contract surface
libs/plugin-sdk/                   @piotrswierzy

# Hosts (apps/api, apps/worker, apps/web) — owned by the core team
apps/api/                          @piotrswierzy
apps/worker/                       @piotrswierzy
apps/web/                          @piotrswierzy

# In-tree adapters — see GOVERNANCE.md for the policy on plugin maintainers
libs/integrations/allegro/         @piotrswierzy
libs/integrations/prestashop/      @piotrswierzy
libs/integrations/ai/              @piotrswierzy

# Workflows and CI — guarded; changes need core-team review
/.github/                          @piotrswierzy

# Architectural-direction docs — require proposal-issue-first per
# GOVERNANCE.md. Same owner as the catch-all today; routed explicitly
# so future re-pointing to a "core architects" team is one-line.
/docs/architecture-overview.md     @piotrswierzy
/docs/engineering-standards.md     @piotrswierzy
/docs/frontend-architecture.md     @piotrswierzy
```

With a header comment explaining:
- Why every route currently resolves to one handle.
- That per-adapter ownership can move to specific maintainers (see
  GOVERNANCE.md).
- The link between this file and CODEOWNERS-required-review branch
  protection (admin toggle, not turned on yet).

### Step 3 — `GOVERNANCE.md` (#568)

**File:** `GOVERNANCE.md` (new, at repo root)

Sections:
1. **Maintainers** — who, with current handles. One person today;
   structured so new maintainers can be added without rewriting the
   file.
2. **Review SLA** — 2 business days to acknowledge, 5 business days to
   approve or request changes on a well-scoped PR. Larger work may take
   longer, but a holding comment is expected within the SLA window.
3. **Who can merge** — only maintainers. Branch protection (admin
   toggle) will enforce CODEOWNERS-required-review once enabled. This
   PR ships the file; the toggle is a post-merge admin step.
4. **Adapter / plugin maintainership** — in-tree adapters
   (`libs/integrations/<x>/`) may be co-maintained or solely maintained
   by a non-core contributor with demonstrated commitment. The default
   is core-team review; per-adapter CODEOWNERS routes can be re-pointed
   to a non-core handle when a plugin gets its own maintainer.
5. **Decision-making** — `LICENSE` + `CONTRIBUTING.md` cover IP. Major
   architectural changes (touching `docs/architecture-overview.md` or
   `docs/engineering-standards.md`) require a proposal issue first.
   Day-to-day decisions are by single reviewer approval.
6. **Becoming a maintainer** — short note on the path (sustained
   contribution, demonstrated review quality, invite from current
   maintainers). Explicitly note that *the bar is intentionally
   lightweight today (one maintainer) and will tighten as the project
   grows past 2–3 maintainers* — otherwise the section reads as
   boilerplate.
7. **Removing a maintainer** — short note (inactivity > 6 months OR
   conduct violation per CoC). #659 will add CODE_OF_CONDUCT.md
   separately; until then, cross-link the GitHub default standards.

Length target: one screen — this is a "what's the policy" doc, not a
constitutional document.

### Step 4 — Link GOVERNANCE.md from CONTRIBUTING.md

**File:** `CONTRIBUTING.md` (edit)

Add a one-line pointer in the existing "Pull Request Process" or a new
"Governance" section: "Maintainers, review SLA, and the rule that
adapters may have non-core maintainers are documented in
[GOVERNANCE.md](./GOVERNANCE.md)."

### Step 5 — Quality gate + manual draft-PR verification

In order (per CLAUDE.md — no skipping just because docs-only):

1. `pnpm format` (write mode) on the new files to pre-normalize.
2. `pnpm lint` (includes `check:invariants`)
3. `pnpm type-check`
4. `pnpm test`

None of the gate steps actually exercise the new PR template, CODEOWNERS,
or GOVERNANCE.md files (they're not TS, not loaded at runtime). So after
the gate passes:

5. Push the branch and open a **draft PR** against `main` — confirms the
   PR template renders correctly in the GitHub UI before real
   contributors see it. <2 min, catches formatting issues no
   command-line tool can.

### Step 6 — Self-review

Walk diff against #566 / #568 acceptance criteria:
- PR template includes the five contributor-checklist items from #566.
- CODEOWNERS covers `libs/integrations/{allegro,prestashop}` and
  `libs/core/` + `apps/api/` per #568's explicit recommendation.
- GOVERNANCE.md covers review SLA, who can merge, and adapter-owned-
  by-external-maintainers rule per #568.

## Risks

- **Single-owner CODEOWNERS today.** With every route resolving to
  `@piotrswierzy`, the `Require review from Code Owners` branch
  protection would require `@piotrswierzy` to review their own PRs —
  GitHub does not let an author satisfy a CODEOWNERS requirement for a
  file they themselves authored. Until a second maintainer exists OR
  the org transfer (#641) creates team-based ownership, the admin
  should **not** enable CODEOWNERS-required-review. PR body will call
  this out explicitly.
- **PR template friction.** A long PR template makes small PRs feel
  heavyweight. Keep the visible body short, push optional sections into
  collapsible `<details>` blocks so a quick docs PR isn't drowning in
  unchecked boxes.
- **Drift between PR template and CONTRIBUTING.md.** The template
  duplicates a thin slice of the checklist documented in
  `CONTRIBUTING.md § Pull Request Process`. Pin the template to *link*
  CONTRIBUTING.md rather than restate the rules — keeps the source of
  truth in one place.

## PR body checklist

- [ ] `.github/PULL_REQUEST_TEMPLATE.md` covers the #566 contributor
      checklist items (lint/type-check/test triple, tests, migrations,
      `Closes #N`, integration status for new adapters).
- [ ] `.github/CODEOWNERS` covers the path mapping #568 recommends.
- [ ] `GOVERNANCE.md` covers review SLA, who can merge, plugin-author
      maintainership policy.
- [ ] CONTRIBUTING.md links to GOVERNANCE.md.
- [ ] Closes #566, #568.

## Out-of-PR follow-ups to record

- **Admin: enable branch protection** on `main` — but be specific about
  *which* combination is safe today vs. which requires a second
  maintainer. Safe to enable today:
  - `Require a pull request before merging` ON
  - `Require approvals: 0` (PR-based merge required, but author may
    still self-approve via "Merge pull request")
  - `Require review from Code Owners` **OFF** — turning this on with a
    single owner deadlocks self-merge (GitHub refuses to let the PR
    author satisfy a CODEOWNERS requirement for a file they authored)
  - `Require status checks to pass before merging` ON (once CI is
    aligned to public runners per #662)

  Requires a second maintainer (or org-team membership post-#641) before
  enabling:
  - `Require approvals: 1`
  - `Require review from Code Owners` ON
- **Re-point integration-package CODEOWNERS routes** when an adapter
  gets its own non-core maintainer (anticipated post-#641).
- **Add CODE_OF_CONDUCT.md** (#659) so GOVERNANCE.md's "removing a
  maintainer for conduct violations" line can link to a concrete CoC.
- **Fix issue-template `config.yml` URL drift** (still
  `piotrswierzy/openlinker`) — tracked in #664.
