# Implementation Plan — #659 CODE_OF_CONDUCT.md + SUPPORT.md

Direct follow-up to #672 (LICENSE + SECURITY.md + CONTRIBUTING.md). Closes the
last two GitHub Community Standards rows that aren't green yet
(CODE_OF_CONDUCT, SUPPORT).

| Layer | Scope | Risk |
|---|---|---|
| DX / repo hygiene | Two new top-level docs + small README edit | Low — pure docs |

## 1. Scope

### In scope
- `/CODE_OF_CONDUCT.md` — Contributor Covenant 2.1, verbatim text, with the `[INSERT CONTACT METHOD]` placeholder resolved.
- `/SUPPORT.md` — short routing doc covering the five question types from the issue.
- `README.md` — new `## Community` section above `## Security`, linking both files.

### Out of scope (deferred / tracked elsewhere)
- The 6 `ISSUE_*.md` files at repo root → #663's cleanup scope.
- Enabling **GitHub Discussions** → repo-settings admin action, deferred to post-org-transfer (#641), called out in `SUPPORT.md` honestly rather than pretending Discussions are live today.
- A real `conduct@openlinker.io` alias → depends on #642 (`openlinker.io` domain). Use the same interim pattern SECURITY.md uses: GitHub Security Advisories as the private contact channel + a `TODO` anchor referencing #642.
- A commercial / enterprise support page → mentioned in `SUPPORT.md` as "TBD" tied to the future marketing site; not in this PR's scope.

## 2. Contact-channel decision for CODE_OF_CONDUCT

Contributor Covenant 2.1 says: *"Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the community leaders responsible for enforcement at [INSERT CONTACT METHOD]."*

Options considered:
- **A.** `conduct@openlinker.io` — doesn't exist today (#642 gates the domain).
- **B.** Personal maintainer email — leaks personal contact details into a public repo, not scalable when maintainers turn over.
- **C.** **GitHub Security Advisories** — already enabled per SECURITY.md, private to maintainers, audited thread. Same channel SECURITY.md uses; consistent with established repo precedent.

**Pick C** for the interim. Add a `TODO (depends on #642)` anchor — same pattern SECURITY.md ships — pointing at a future `conduct@openlinker.io` once the domain lands. The semantic mismatch (security tab for conduct reports) is mitigated by an explicit note in `CODE_OF_CONDUCT.md` that the form is the interim conduct-reporting channel and that the maintainers monitor it for both.

## 3. Files

### 3.1 `CODE_OF_CONDUCT.md` (new, repo root)

- Verbatim Contributor Covenant 2.1 text (https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
- Replace `[INSERT CONTACT METHOD]` with a short pointer at the **GitHub Security Advisories** form (same URL SECURITY.md uses) and an explicit "this is also our interim conduct-reporting channel" sentence so reporters aren't confused by the "Security" labelling.
- Add a `TODO (depends on #642)` anchor for the future `conduct@openlinker.io` alias.
- Preserve the Contributor Covenant version + license attribution at the bottom — required by the Covenant's terms.

### 3.2 `SUPPORT.md` (new, repo root)

Short, prose-light routing doc (target ~30-50 lines). Five sections:

| Question type | Channel | Notes |
|---|---|---|
| **Bug reports** | GitHub Issues (`bug` label) | Link to issue template once #567 lands; for now point at the New Issue page. |
| **Security reports** | `SECURITY.md` | Single sentence pointer — don't duplicate the SECURITY.md content. |
| **Feature requests** | GitHub Discussions / GitHub Issues (`enhancement` label) | Note that Discussions will be enabled post-org-transfer (#641); use the `enhancement` label on Issues in the interim. |
| **General questions** | GitHub Discussions | Same caveat — Discussions enabled post-org-transfer. Interim: open an Issue with the `question` label. |
| **Commercial / enterprise support** | TBD — placeholder | Tied to the future marketing site; explicit `TODO` anchor referencing #642. |

Use the **Issues interim fallback** pattern honestly rather than implying Discussions is live today.

### 3.3 `README.md` edit

- Add a `## Community` section between `## Contributing` and `## Security` containing three short bullets:
  - `[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)` — community standards we follow.
  - `[SUPPORT.md](./SUPPORT.md)` — where to ask for help.
  - `[SECURITY.md](./SECURITY.md)` — responsible disclosure for vulnerabilities. *(Note: this duplicates the existing `## Security` section's pointer — keep the standalone `## Security` section as-is for GitHub Community Standards detection, but add a redundant pointer under `## Community` so a visitor scanning that section sees the full community-doc set in one place.)*

Alternative: instead of a separate `## Community` section, fold the two new pointers into the existing `## Contributing` section. The issue text explicitly says "under a 'Community' section", so go with the dedicated section.

## 4. Step-by-step

1. Drop `CODE_OF_CONDUCT.md` at repo root (Contributor Covenant 2.1 verbatim + contact replacement + version/license footer).
2. Drop `SUPPORT.md` at repo root.
3. Insert `## Community` section in `README.md` between line 187 (end of `## Contributing`) and line 188 (start of `## Security`).
4. Run quality gate: `pnpm lint && pnpm format:check` (no code changes; type-check + test untouched).
5. Self-review against `code-review-guide.md` (doc-scope items only: links resolve, no placeholders, consistent with SECURITY.md precedent).
6. Single conventional-commit (`docs(community): add CODE_OF_CONDUCT.md and SUPPORT.md (#659)`).

## 5. PR description notes

- **Acceptance criteria from #659** — all four checked; the contact-placeholder item is partially resolved (interim channel set + TODO anchor for the eventual email alias).
- **Pre-merge / pre-public-flip admin action** — enabling **GitHub Discussions** in repo settings (Settings → Features → Discussions → Enable). The doc is correct today; the admin action is the precondition for the Discussions links to resolve to something. Same shape as the Private Vulnerability Reporting note in #672.
- **Downstream gates** — `conduct@openlinker.io` (#642), GitHub Discussions enablement (admin action), commercial-support marketing page (out of scope).
- **Verbatim sourcing** — note that the Contributor Covenant text is licensed CC BY 4.0; preserved attribution at the bottom of the file per the Covenant's own terms.

## 6. Validation checklist

- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 verbatim (diff against canonical text → only the `[INSERT CONTACT METHOD]` line should differ).
- [ ] `SUPPORT.md` — routes all five question types, honest about Discussions not being live yet.
- [ ] Both linked from `README.md` under `## Community`.
- [ ] No new dependencies, no code changes, no migrations.
- [ ] `pnpm lint` passes (catches Prettier formatting drift on the new `.md` files).
- [ ] No `[INSERT ...]` placeholders remain anywhere in the two new files.
