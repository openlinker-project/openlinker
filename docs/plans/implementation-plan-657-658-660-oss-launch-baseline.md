# Implementation Plan — OSS Launch Baseline Docs (#657, #658, #660)

Bundled docs/governance pass to clear the three BLOCKING items from epic #670
before the OpenLinker repo is flipped public.

## Goals

- **#657** — Add Apache 2.0 `LICENSE` file at repo root; update README license
  section; set `"license": "Apache-2.0"` on every `package.json` in the
  workspace.
- **#658** — Add `SECURITY.md` with a responsible-disclosure path, covering
  the five required sections (supported versions, reporting channel, SLA,
  scope, safe harbor). Link from README + CONTRIBUTING.
- **#660** — Fix `CONTRIBUTING.md`: replace placeholder clone URL, swap
  `docker-compose up` for `pnpm dev:stack:up`, fix the migration command,
  align rest of the file with `package.json` scripts and CLAUDE.md.

## Non-goals

- **Domain / org transfer.** Issues #641 (org transfer) and #642 (domain
  purchase) are explicit dependencies for the *final* URLs and email aliases.
  This PR uses the interim values (`openlinker-project/openlinker` URL, a
  placeholder reporting channel) and tags them so they can be batch-updated
  when #641/#642 land. The issues themselves call out this interim approach.
- **Enabling GitHub Private Vulnerability Reporting** in repo settings. That
  is a settings-page toggle, not a code change — it gets done by a repo admin
  during the launch flip. SECURITY.md will document the intended channel.
- **DCO enforcement workflow.** #657 explicitly defers enforcement until
  after the org transfer; this PR records the DCO decision in the PR
  description only.
- **Other items from #670** (#656, #659, #662, #663, #664, #665) — separate
  PRs.

## Layer classification

Pure **DX / Governance / Docs**. No code, no architecture impact, no
migrations, no tests required.

## Open decisions (please flag in review)

1. **Reporting channel placeholder in SECURITY.md.** Pre-#642 we don't own
   `security@openlinker.io`. Two reasonable interim options:
   - **(A — recommended)** Direct researchers to GitHub Security Advisories
     ("Report a vulnerability" tab on the repo) once Private Vulnerability
     Reporting is enabled. Zero email dependency, works the day we flip
     public, GitHub handles the audit trail.
   - **(B)** Direct researchers to a personal/maintainer email
     (`p.j.swierzy@gmail.com`) with a TODO to switch once `security@openlinker.io`
     exists.
   I'm going with **(A)** in the draft and adding a TODO to add the
   `security@openlinker.io` alias as a secondary channel once #642 lands.
2. **DCO vs CLA.** #657 recommends DCO; not enforced this PR. I'll note the
   decision in the PR body and add a one-line stub to CONTRIBUTING.md
   covering `Signed-off-by:` as the expected mechanism so contributors aren't
   surprised when enforcement turns on.
3. **README "Prerequisites".** Says `pnpm 8+`, but the lockfile shows `pnpm
   10.11.1` and CLAUDE.md targets pnpm 10. Same drift in CONTRIBUTING.md.
   I'll bump both to `pnpm 10+` (the floor that actually works) — this is a
   trivial fix and otherwise the CONTRIBUTING.md "audit the rest of the file"
   acceptance criterion isn't met.
4. **`develop` branch reference in CONTRIBUTING.md line 74.** The repo has
   no `develop` branch — the trunk is `main` (confirmed in CLAUDE.md). I'll
   fix this as part of the "audit the rest of the file" sweep.

## Implementation steps

### Step 1 — LICENSE (#657)

**File:** `/LICENSE` (new)

Add the verbatim Apache License 2.0 text from
`https://www.apache.org/licenses/LICENSE-2.0.txt`. No `[yyyy]` /
`[name of copyright owner]` placeholders in the appendix boilerplate
section — those are templates, not part of the license. Per Apache
guidance, ship the text-only license file (the `APPENDIX` block at the
bottom of the canonical file describes *how* to apply it; teams typically
omit it from the LICENSE file itself, but keeping it is also fine. I'll
keep it verbatim for "no surprises" review).

**Acceptance:** `diff <(curl -s https://www.apache.org/licenses/LICENSE-2.0.txt) LICENSE` → empty.

### Step 2 — README license section (#657)

**File:** `README.md` (edit line 182-184)

Replace:
```
## License

[Add your license here]
```
with:
```
## License

OpenLinker is released under the Apache License 2.0. See the
[LICENSE](./LICENSE) file for details.
```

### Step 3 — `license` field on every workspace package.json (#657)

Set `"license": "Apache-2.0"` on:
- `package.json` (root)
- `apps/api/package.json`
- `apps/web/package.json`
- `apps/worker/package.json`
- `libs/core/package.json`
- `libs/integrations/ai/package.json`
- `libs/integrations/allegro/package.json`
- `libs/integrations/prestashop/package.json`
- `libs/plugin-sdk/package.json`
- `libs/shared/package.json`

`license` is a standard metadata field for every `package.json`, publishable
or not, per npm convention. Setting it everywhere removes ambiguity and
matches the rest of the ecosystem regardless of whether the workspace is an
end app (`apps/*`) or a future-publishable library (`libs/*`).

### Step 4 — SECURITY.md (#658)

**File:** `/SECURITY.md` (new)

Sections (must cover all five per acceptance criteria):

1. **Supported versions** — `main` only until the first tagged release. Add
   a table with one row.
2. **Reporting a vulnerability** — point to GitHub Security Advisories
   ("Report a vulnerability" tab); add a TODO line for the
   `security@openlinker.io` secondary channel once #642 lands.
3. **Response SLA** — 72h initial acknowledgement; 14 days for critical,
   30 days for non-critical. Patch + coordinated disclosure timing.
4. **Scope** — in-scope: every package maintained in this repo
   (`apps/{api,worker,web}` + every `libs/**` package — including the
   plugin contract surfaces `@openlinker/core/*`, `@openlinker/shared/*`,
   `@openlinker/plugin-sdk`, and the bundled adapters). Out-of-scope:
   third-party plugins not maintained in this repo; vulnerabilities in
   external services (Allegro, PrestaShop, etc.) — please report those to
   the upstream vendors directly.
5. **Safe harbor** — research-in-good-faith language; explicit "we will not
   pursue legal action."

### Step 5 — Reference SECURITY.md from README (#658)

**File:** `README.md` (insert near License section, line ~178)

Add a `## Security` section above `## Contributing` with a one-line
pointer to `SECURITY.md`.

### Step 6 — Reference SECURITY.md from CONTRIBUTING.md (#658)

**File:** `CONTRIBUTING.md` (under "Pull Request Process" or new section)

Add a one-line "Do not file security vulnerabilities as public issues — see
[SECURITY.md](./SECURITY.md)" pointer.

### Step 7 — Fix CONTRIBUTING.md (#660)

**File:** `CONTRIBUTING.md`

Concrete edits:
- **Line 8** prerequisites: `pnpm 8+` → `pnpm 10+`.
- **Line 16**: clone URL placeholder → `https://github.com/openlinker-project/openlinker.git`.
- **Line 33**: `docker-compose up -d postgres redis` → `pnpm dev:stack:up`.
- **Line 36-39**: replace the conditional "when available" migration block
  with a real, working command: `pnpm --filter @openlinker/api migration:run`
  (per CLAUDE.md). Drop the "when available" caveat — migrations exist.
- **Line 41-44**: replace `pnpm start:dev` with the three commands actually
  documented in CLAUDE.md: `pnpm start:dev:api`, `pnpm start:dev:worker`,
  `pnpm start:dev:web`. Note which port each binds.
- **Line 74**: "Create a feature branch from `develop`" → "Create a feature
  branch from `main`" (no `develop` branch exists; CLAUDE.md uses `main`).
- **Trailing blank lines (100-107)**: trim.
- **New "Setup checklist" block** at the top — the exact zero-to-green
  sequence:
  ```bash
  pnpm install
  cp apps/api/.env.example apps/api/.env
  pnpm dev:stack:up
  pnpm --filter @openlinker/api migration:run
  pnpm test
  ```
- **Add Security pointer** (per Step 6).
- **Record DCO decision** in a new "Commits" sub-section: state explicitly
  that the project has chosen DCO over CLA, that `Signed-off-by:` is the
  attestation mechanism, and that automated enforcement is deferred until
  after the org transfer (#641 / #657). The decision belongs in the file
  itself — not only in the PR body — so future contributors discover it
  without diving into PR history.

### Step 7b — Fix README.md drift

**File:** `README.md`

Same drift exists in README.md (audit-quality concern surfaced in tech
review). Without this, the PR ships a direct contradiction between two
adjacent files:

- **Line 19** prerequisites: `pnpm 8+` → `pnpm 10+`.
- **Lines 51–53** "Start the development server": replace `pnpm start:dev`
  with the three real commands (`pnpm start:dev:api` / `:worker` / `:web`)
  noting which port each binds.
- **Lines 64–67** Testing block: drop `pnpm start:prod` reference if it
  appears; verify the testing commands match `package.json` scripts.

(License section + Security pointer for README.md are already covered by
Steps 2 and 5.)

### Step 8 — Quality gate

In order:

1. `pnpm format` (write mode) on the new/edited files only — pre-normalize
   so the check pass surfaces real issues, not formatter noise.
2. `pnpm format:check`
3. `pnpm lint` (runs `check:invariants` — migration timestamps, design
   tokens, etc.)
4. `pnpm type-check`
5. `pnpm test`

Per CLAUDE.md's "run before every commit" rule — no skipping just because
this is docs-only.

### Step 9 — Self-review pass

Walk the file diff against the acceptance criteria in each of #657, #658,
#660. Confirm:
- LICENSE present and byte-identical to canonical Apache 2.0 text.
- README license section updated; new Security section linking to SECURITY.md.
- All ten `package.json` files have `"license": "Apache-2.0"`.
- SECURITY.md covers all five required sections.
- CONTRIBUTING.md: every command runs against the actual `package.json`
  scripts and matches CLAUDE.md.
- No placeholder URLs, no `docker-compose up -d postgres redis`, no
  `pnpm migration:run` left in the diff.

## Risks

- **Trademark gate (#657 references #642).** The LICENSE itself is the
  same regardless of trademark status — the gate is on going public, not on
  committing the file. The PR can merge into a private repo today; the
  public flip is a separate decision tied to #642 clearing.
- **README/CONTRIBUTING drift from `dev-environment.md`.** I'll scan
  `dev-environment.md` for setup commands and surface any further drift in
  the PR description (out of scope to fix here, but worth flagging).
- **SECURITY.md SLA values** are recommendations, not negotiated with
  maintainers. The PR will explicitly call this out and ask for sign-off on
  the numbers before merge (per #658 acceptance: "SLA targets discussed and
  agreed with maintainers before publishing").

## PR body checklist (drafted now to keep this honest)

- [ ] LICENSE is verbatim Apache 2.0 text
- [ ] README license section updated; Security section added
- [ ] All 10 `package.json` files set `license: Apache-2.0`
- [ ] SECURITY.md covers supported-versions, reporting channel, SLA, scope, safe harbor
- [ ] CONTRIBUTING.md commands all match `package.json` scripts
- [ ] No `develop` branch references remain
- [ ] DCO decision recorded (planned mechanism: `Signed-off-by:` once #641 transfers)
- [ ] Third-party code requiring Apache § 4 attribution: none identified
- [ ] Closes #657, #658, #660

## Out-of-PR follow-ups to record

- Enable GitHub Private Vulnerability Reporting in repo settings (admin
  toggle, post-merge).
- Once #642 lands `openlinker.io`: set up `security@openlinker.io` forward
  and **replace** (not just augment) the SECURITY.md reporting section
  — GH Security Advisories stays as the primary channel, email becomes the
  secondary. A TODO anchored to #642 lives in SECURITY.md itself so the
  edit is discoverable.
- Once #641 lands the org transfer: update repo URL in CONTRIBUTING.md /
  README.md and any other references (tracked in #664).
- Add DCO check workflow once on the new org (out of scope per #657).
