# Implementation Plan — #719 Extend cross-context import policy to integrations + apps

## 1. Understand the task

**Goal.** Extend the cross-context coupling lint-time invariant (#713/#721's `scripts/check-cross-context-imports.mjs`) so the same allowed/denied symbol-shape contract is enforced not only on `libs/core/src/<ctx>/**` but on every consumer of `@openlinker/core/<ctx>` barrels — `libs/integrations/<plugin>/**` and `apps/{api,worker}/**`. (`libs/plugin-sdk/src/**` follows the same contract but currently has 0 violations and is out of this PR's scope — see § 2c.)

Today the script protects the core-to-core seam. Plugins and host apps consume the same barrels through the same contract, but the script's walker doesn't visit them — so a plugin that value-imports `*RepositoryPort` or an app that imports a forbidden symbol slips past the gate. This issue closes that gap.

**Layer.** DX / CI / docs. No runtime code changes.

**Explicit non-goals.**
- Rewiring any of the violations that surface (separate follow-up issue, mirroring #718's per-rewire shape).
- Cross-plugin imports (`@openlinker/integrations-foo` ↔ `@openlinker/integrations-bar`) — different boundary, governed by the plugin SDK contract (#593).
- Reverse direction (core importing plugins / apps) — structurally impossible under the dependency rules.
- Tightening `OrmEntity` exposure inside `libs/core` itself (the sub-barrel split already governs that — see `docs/engineering-standards.md § Import Aliases`).
- Changing the allow/deny patterns themselves — the contract is the contract; only the scope changes.

## 2. Research findings

### 2a. Current script shape (`scripts/check-cross-context-imports.mjs`)

- Walks `libs/core/src/` only via `walk(coreSrc)`.
- `importerContext(repoRelPath)` returns the third path segment after `libs/core/src/` (e.g. `inventory`), or `null` to skip the file.
- Main loop skips a file when `importerContext()` returns `null`, and skips an individual import when its target context matches the importer context.
- Matcher fires only on bare `@openlinker/core/<ctx>` (no subpath); sub-barrels are governed by separate ESLint rules.
- Deny patterns: `*RepositoryPort`, `*OrmEntity`, `*Adapter`, `*Dto` + default/namespace imports. Allow patterns: `I*Service`, `is*`, `*Port`, `*Module`, `*Exception`/`*Error`, `UPPER_SNAKE_CASE`, plus default-allow for unrecognized names (domain entities / value objects / types).
- Allow-list is a `Map<repo-relative-path, Set<symbol>>` — per-(file, symbol) gate.

### 2b. Audit: what surfaces in plugins + apps today

Quick line-based grep `from '@openlinker/core/[a-z-]+'` across `libs/integrations/`, `apps/api/`, `apps/worker/` (lower bound — single-line imports only; the actual script uses `s`-flag regex and catches multi-line blocks too):

- **0 `*OrmEntity`** bare-barrel imports — every consumer that touches ORM entities goes through the `<ctx>/orm-entities` sub-barrel, exactly as the policy expects.
- **0 `*Adapter`** bare-barrel imports — core barrels don't export adapter classes.
- **0 `*Dto`** bare-barrel imports.
- **≥25 `*RepositoryPort`** bare-barrel imports across ~50 files (some files import multiple). All are deny-pattern hits that will fail under the broadened script.

Unique deny-pattern symbols visible in the line-based grep:

| Symbol | From | Approx callers |
|---|---|---|
| `UserRepositoryPort` | `users` | auth services, bootstrap, password-reset (+ specs) |
| `RefreshTokenRepositoryPort` | `users` | auth refresh-token service (+ spec) |
| `SyncJobRepositoryPort` | `sync` | controllers, worker handlers (+ specs) |
| `ConnectionCursorRepositoryPort` | `sync` | cursors controller, allegro controller (+ specs) |
| `WebhookDeliveryRepositoryPort` | `webhooks` (or `sync`) | webhook service, query service, module (+ spec) |
| `IntegrationCredentialRepositoryPort` | `integrations` | allegro-oauth service, allegro token refresh (+ specs) |
| `CustomerProjectionRepositoryPort` | `customers` | prestashop plugin + factory + adapters + provisioner (+ specs), plus apps/api customers controller spec |
| `ProductVariantRepositoryPort` | `products` | listings controller (+ spec) |

Real `(file, symbol)` pair count is determined by running the broadened script in step 2 of the implementation plan. The pre-implementation grep is a lower bound — multi-line `import { ... }` blocks would be missed here but caught by the script.

**Escalation note**: if the broadened-script audit surfaces a deny-pattern hit that ISN'T `*RepositoryPort` (e.g. an unanticipated `*Dto`, `*OrmEntity`, or `*Adapter`), do NOT silently allow-list it. Those typically indicate a real architecture gap that's worth surfacing in the PR description so reviewers can decide if it's allow-list material or a separate fix-before-merge.

### 2c. Walker scope

Walker descends into exactly the roots called out in the issue body:

- `libs/core/src/**` (unchanged from #721)
- `libs/integrations/**` — every plugin. Plugin test files live inside `libs/integrations/<plugin>/src/__tests__/**` (verified in audit), so descending from the package root captures both runtime and test code under one root.
- `apps/api/**` — covers both `src/**` and `test/integration/**`. The issue body's main acceptance line says `apps/{api,worker}/src/**`, but the same body explicitly names "apps/api integration tests" as a likely violation source. Resolving the ambiguity in favour of "walk the whole app tree" because the integration-test fixtures are exactly where ORM entities and repository ports tend to leak.
- `apps/worker/**` — same reasoning as `apps/api`.

Not walked:
- `apps/web/**` — doesn't import `@openlinker/core/*` (uses `@openlinker/web-*` aliases); the matcher would never fire.
- `libs/shared/**` and `libs/test-kit/**` — 0 imports from `@openlinker/core/*` per audit.
- `libs/plugin-sdk/src/**` — imports from `@openlinker/core/*` but has 0 deny-pattern hits today. Out of the issue body's stated scope; if a violation ever surfaces, a one-line walker-roots addition closes the gap.

If a future contributor introduces core imports into any of the not-walked trees, extending the walker list is a one-line change.

### 2d. Same-context skip

In the core-only scope, the script skipped `@openlinker/core/<ctx>` imports when the importer file was also under `libs/core/src/<ctx>/`. Plugins and apps have no "context" they could match against — every `@openlinker/core/<ctx>` import is by definition cross-context for them. So the same-context skip applies **only when the importer is core**.

`importerContext()` therefore needs to return a tagged scope, not a bare context string:

```js
function importerScope(repoRelPath) {
  // libs/core/src/<ctx>/...
  if (...) return { kind: 'core', ctx: parts[3] };
  // libs/integrations/<plugin>/...
  if (...) return { kind: 'integration', plugin: parts[2] };
  // libs/plugin-sdk/src/...
  if (...) return { kind: 'sdk' };
  // apps/{api,worker}/...
  if (...) return { kind: 'app', app: parts[1] };
  return null;
}
```

Main-loop skip: `if (myScope.kind === 'core' && tgtCtx === myScope.ctx) continue;`

## 3. Design

### 3a. Single seam in the script

All changes live in `scripts/check-cross-context-imports.mjs`. No new files. The script's overall shape stays the same — only the walker roots, the scope function, and the allow-list grow.

### 3b. Allow-list grouping

Pre-existing violations are added to the existing `ALLOW_LIST` map at the bottom of the existing core entries. Group them by `(consumer scope, repository port, target rewire interface)` mirroring #718's structure. Example header:

```js
  // ─── #719: plugins + apps allow-list (rewire tracked in follow-up issue) ───

  // apps/api auth → users.UserRepositoryPort — rewire via IUsersService
  [
    'apps/api/src/auth/auth.service.ts',
    new Set(['UserRepositoryPort']),
  ],
  ...
```

The follow-up rewire issue lists only production-code violations (`*.ts` excluding `*.spec.ts`) so reviewers can see the operational debt at a glance. Spec mocks ride along with their production rewires.

### 3c. Walker roots

```js
const WALKER_ROOTS = [
  ['libs', 'core', 'src'],
  ['libs', 'integrations'],
  ['apps', 'api'],
  ['apps', 'worker'],
];
```

Each root resolved to an absolute path joined with `repoRoot`. `walk()` is called per root, results concatenated. Identical `SKIP_DIRS` apply (`node_modules`, `dist`, `coverage`, `.git`, `.turbo`). The success-log summary format (`✓ N cross-context import(s) across M file(s). All conform.`) stays identical to today — only the numbers change.

### 3d. Docs update

`docs/architecture-overview.md § Cross-context dependencies in core § Scope` currently reads:

> Today the rule applies to `libs/core/src/<ctx>/**` only — that matches the boundary the policy was audited against. Extending the same shape to `libs/integrations/<plugin>/src/**` and `apps/{api,worker}/src/**` is tracked in **#719**…

After this PR:

> The rule applies to every consumer of `@openlinker/core/<ctx>` barrels under the walked scopes: `libs/core/src/<ctx>/**`, `libs/integrations/<plugin>/**`, and `apps/{api,worker}/**`. Pre-existing repository-port couplings surfaced when the scope expanded are allow-listed in the script's `ALLOW_LIST` and tracked in **#722** (follow-up rewire issue, analogous to #718). `libs/plugin-sdk/src/**` follows the same contract but currently has 0 violations and is out of scope; a one-line walker addition closes the gap if a violation ever surfaces.

The Mermaid dependency map stays focused on core-to-core (it's the bounded-context picture; plugins consuming core isn't a new shape worth visualising).

### 3e. Follow-up rewire issue

Filed before commit so the script header can reference it. Body mirrors #718's structure:

- Production-code violations table (path → imported symbol → `I*Service` rewire target).
- Splittable per source-context (users / sync / webhooks / integrations / customers / products).
- Acceptance criteria: all production violations rewired, spec mocks updated, allow-list entries dropped.
- `## Related` section links back to **#719** and to **#718** (the original rewire issue from the core-scope policy) so the two-way trail is preserved — mirroring how #718 references #713.

## 4. Step-by-step plan

1. **`scripts/check-cross-context-imports.mjs`** — rewrite `walk()` driver, `importerContext()` → `importerScope()`, gate same-context skip on `scope.kind === 'core'`, update header docstring with the broadened scope + reference to the new rewire follow-up.
2. **Run the broadened script** to capture every surfaced `(file, symbol)` pair across plugins + apps. Add each to the `ALLOW_LIST` map. Run again to confirm 0 violations.
3. **Update `docs/architecture-overview.md § Scope`** — drop the "today only `libs/core/src`" framing, list the broader reach, link the new rewire issue.
4. **File the follow-up rewire issue** via `mcp__github__issue_write`. Capture the issue number.
5. **Backfill the issue number** into the script header + the docs Scope paragraph.
6. **Run the full quality gate** — `pnpm lint`, `pnpm type-check`, `pnpm test`.
7. **Commit + push + open PR** with `Closes #719`.

## 5. Validation

- **Architecture compliance**: docs + script changes only. No new ports, services, or modules. Matches the precedent set by `check-repo-urls.mjs`, `check-cross-context-imports.mjs` itself, etc.
- **Naming**: script name unchanged; no new files.
- **Testing**: invariant scripts in this repo don't ship their own unit tests (precedent: `check-repo-urls.mjs`, `check-migration-timestamps.mjs`). The script's pass on a tree with pre-existing violations (correctly allow-listed) and its failure on injected new ones (verified ad-hoc during implementation) is the test.
- **Security**: none of the changes touch auth, secrets, or input handling.
- **Quality gate**: must pass with the allow-list in place.

## Open questions

- **Should `apps/api/test/integration/**` be in scope?** I'm including all of `apps/api/**` (not just `src/`) because the issue body explicitly calls out integration tests as a likely source of violations. Walker descends through test directories the same way; SKIP_DIRS handles fixture noise. If integration tests legitimately need a deny-pattern import (e.g. test fixtures need to instantiate an ORM entity), that's an allow-list entry — same shape as production violations.
- **Plugin-SDK scope**: I'm including `libs/plugin-sdk/src/**` even though the SDK is small and currently has 0 deny-pattern imports. It's a consumer of core barrels, the contract applies, and adding it costs nothing. Removing later is one line if it turns out to be unhelpful.

## Risks

- **False positives in the audit batch.** I'm allow-listing exactly what the broadened script flags on the first run. If a flagged file is actually safe by construction (e.g. the symbol is just unfortunately named), the allow-list grows. Mitigation: spot-check the first ~5 entries; if all 5 are genuine deny-pattern hits, the rest of the batch likely is too.
- **Allow-list growth before the rewire happens.** The script header gains ~35 more entries. Mitigation: the follow-up rewire issue is filed in the same PR, so there's an obvious owner for cleanup. The allow-list comment groups entries by rewire target so each follow-up PR drops a clean contiguous block.
