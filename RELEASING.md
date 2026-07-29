# Releasing OpenLinker

How OpenLinker is versioned, tagged, and released. The *why* lives in
[ADR-029](./docs/architecture/adrs/029-versioning-and-release-strategy.md); the
npm-package contract lives in [PUBLIC_API.md](./PUBLIC_API.md). This document is
the operational how-to.

> **Status:** `/v1` API versioning (#1133) and the **release-please tooling**
> (#1137) have shipped. `0.1.0` is the hand-curated baseline (see
> [CHANGELOG.md](./CHANGELOG.md)); release-please manages `0.2.0` onward.
> **There is no `v0.1.0` git tag yet** — cutting it is a deliberate one-time step
> (see [Cutting the first tag](#cutting-the-first-tag-v010-baseline) below).

## The four version axes

OpenLinker has **four independent version numbers**, each on its own cadence.
Don't conflate them.

| Axis | Answers | Example | Moves when | Tool |
|---|---|---|---|---|
| **Product** | "What OpenLinker am I running?" | `v0.3.1` | you cut a release | release-please |
| **Package (npm)** | "What `@openlinker/core` does my plugin pin?" | `@openlinker/core@0.4.0` | a published package changes | Changesets *(deferred)* |
| **HTTP API** | "What endpoint contract do I call?" | `/v1/orders` | a breaking API change ships | NestJS `enableVersioning` |
| **Demo** | "What's on the public demo?" | running `v0.3.1` | you cut a release | CD from tag |

## Branching

Trunk-based / GitHub Flow (see [CONTRIBUTING.md](./CONTRIBUTING.md)):

- Branch off `main` per issue (`{issue}-{kebab-description}`), PR back, squash-merge.
- `main` is always the release candidate.
- `release/x.y` branches are created **lazily** — only the first time a fix must
  be backported to an older release while `main` has moved on. Not pre-emptively.

## Versioning policy

- **Product** follows SemVer with the pre-1.0 `0.x` convention: while `0.x`,
  **minor** carries new features *and* breaking changes, and **patch** carries
  fixes (this matches `bump-minor-pre-major: true` +
  `bump-patch-for-minor-pre-major: false` in `release-please-config.json`).
  Promotion to `1.0.0` is when the public surface and plugin SDK are committed
  (see [PUBLIC_API.md](./PUBLIC_API.md) § Versioning policy). Note the **npm
  package axis has its own, different pre-1.0 convention** (patch = strictly
  additive, per PUBLIC_API.md) — the two axes version independently (see the
  table above), so the policies deliberately don't match.
- Conventional Commits drive the bump: `feat:` → minor, `fix:` → patch,
  `feat!:` / `BREAKING CHANGE:` → major (pre-1.0: a `0.x` minor).
- Tags are `vX.Y.Z` (and `vX.Y.Z-rc.N` for release candidates).

## Cutting a product release

release-please watches `main` and keeps an open **"chore: release X.Y.Z"** PR
that accumulates the pending version bump + `CHANGELOG.md` from Conventional
Commits.

1. Merge feature/fix PRs to `main` as normal — nothing releases yet.
2. When ready, **review and merge the release-please Release PR**.
3. On merge, release-please writes `CHANGELOG.md`, bumps the version, and creates
   the **`vX.Y.Z` tag + GitHub Release**.
4. `cd.yml` fires on the tag → builds the image → deploys to **prod**
   (`OL_DEMO_MODE` off) and **demo** (`OL_DEMO_MODE=true` + seed).

> **CD trigger:** a tag pushed by the default `GITHUB_TOKEN` will not trigger a
> *separate* workflow, which is why `cd.yml` did not fire automatically on the first
> releases (those deploys had to be rescued by re-pushing the tag by hand).
> release-please therefore authenticates with a PAT so its tag push re-triggers
> `on: push: tags` (#1891). See § Release token below for the secret, and the
> consequences worth knowing:
>
> - The Release PR is now opened by the PAT owner's account, so **CI runs on it**
>   (a bot-opened PR produced no checks at all, so release PRs were merging
>   unverified and needed a ruleset bypass). This is the biggest win of the change.
>   The flip side: the PAT owner cannot approve their own Release PR, so someone
>   else has to review it.
> - With **no** PAT configured the workflow degrades instead of breaking: the
>   `token:` input falls back to `github.token`, so the Release PR and tag are still
>   created and the run logs a `::warning::` - only the CD re-trigger is lost.
>   An **expired or revoked** PAT is different: the secret is still non-empty, so
>   there is nothing to fall back to and release-please fails with an auth error.
>   Rotate deliberately.
> - `cd.yml` also carries `workflow_dispatch` for manually re-running a deploy. Two
>   guards keep that off arbitrary refs: the `demo` environment's deployment-branch
>   policy (allowed refs: `main` and `v*` tags) rejects the run at the environment
>   gate, and `cd.yml`'s own `Guard deploy ref` step re-checks it in-workflow in case
>   that repo setting is ever relaxed. Note both restrict the *ref*, not the *actor*:
>   the environment has no required reviewers, so anyone with write access can
>   re-deploy `main` or a `v*` tag by hand. That is a deliberate choice for a demo
>   target - add environment required-reviewers if it should be gated.

### Release token

`release-please.yml` reads, in order: `secrets.RELEASE_PLEASE_TOKEN` →
`secrets.GH_TOKEN` → `github.token`.

- **`RELEASE_PLEASE_TOKEN` is the preferred name** - it states its blast radius,
  whereas `GH_TOKEN` is the conventional env name for the `gh` CLI and invites reuse
  in unrelated workflows. `GH_TOKEN` stays supported so the existing repo secret
  keeps working; new setups (and the next rotation) should use the specific name.
- Use a **fine-grained** PAT scoped to this repository with **Contents: write** +
  **Pull requests: write**. A *classic* PAT cannot be narrowed like that (`repo` is
  all-or-nothing and reaches every repo the owner can touch), so a classic token
  would be a standing org-wide credential exercised on every push to `main`.
- Better still: mint a short-lived token per run with
  [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
  from a GitHub App installed on this repo, which removes the long-lived credential
  entirely. The rotation cost is the same either way, so prefer this at the next
  rotation rather than after the exposure becomes a concern.
- Whoever provisions the token **owns its rotation** - record the owner and expiry
  wherever the team tracks secrets, because a lapsed PAT fails the release line.

## Cutting the first tag (`v0.1.0` baseline)

`0.1.0` is a **hand-established baseline**, not a release-please-generated one:
its `CHANGELOG.md` entry is hand-curated (a readable snapshot of the integrations
and features that shipped before automated releases), and
`.release-please-manifest.json` records `"." : "0.1.0"` so release-please treats it
as already released and never rewrites that section.

Because release-please won't cut a version it considers already released, the
`v0.1.0` **git tag is created by hand, once, whenever you're ready** — there's no
rush, and nothing depends on doing it now:

```bash
# Tag the exact commit recorded as `bootstrap-sha` in release-please-config.json —
# NOT the current main tip. Once a v0.1.0 tag + GitHub Release exist, release-please
# parses commits from that tag's commit (bootstrap-sha is only the no-release-found
# fallback), so tagging a later commit would silently drop everything between
# bootstrap-sha and the tag from the generated 0.2.0 changelog.
git fetch origin main
git tag -a v0.1.0 <bootstrap-sha from release-please-config.json> -m "v0.1.0"
git push origin v0.1.0
# then create a GitHub Release for v0.1.0, pasting the 0.1.0 CHANGELOG section.
# If a 0.2.0 Release PR is already open when you do this, re-check its commit
# range afterward — creating the release moves release-please's parse boundary.
```

From then on it's fully automated: the next `feat:`/`fix:` merged after the
`bootstrap-sha` in `release-please-config.json` makes release-please open a
`0.2.0` (or `0.1.1`) Release PR, which — when you merge it — writes the generated
`CHANGELOG` section **above** the curated `0.1.0`, bumps the version, and pushes
the tag + GitHub Release. You never hand-tag again.

## CHANGELOG

- `CHANGELOG.md` (repo root) is the single product changelog, Keep-a-Changelog
  style. The `0.1.0` section is the **hand-curated baseline** (see above); every
  section from `0.2.0` on is **generated** by release-please from Conventional
  Commits — don't hand-edit those.
- When the **first** automated Release PR (`0.2.0`) opens, sanity-check that
  release-please prepended its section cleanly *above* the curated `0.1.0` (the
  baseline is hand-formatted, so eyeball the first insertion) before merging.
- Per-package changelogs do not exist yet — they arrive with npm publishing
  (Changesets), as separate files for a different audience (plugin authors).
- **openlinker.io/changelog** renders this repo's GitHub Releases at build time.
  On a cut release (`steps.release.outputs.release_created`), `release-please.yml`
  fires a `repository_dispatch` (`event_type: product-release`) to
  `openlinker-project/openlinker-website` so its `deploy.yml` redeploys prod with
  the new notes. This needs a repo Actions secret **`WEBSITE_DISPATCH_TOKEN`** — a
  fine-grained PAT scoped to `openlinker-website` with **Contents: read & write**
  (the `POST /dispatches` endpoint rides the contents permission). The step
  skips with a `::notice::` if the secret is absent, so the workflow is safe to
  run before the secret is provisioned.

## Demo deployments

- The demo runs a **known-good release tag**, the same image as production, with
  `OL_DEMO_MODE=true` + the sandbox seed. It advances only when you cut a release.
- **Never deploy the demo from `main`** — a green CI does not prove the app boots,
  migrates, or seeds cleanly.
- To preview unreleased work for an event, cut a **pre-release** tag
  (`vX.Y.Z-rc.N`) from a commit you've verified and point the demo at it; prod
  stays on the last stable tag.
- Demo go-live depends on #1124 (read-only redaction) + #1127 (demo-session endpoint).

## HTTP API versioning

- Endpoints are served under `/v1` (`VersioningType.URI`, `defaultVersion: '1'`).
- A breaking API change ships as `/v2` with `/v1` kept alive for a documented
  deprecation window — it does **not** force a product major.
- `GET /v1/health` reports the running product version + API version from a single
  source, so the tag, the Release, the CHANGELOG, and the live process agree.

## Package npm publishing (deferred)

Not active yet. All 7 publishable packages are `private: true`. When the first
publish becomes concrete (the trigger in [PUBLIC_API.md](./PUBLIC_API.md) §
Future enforcement), adopt **Changesets** scoped to those packages — a `fixed`
lockstep group for `plugin-sdk` + `core` + reference adapters — running beside
release-please with a disjoint scope. The product `vX.Y.Z` line is unaffected.
