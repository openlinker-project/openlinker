# OpenLinker Public API Contract

This document defines what counts as the **public API** for OpenLinker's npm-publishable packages, and therefore what semver-compatibility guarantees plugin authors and downstream consumers can rely on.

> **Status today** (2026-05-14): No packages are published to npm yet. All workspace packages are `"private": true`. This document is a forward contract — it describes the policy that will be in force as soon as the first publish happens, and the rule the in-repo public surface is already designed around. See [§ Future enforcement](#future-enforcement) for the tooling timeline.

---

## The rule

> **Public = reachable via a barrel `index.ts` listed in that package's `package.json#exports` field.**

Anything else is **internal**. Specifically:

- Top-level barrels at `<package>/<subpath>/index.ts` are public.
- Files reached via deep paths (`<package>/<subpath>/domain/...`, `.../application/...`, `.../infrastructure/...`) are **private** — they're not in `package.json#exports` and Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime if a consumer tries to import them.
- Test code (`*.spec.ts`, `*.int-spec.ts`, anything under `__tests__/`) is private — never reachable from the `exports` whitelist.
- Type-only exports that aren't re-exported from a barrel are private even if they're declared `export`.

`package.json#exports` is the authoritative list. This document tells you the rule; the `exports` field tells you the values.

---

## Packages and their public surface

### Publishable packages

These packages are designed for npm distribution to plugin authors and downstream consumers. Their public surface is governed by the rule above.

| Package | Role | Authoritative `exports` |
|---|---|---|
| `@openlinker/plugin-sdk` | Framework-neutral plugin contract — what every adapter package implements. | `libs/plugin-sdk/package.json#exports` |
| `@openlinker/core` | Domain layer — ports, types, exceptions, capability contracts. Plugin authors depend on this for the port interfaces they implement. | `libs/core/package.json#exports` |
| `@openlinker/shared` | Cross-cutting utilities — logging, cache, HTTP helpers, shared types. | `libs/shared/package.json#exports` |
| `@openlinker/test-kit` | Integration-test harness — Testcontainers-backed Postgres + Redis fixture for plugin authors' own `*.int-spec.ts` files. | `libs/test-kit/package.json#exports` |
| `@openlinker/integrations-allegro` | Reference adapter — Allegro marketplace plugin. Useful as a starter example; can be consumed as-is. | `libs/integrations/allegro/package.json#exports` |
| `@openlinker/integrations-prestashop` | Reference adapter — PrestaShop platform plugin. | `libs/integrations/prestashop/package.json#exports` |
| `@openlinker/integrations-ai` | Reference adapter — AI completion plugin. | `libs/integrations/ai/package.json#exports` |

The `exports` field on each is finalized. Three categories of sub-barrels are documented in [`docs/engineering-standards.md` § Sub-barrels](./docs/engineering-standards.md#import-aliases) — `<ctx>/services` (Nest wiring), `<ctx>/orm-entities` (host-only ORM-entity access), and `<ctx>/testing` (in-memory fakes for plugin specs).

### Internal packages

These packages exist only to compose the OpenLinker host. They are **not** subject to semver and will never be published.

- `@openlinker/api` — NestJS host application
- `@openlinker/worker` — background-job runner
- `@openlinker/web` — operator-facing SPA

If you find a need to depend on any of these from outside the workspace, that's a signal — open an issue. Don't reach in via a workspace-local path.

---

## What counts as a breaking change

A change to a public surface requires a **major** version bump if it:

- Removes a symbol from a barrel that was previously exported.
- Removes a sub-barrel entry from `package.json#exports`.
- Changes an exported function's signature in a way that requires a caller to adapt:
  - parameter type narrowed (e.g. `string | number` → `string`)
  - new required parameter added
  - return type narrowed (caller might be relying on the broader type)
  - thrown exception type changed in a way that breaks `instanceof` checks downstream are documented to perform
- Changes an exported type or interface in a way that requires a consumer to adapt:
  - required field removed or renamed
  - field type narrowed
  - new required field added
- Changes the **runtime behavior** of an exported function in a way that breaks a documented invariant (e.g. an idempotent operation becomes non-idempotent; an order-preserving function starts reordering).
- Renames a package or moves the entry point.

A change does **not** require a major bump if it:

- Refactors internal code without changing any barrel or `exports` entry.
- Adds a new export to a barrel.
- Adds a new optional parameter with a default value.
- Widens a parameter type (e.g. `string` → `string | number`) — strictly additive at the call site.
- Adds a new field to an interface, marked optional.
- Adds a new sub-barrel to `package.json#exports`.
- Fixes a bug where the documented contract was already what the new behavior is (the old behavior was the bug; downstream that depended on it had a latent bug too).
- Improves error messages, log output, or other observable-but-undocumented surface.

When in doubt, ask the question: **"will an existing well-typed consumer compile and behave identically against the new version without code changes?"** If yes, not breaking. If no, breaking.

---

## Versioning policy

OpenLinker is pre-1.0 and follows the [SemVer §4 convention for `0.x.y`](https://semver.org/#spec-item-4): "Major version zero (0.y.z) is for initial development. Anything MAY change at any time. The public API SHOULD NOT be considered stable."

In practice we treat the version components as pseudo-major/minor/patch:

- **`0.x`** (the minor segment) acts as the pseudo-major. Breaking changes to the public API land at minor-number boundaries: `0.3.0 → 0.4.0` means consumer code may need adaptation.
- **`0.x.y`** (the patch segment) acts as the pseudo-minor. Patch bumps are strictly additive: `0.3.0 → 0.3.1` means a feature add or bug fix that an existing consumer can ignore.
- **`0.x.y-rc.z`** — release candidate, used when staging a `0.x` cut and inviting plugin-author smoke testing.

The first publishable cut will be `0.1.0-rc.1`. Promotion to `0.1.0` (drop the `-rc`) signals "the public surface is the shape 1.0 will take"; promotion to `1.0.0` is when plugins can rely on **full SemVer compatibility** — `^1.x` means no breaking changes within the major — and the SDK boundary is committed.

**Pinning during 0.x**: because breaks can land at any minor boundary, plugin authors should pin SDK packages with `~0.3.0` (allow patch but not minor) — not `^0.3.0` (which under SemVer's strict rules also allows patches in 0.x, but reads ambiguously). The clearest signal is to pin the exact version (`0.3.0`) and bump explicitly after reading the CHANGELOG.

---

## How to make a breaking change today

While Changesets is not yet adopted (see [§ Future enforcement](#future-enforcement)), the workflow is manual but the contract is the same:

1. Open a PR that includes the breaking change.
2. In the PR description, call out the break under a `## Breaking changes` heading. Explain:
   - which symbol or behavior is affected
   - what consumers (plugin authors, in-tree adapter packages) need to do to adapt
   - whether a deprecation step is appropriate (deprecate first, remove next minor)
3. Reviewers verify the call-out matches the diff: anything that would surface in the public-API surface table above is flagged in the PR body.
4. On merge, the change accumulates as part of the pre-1.0 churn. No version bump happens today (all packages still `0.1.0`).

This works because there are no external consumers yet. In-tree adapter packages depend on `@openlinker/core` via `workspace:*`, which always resolves to the local HEAD — there's no pinned-version drift to worry about.

The discipline is for the maintainer: when the OSS launch goes ahead and we adopt Changesets, the breaking-change call-outs accumulated up to that point inform the first CHANGELOG and the choice of starting version.

---

## Future enforcement

**Changesets** (`@changesets/cli`) is the planned tooling. It's the de facto monorepo versioning tool in the modern TS ecosystem (pnpm itself, Next.js, TanStack, shadcn, Astro, Remix, Zod, Vercel SDK), and a natural fit for OpenLinker's pnpm-workspace + multiple-publishable-packages + inter-package-dependencies shape.

**Why not adopted yet**: there is no external consumer to enforce against. All packages are `private: true`; cross-package imports use `workspace:*`; the version string today is cosmetic. Installing Changesets now would mean every PR touching `libs/` runs `pnpm changeset` to accumulate entries that no one reads until the first publish — friction without payoff.

**Trigger conditions for adopting Changesets** (any one is sufficient):

1. The first npm publish step becomes concrete — an open issue with an owner and a target date under the OSS Launch epic (#670).
2. An external consumer starts pinning our packages by version (e.g. an in-tree adapter package gets moved to its own repo, or a third-party plugin lands on npm and consumes `@openlinker/core`).

When the trigger fires, the adopting PR ships:

- `@changesets/cli` + `@changesets/changelog-github` as root devDependencies.
- `.changeset/config.json` configured for the OpenLinker monorepo (independent versioning; `ignore` list covering the three internal packages).
- Root scripts: `changeset`, `changeset:status`, `changeset:version`, `changeset:publish`.
- A bootstrap changeset cutting `0.1.0-rc.1` across the 7 publishable packages.
- A first-time-only retroactive CHANGELOG entry covering pre-Changesets churn, derived from the breaking-change call-outs in merged PRs.

That sequencing keeps the tool adoption aligned with the moment the tool starts paying off.

---

## Related documentation

- [`docs/engineering-standards.md` § Import Aliases](./docs/engineering-standards.md#import-aliases) — the in-repo enforcement story (ESLint rules + the runtime `exports` gate that surfaces deep-import attempts as `ERR_PACKAGE_PATH_NOT_EXPORTED`). The Sub-barrels subsection within Import Aliases documents the three categories of sub-barrels and the rules for adding new ones.
- [`docs/architecture-overview.md`](./docs/architecture-overview.md) — the layered hexagonal architecture that the public-surface rule is grounded in.
- [`docs/plugin-author-guide.md`](./docs/plugin-author-guide.md) — the plugin-author-facing how-to, which assumes the public-API contract this document defines.
