# Implementation Plan — #596: Package versioning policy + npm-prep metadata

**Branch:** `596-package-versioning-semver`
**Base:** `main` (3ca648a)
**Parent epic:** #552 — Modularity Thread F (SDK boundary).

---

## 1 — Understand

### Goal

Document the public-API contract that future semver decisions hinge on, and stamp npm-prep metadata (`publishConfig`, consistent `engines`) on the 7 publishable packages. **Don't adopt enforcement tooling yet** — defer Changesets to the PR that flips `private: true → false` and ships the first npm publish.

### Layer

Docs + package.json metadata only. No runtime code, no tooling install, no migration.

### What the issue body asks for

1. Adopt Changesets (`@changesets/cli`) for semver tooling.
2. Declare a public-surface contract in `PUBLIC_API.md`.
3. Tag first publishable cut as `0.1.0-rc.1`.
4. Add a `prepublishOnly` guard that fails if test specs import deep paths.

### Asks already covered by other work

- **`prepublishOnly` deep-path guard**: covered. `libs/core/package.json#exports` only lists top-level barrels + three explicit sub-barrels (`listings/services`, `<ctx>/orm-entities`, `<ctx>/testing`). Deep imports fail at Node runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and ESLint rules in `libs/integrations/**` and `apps/{api,worker}/**` reject them at lint time. The issue body's F4 reference is stale.

### Asks deferred to the first-publish PR

- **Changesets adoption**: YAGNI today. All packages are `private: true` with no npm consumer; `workspace:*` resolves locally and the version string is cosmetic. Installing Changesets now means every PR touching `libs/` runs `pnpm changeset` (~30s friction each) to accumulate entries no one reads until the first publish. The right time to adopt is when an external consumer starts pinning our packages — i.e., when the OSS launch's publish step is concrete (an open issue with an owner). Until then, manual PR-review discipline backed by PUBLIC_API.md is sufficient. Trigger conditions for revisiting documented in PUBLIC_API.md.
- **Tag as `0.1.0-rc.1`**: deferred. Without Changesets, manually bumping versions creates two follow-on problems: (a) we'd hand-roll an initial CHANGELOG.md that won't match the auto-generated format the publish PR will use; (b) we'd telegraph "release candidate" via the version string with no actual release pipeline behind it. Better to keep `0.1.0` until the publish PR bumps + tools together.

### Non-goals

- Flipping `private: true → false`
- CI release workflow (`.github/workflows/release.yml`)
- Bumping `engines.node` from 18 to 20 (orthogonal; do it explicitly elsewhere)
- Consolidating docs (PUBLIC_API.md and engineering-standards.md § Import Aliases serve different audiences and don't fully overlap)

---

## 2 — Research

### Current state

11 workspace packages. All `0.1.0`. All `private: true`. Inconsistent `engines` (3 declare `node ≥ 18`; 7 don't declare). No `publishConfig` anywhere.

### Two classes

**Publishable (7)** — plugin-author-facing, intended for eventual npm:
- `@openlinker/core`, `@openlinker/shared`, `@openlinker/plugin-sdk`, `@openlinker/test-kit`
- `@openlinker/integrations-allegro`, `@openlinker/integrations-prestashop`, `@openlinker/integrations-ai`

**Internal-only (3)** — host apps, never published: `@openlinker/api`, `@openlinker/worker`, `@openlinker/web`.

Plus root `openlinker` — meta-package, always private.

### Existing enforcement

`libs/core/package.json#exports` is the runtime gate for deep-path imports — it WAS the prepublishOnly guard the issue asks for, just expressed declaratively via the `exports` field instead of a separate script. ESLint rules add lint-time coverage.

`docs/engineering-standards.md` § Import Aliases documents the rule for in-repo contributors. PUBLIC_API.md will document the same rule for plugin authors reading from outside the repo — different audiences, different framing, no duplication of substance.

---

## 3 — Design

### Files this PR creates

- `PUBLIC_API.md` (repo root) — top-level contract doc

### Files this PR modifies

- 7 publishable-package `package.json` files — add `publishConfig.access = "public"`; ensure consistent `engines.node ≥ 18.0.0` (some packages declare it, some don't — normalize to all-or-nothing).

### Files NOT touched

- Root `package.json` (no Changesets install)
- 3 internal-only app packages
- `pnpm-lock.yaml`
- Any source code, tests, or CI workflows

### `PUBLIC_API.md` outline

```
1. The rule (public = barrel re-export listed in package.json#exports)
2. Packages and their public surface (table referencing each package's exports)
3. What counts as a breaking change (major bump)
4. What doesn't (minor/patch)
5. Versioning policy (0.x.y shape pre-1.0; SDK-but-pre-stable signaling)
6. How to make a breaking change today (manual; PR review)
7. Future enforcement (Changesets adopted at first-publish PR; trigger conditions)
8. Internal packages list (host apps; not subject to semver)
```

The doc is self-contained. Cross-references engineering-standards.md § Import Aliases for the in-repo enforcement story (ESLint + Node runtime gate) but doesn't duplicate the rules.

### package.json normalization

For each of the 7 publishable packages:

```jsonc
{
  "name": "@openlinker/...",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=18.0.0" },   // add if missing
  "publishConfig": { "access": "public" },  // add
  // ... rest unchanged
}
```

`private: true` and `version: "0.1.0"` stay. The publishConfig is harmless metadata until `private` flips.

---

## 4 — Implementation steps

### Step 1 — Write `PUBLIC_API.md`

Repo root, ~150 lines. Sections per §3 outline. Anchor the deferred-Changesets decision and the trigger conditions for revisiting.

### Step 2 — Normalize publishable package.json files

7 files:
- `libs/core/package.json` — add `publishConfig`
- `libs/shared/package.json` — add `publishConfig`
- `libs/plugin-sdk/package.json` — add `engines` + `publishConfig`
- `libs/test-kit/package.json` — add `engines` + `publishConfig`
- `libs/integrations/ai/package.json` — add `engines` + `publishConfig`
- `libs/integrations/allegro/package.json` — add `engines` + `publishConfig`
- `libs/integrations/prestashop/package.json` — add `engines` + `publishConfig`

### Step 3 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

No tooling installs, no source edits — the gate should pass without surprise. The package.json edits are metadata-only.

### Step 4 — Commit + PR

Conventional commit: `docs(api): document public-API contract + add publishConfig metadata (#596)`. PR body explicitly notes Changesets is deferred to the first-publish PR and links #670 (OSS Launch epic) as the natural follow-up surface.

---

## 5 — Validation

### Architecture compliance

Docs + metadata layer only. No CORE/Integration boundary crossings, no domain logic, no runtime impact.

### Naming compliance

- `PUBLIC_API.md` — convention from npm ecosystem (cf. `LICENSE.md`, `CONTRIBUTING.md`, `SECURITY.md`).

### Testing strategy

The quality gate is the test. The package.json metadata changes shouldn't break anything; if they do, lint/type-check will surface it.

### Security

`publishConfig.access: "public"` is metadata only, gated behind `private: true`. No new attack surface.

### Risks

- **Risk:** A future maintainer reads PUBLIC_API.md and assumes Changesets is already adopted (because the doc references it as the future tool). **Mitigation:** doc explicitly says "deferred" with trigger conditions; the absence of `.changeset/` directory + `@changesets/*` in `package.json` is the in-tree confirmation.
- **Risk:** publishConfig metadata gets shipped but `private: true` somehow gets flipped accidentally. **Mitigation:** publishing scoped packages requires `npm login` + explicit `npm publish` — the metadata alone doesn't trigger anything.

---

## 6 — Open questions

- **Should PUBLIC_API.md live at repo root or under `docs/`?** Convention says root (alongside README, LICENSE, CONTRIBUTING). That's where npm tooling looks if it ever auto-includes the doc in package archives. Going with root.

---

## File list

| File | Action | Reason |
|---|---|---|
| `PUBLIC_API.md` | new | Public-API contract |
| `libs/core/package.json` | edit | Add publishConfig |
| `libs/shared/package.json` | edit | Add publishConfig |
| `libs/plugin-sdk/package.json` | edit | Add engines + publishConfig |
| `libs/test-kit/package.json` | edit | Add engines + publishConfig |
| `libs/integrations/ai/package.json` | edit | Add engines + publishConfig |
| `libs/integrations/allegro/package.json` | edit | Add engines + publishConfig |
| `libs/integrations/prestashop/package.json` | edit | Add engines + publishConfig |
| `docs/plans/implementation-plan-596-package-versioning-semver.md` | new | This plan |
