# ADR-029: Versioning and release strategy (four axes)

- **Status**: Accepted
- **Date**: 2026-06-30
- **Authors**: @piotrswierzy

## Context

OpenLinker has no decided release strategy: **0 git tags**, all workspace packages pinned `0.1.0`, `cd.yml` a disabled placeholder, the HTTP API a flat unversioned surface. The prior thinking is split across `#1137` (product tags + CHANGELOG), `#1133` (API versioning), `#596`/`#552`/[`PUBLIC_API.md`](../../../PUBLIC_API.md) (npm package SemVer, deferred), and `#1127` (demo mode as a runtime flag). "Versioning" here is **four independent axes** on different cadences; conflating them forces wrong couplings (e.g. making `@openlinker/core`'s npm version *be* the product version drags SDK majors onto unrelated app changes — Lerna's documented fixed-mode drawback). The repo is dual-natured: a deployable app (api + worker + web) **and** soon-to-publish libraries (plugin-sdk, core, adapters). It already mandates Conventional Commits and trunk-based/GitHub Flow.

## Decision

Adopt a **hybrid, sequenced** model — one product release line now, package npm versioning deferred — keeping the four axes separate (the Grafana precedent):

1. **Product release (Axis 1)** — single lockstep product version: one `vX.Y.Z` tag + GitHub Release + one Keep-a-Changelog `CHANGELOG.md`, via **release-please** (root/single-package mode, Release-PR model, driven by Conventional Commits).
2. **Package npm SemVer (Axis 2)** — unchanged from `PUBLIC_API.md`: **Changesets**, scoped to the 7 publishable packages, adopted at first npm publish; packages stay `private: true` until then. A `fixed` lockstep group for plugin-sdk + core + adapters is the eventual default.
3. **HTTP API version (Axis 3)** — `/v1` URI versioning + a runtime version surface (`GET /v1/health`); slow cadence, `/v2` + deprecation window for breaks. Executed by `#1133`.
4. **Demo deploy (Axis 4)** — demo runs a **known-good release tag** (same image as prod, `OL_DEMO_MODE=true`), never continuously from `main`; `-rc.N` tags preview unreleased work.

release-please (product) and Changesets (npm) coexist with **disjoint scopes** — this does not contradict `PUBLIC_API.md`, which governs Axis 2 only. **Sequencing:** `#1133` → release-please plumbing (+ remove stale `develop` from `ci.yml`) → cut `v0.1.0` → demo CD from tag → (deferred) Changesets + npm publish.

## Alternatives considered

- **Changesets for everything (incl. product line).** Rejected: produces per-package changelogs, not the single product CHANGELOG self-hosters want, and adds per-PR intent-file friction on top of Conventional Commits we already write.
- **Single global version across app + libs (pure lockstep).** Rejected: couples SDK SemVer to app releases — forces library majors for unrelated app changes.
- **Continuous demo deploy from `main`.** Rejected: green CI doesn't prove the app boots/seeds; a tag is the breakage firewall.
- **git-cliff / manual tags.** Rejected: changelog-only — no Release PR, tagging, or CD trigger; rebuilds release-please by hand.
- **git-flow (`develop`/`release` branches).** Rejected: trunk-based is already codified; `release/x.y` is introduced lazily at first backport.

## Consequences

**Pros:**
- One unambiguous "what am I running" answer for self-hosters; unblocks the awesome-selfhosted tagged-release gate.
- Zero per-PR friction (release-please reads existing commits); axes evolve independently.

**Cons / trade-offs:**
- Two release tools long-term (release-please + Changesets) — acceptable while scopes stay disjoint.
- release-please's tag won't trigger a separate workflow under the default `GITHUB_TOKEN`; needs a PAT/App token or in-job deploy.

**Migration path:**
- `#1133` lands `/v1` first; then release-please + `RELEASING.md`; then `v0.1.0`; Changesets at first publish per the `PUBLIC_API.md` trigger.

## Worked scenarios

How the axes behave in practice (the throughline: product version moves when you merge a release PR; demo only ever runs a tag; API and package versions run on their own clocks):

| Scenario | What happens |
|---|---|
| **Feature ships** — `feat:`/`fix:` PRs merge to `main` | release-please accumulates a "release 0.3.0" PR; merging it tags `v0.3.0` → CD deploys the image to prod (flag off) + demo (flag on). |
| **`main` breaks** after a green-CI merge | Demo is unaffected — it runs the last tag, not `main`. Fix forward; demo advances only at the next release. |
| **Urgent patch** while `main` carries unfinished work | Lazily branch `release/0.3` from tag `v0.3.0`, commit the fix there → `v0.3.1`; forward-port to `main`. |
| **Breaking API change** | Add `/v2`, keep `/v1` for a deprecation window. Product version moves on its own (e.g. `v0.6.0`); the integrator on `/v1` isn't broken. |
| **First npm publish** — a 3rd-party plugin pins `@openlinker/core` | Flip the publishable packages `private:false`, adopt Changesets (Axis 2). Core then versions via Changesets (`core@0.2.0`) while the product line keeps moving via release-please — disjoint scopes. |
| **Self-hoster files a bug** | `GET /v1/health` → `{ version: "0.3.0", api: "v1" }`; you know the exact code + contract they ran. |
| **Demo must preview unreleased work** (conference) | Cut `v0.4.0-rc.1` from a verified commit, point demo at it; prod stays on `v0.3.1`. Still a deliberate tag, never raw `main`. |

## References

- Related issues: #1277, #1137, #1133, #596, #552, #1127
- Primary docs: [PUBLIC_API.md](../../../PUBLIC_API.md), [RELEASING.md](../../../RELEASING.md)
- Related ADRs: [ADR-021](./021-third-party-native-inbound-webhook-ingestion.md)
