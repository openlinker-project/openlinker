# Implementation Plan — release-please plumbing, no-tag slice (#1137)

- **Issue**: #1137 (Axis 1 of [ADR-029](../architecture/adrs/029-versioning-and-release-strategy.md))
- **Layer**: DX / Infrastructure (CI + release config; no app code, no migration)
- **Branch**: `1137-release-please-plumbing`

## 1. Goal

Install the **product release-line machinery** (release-please, single-package/root
mode) so it maintains a `CHANGELOG.md` + a `vX.Y.Z` Release PR from Conventional
Commits — **without cutting a tag**. release-please is PR-gated: it opens/updates a
Release PR; the first `v0.1.0` tag only happens when the maintainer **merges** that
PR. Merging this plumbing PR installs the tooling and (per the chosen bootstrap)
does not itself release anything.

**Non-goals (deferred):**
- The actual `v0.1.0` tag → maintainer merges the Release PR when ready. AC
  "first tag cut" stays open.
- `cd.yml` deploy wiring + the PAT/App-token for the tag→CD trigger → ADR-029
  sequences demo/prod CD *after* the tag; needs deploy targets.
- Changesets / npm (Axis 2) → deferred per `PUBLIC_API.md`.
- Hand-writing `CHANGELOG.md` → release-please generates it.

## 2. Files

| File | Action | Purpose |
|---|---|---|
| `release-please-config.json` | **new** | root/single-package config: `release-type: node`, pre-1.0 bump rules, `bootstrap-sha` |
| `.release-please-manifest.json` | **new** | `{ ".": "0.0.0" }` — nothing released yet, so first bump lands on `0.1.0` |
| `.github/workflows/release-please.yml` | **new** | runs release-please on push to `main`; `contents: write` + `pull-requests: write`; default `GITHUB_TOKEN` |
| `.github/workflows/ci.yml` | edit | drop the stale `develop` ref (lines 5, 7, comment 57) — ADR-029 cleanup |
| `RELEASING.md` | edit | update the Status note (tooling landed; tag is one merge away) |

### 2.1 `release-please-config.json` (decided fields)
```jsonc
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "bump-minor-pre-major": true,          // breaking -> 0.x MINOR (not major) while <1.0
  "bump-patch-for-minor-pre-major": false, // feat -> MINOR (not patch) while <1.0
  "bootstrap-sha": "<see §3 open question>",
  "packages": { ".": { "package-name": "openlinker", "changelog-path": "CHANGELOG.md" } }
}
```
This yields the RELEASING.md policy exactly: `feat→minor`, `fix→patch`,
`feat!/BREAKING→0.x minor`. `release-type: node` makes release-please manage the
**root** `package.json` version (the mirror `GET /v1/health` reads) — the other 16
workspace `package.json`s are untouched (Axis 2 territory).

### 2.2 Manifest (REVISED — curated first changelog, no tag now)
`{ ".": "0.1.0" }` — declares `0.1.0` as the **hand-established baseline** (matches
root `package.json`). This stops release-please from auto-generating over our
curated `## [0.1.0]` section; it only ever moves forward to `0.2.0+`. Consequence:
the `v0.1.0` git tag is a **one-time manual step** taken when the maintainer is
ready (documented in `RELEASING.md`); every release after is release-please-automated.

### 2.2b `CHANGELOG.md` (new, hand-curated)
A curated Keep-a-Changelog `## [0.1.0]` section listing every shipped integration
+ the main feature set, sourced accurately from the repo. release-please prepends
future versions above it and never edits it (0.1.0 is baseline per the manifest).

### 2.3 Workflow (shape)
```yaml
name: release-please
on: { push: { branches: [main] } }
permissions: { contents: write, pull-requests: write }
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with: { config-file: release-please-config.json, manifest-file: .release-please-manifest.json }
```
Runs on GitHub-hosted `ubuntu-latest` (never consumes a self-hosted slot). Default
`GITHUB_TOKEN` suffices for opening the Release PR (a PAT is only needed later for
the tag→CD *re-trigger*, which is deferred).

## 3. Open question (needs decision) — the `bootstrap-sha` / changelog window

`bootstrap-sha` bounds how far back the **first** run reads commits, i.e. what the
`v0.1.0` CHANGELOG contains (and whether a Release PR appears immediately):

- **(A) Current `main` tip (`333a39b1`)** — *recommended.* "Start tracking from now."
  Clean: no 1000-commit retroactive changelog. No Release PR opens until the next
  `feat:`/`fix:` merges (release-please only proposes a release when there's
  releasable content) — so it fully respects "don't tag yet," and `v0.1.0`'s notes
  = whatever lands between now and the tag-cut.
- **(B) A recent boundary** (e.g. just before the KSeF/Erli/`/v1`/demo burst) — a
  meatier `v0.1.0` that retroactively credits the current feature set. Larger
  changelog; opens a `v0.1.0` Release PR immediately (pending until merged).
- **(C) Omit / repo root** — full-history changelog. Noisy; not recommended.

**Recommendation: (A).** Simplest, honest ("0.1.0 = first *tracked* release"), zero
retroactive noise, and the window is a one-line change if you later want to widen it
before cutting the tag.

## 4. Validation / risks
- **Quality gate**: `pnpm lint` (+ `check:invariants` — incl. `check-repo-urls`;
  the only external URL is the release-please `$schema`, which is fine). No TS
  changed → `type-check`/`test` unaffected, but run the full gate anyway.
- **Risk — org token policy**: if the org sets the default `GITHUB_TOKEN` to
  read-only or disallows "Actions may create PRs", the workflow can't open the
  Release PR — an admin toggle (Settings → Actions → Workflow permissions) is
  needed. Documented as a caveat; not fixable from the repo.
- **Risk — pnpm/node in the action**: release-please-action doesn't build/install
  the repo; it only parses commits + edits `package.json`/`CHANGELOG`/manifest, so
  the pnpm-10-vs-9 CI nuance is irrelevant here.
- **No migration, no app code, no test churn.**
