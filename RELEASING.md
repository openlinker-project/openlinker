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

- **Product** follows SemVer with the pre-1.0 `0.x` convention: while `0.x`, the
  **minor** segment is the pseudo-major (breaking) and **patch** is the
  pseudo-minor (additive). Promotion to `1.0.0` is when the public surface and
  plugin SDK are committed (see [PUBLIC_API.md](./PUBLIC_API.md) § Versioning policy).
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

> **CD trigger caveat:** a tag pushed by release-please's default `GITHUB_TOKEN`
> will not trigger a *separate* workflow. Either run the deploy steps in the same
> job (gated on `steps.release.outputs.release_created`), or authenticate
> release-please with a PAT / GitHub App token so the tag push re-triggers
> `on: push: tags`. (`cd.yml` deploy wiring is deferred until deploy targets exist.)

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
git checkout main && git pull
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
# then create a GitHub Release for v0.1.0, pasting the 0.1.0 CHANGELOG section.
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
