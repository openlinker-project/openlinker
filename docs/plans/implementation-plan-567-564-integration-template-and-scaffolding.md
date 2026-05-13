# Implementation Plan — #567 + #564: Integration Issue Template & Adapter Scaffolding

**Branch**: `567-564-integration-template-and-scaffolding`
**Status**: Draft — pending user sign-off

Closes Modularity Thread B (#548) by shipping the two onboarding affordances deferred from #562 / #563:

- **#567** — `.github/ISSUE_TEMPLATE/new_integration.md`
- **#564** — `scripts/create-adapter.mjs` (Stage 1, **Option B: curated skeleton**)

---

## 1. Goals & non-goals

### Goals

1. A new GitHub issue template that funnels "I want to add platform X" proposals into a structured shape (capabilities, auth, rate-limits, webhook, vendor-doc links, proposed adapter key).
2. A `pnpm create-adapter <name>` command that scaffolds a compilable, lint-clean plugin package at `libs/integrations/<name>/` with the contract surface in place (plugin descriptor, NestJS module, adapter factory, barrel, workspace config). Contributor adds capabilities by following `docs/plugin-author-guide.md`.
3. Wire-ups: root `package.json` script, CONTRIBUTING.md note, plugin-author-guide § Step 3 mention.

### Non-goals (deferred)

- Stage 2 from #564: published `@openlinker/create-integration` npm package or Nest schematic. Locked behind Modularity Thread F (#552) / npm publishing readiness.
- Generating capability-adapter stubs (e.g., a half-implemented `OrderSource` adapter). The skeleton stops at the factory surface; capability authoring follows the guide.
- Automated post-scaffold verification (compile/lint) beyond manual smoke tests during development. The scaffolder script itself doesn't ship with a unit test — see §6 for the reasoning.

---

## 2. Layer classification

**DX / repo tooling.** No CORE, Integration, Interface, or Frontend code changes. Touches:

- `.github/ISSUE_TEMPLATE/` (new file)
- `scripts/` (new file)
- `package.json` (one new script entry)
- `CONTRIBUTING.md` (mention `pnpm create-adapter`)
- `docs/plugin-author-guide.md` (Step 3 callout for the scaffolder)
- `libs/integrations/` (no source changes — only the test artifact produced during manual verification, which gets deleted before commit)

---

## 3. Research summary

### Reference adapters surveyed

- `libs/integrations/prestashop/` — 68 files, ~14k LOC, 4 capabilities + 2 provisioners + full HTTP/XML stack. Per the plugin-author-guide we just shipped, this is the **canonical reference** contributors copy by hand.
- `libs/integrations/allegro/` — adds OAuth + plugin-owned migration on top of the PS shape.
- `libs/integrations/ai/` — stateless port-router (dynamic module). Not a per-connection plugin; not a model for new adapters.

### Existing template conventions

- `.github/ISSUE_TEMPLATE/feature_request.md` — frontmatter + markdown sections; checkbox lists for "Affected Components"; an "Architecture Considerations" prompt; closing "Acceptance Criteria" checklist. The new-integration template will mirror that shape.

### Existing script conventions

- `scripts/` contains five tools today: 1 bash invariant (`check-fixture-purity.sh`), 4 Node `.mjs` invariants. None ship a test. None are interactive. All are chained into `pnpm lint` via `check:invariants`.
- The scaffolder breaks this pattern in one direction (it's interactive — takes a CLI arg) but matches it in the other (Node `.mjs`, no test, ESM with `import.meta.url` for path resolution).

### Reference adapter file inventory (what the skeleton ships vs omits)

Files the skeleton **ships** (~15 files, all compilable, all stubs/templates):

| File | Role |
|---|---|
| `package.json` | workspace pkg, `@openlinker/integrations-<name>`, peer-dep on `@nestjs/common` |
| `tsconfig.json` | composite TS project, references `../../core`, `../../shared`, `../../plugin-sdk` |
| `tsconfig.spec.json` | jest-only config: `module: Node16` + jest/node types |
| `jest.config.mjs` | ts-jest + module-name-mapper for sibling packages |
| `README.md` | pinned content (see §4): heading + scaffolded-status callout + one-line pointer to the plugin author guide |
| `src/index.ts` | minimal barrel: plugin factory + manifest + module |
| `src/<name>-plugin.ts` | `createXPlugin(deps)` + `xAdapterManifest` (empty `supportedCapabilities`) + brand label |
| `src/<name>-integration.module.ts` | **`createNestAdapterModule(plugin)` helper form** — 5-line NestJS module that wraps the descriptor (decision: §4 *Module template — helper pattern by default*) |
| `src/application/<name>-adapter.factory.ts` | factory class, `createAdapters` stub that throws "not implemented" |
| `src/application/interfaces/<name>-adapter.factory.interface.ts` | factory interface |
| `src/domain/types/<name>-config.types.ts` | `XConnectionConfig` interface stub |
| `src/domain/types/<name>-credentials.types.ts` | `XCredentials` interface stub |
| `src/domain/exceptions/.gitkeep` | empty dir marker |
| `src/infrastructure/adapters/.gitkeep` | empty dir marker |

Files the skeleton **omits** (contributor adds as they implement capabilities):

- HTTP client (`infrastructure/http/`)
- Mappers (`infrastructure/mappers/`)
- Provisioners (`infrastructure/provisioners/`)
- Shape validators (`infrastructure/adapters/<name>-connection-config-shape-validator.adapter.ts` + credentials variant)
- Connection tester (`infrastructure/adapters/<name>-connection-tester.adapter.ts`)
- Webhook provisioner (`infrastructure/adapters/<name>-webhook-provisioning.adapter.ts`)
- Capability adapters (`infrastructure/adapters/<name>-{product-master,inventory-master,order-source,order-processor-manager}.adapter.ts`)
- DTOs (`application/dto/`)
- Tests (`__tests__/`, `src/**/__tests__/`)
- Per-package `.eslintrc.js` — none of the existing in-tree plugins carry one; they inherit the root config.
- Plugin-owned `migrations/` — opt-in per #599; skeleton author adds when needed

### Token scheme

The scaffolder needs three tokens to substitute across templates:

| Token | Example for `--name shopify` | Use |
|---|---|---|
| `__name__` | `shopify` | filenames, paths, `platformType`, adapterKey prefix |
| `__Name__` | `Shopify` | class names (PascalCase) |
| `__BRAND__` | `Shopify` | short label for `xBrand` const + exception prefixes — same as `__Name__` by default; surfaced separately so a contributor can rename without grepping |

Templates carry these tokens literally; the scaffolder does a single-pass string replace per file.

### Template storage — external files

Templates live as **external files** under `scripts/create-adapter-templates/`, mirroring the target tree under `libs/integrations/<name>/` 1:1. File extensions match the destination (`.ts`, `.json`, `.mjs`, `.md`) so prettier formats them under `pnpm format` and the eye treats them as code, not stringly-typed payloads. The scaffolder reads each template, applies the three-token substitution, and writes the output to the target dir.

Rationale: inline-string templates inside `create-adapter.mjs` forfeit prettier coverage and make the most-edited part of the script opaque to a reviewer's diff. External files keep templates legible and lint-able. The trade-off — template files would be picked up by TypeScript `tsc --noEmit` and fail because they contain `__name__` / `__Name__` tokens — is mitigated by listing `scripts/create-adapter-templates/` in every workspace `tsconfig`'s `exclude` AND adding a top-level `.eslintignore` entry. The templates aren't real source.

---

## 4. Design

### #567 — Issue template

Single file: `.github/ISSUE_TEMPLATE/new_integration.md`. Frontmatter follows existing templates' shape. **Single-selection sections use checkboxes with a "mark one" instruction** — GitHub markdown issue templates don't have native radio inputs, and the existing six templates (`feature_request.md`, `bug_report.md`, …) all use the same checkbox convention. Body sections, in order:

1. **Platform** — name + canonical website
2. **Proposed adapter key** — `<platform>.<transport>.v<n>` with a hint at the convention
3. **Vendor API documentation** — links to vendor docs, OpenAPI spec if available, sandbox/test environment availability
4. **Target capabilities** — checkboxes for the 5 `CoreCapabilityValues` + "Other / new capability" with a sub-prompt (multi-select)
5. **Authentication model** — checkboxes (mark one): API key, OAuth 2.0 + refresh, OAuth 2.0 client-credentials, mTLS, signed requests, other
6. **Rate limits** — known caps, burst rules, retry-after support
7. **Webhook support** — checkboxes (mark one): push / pull only / partial — plus a free-text prompt for events
8. **Identifier model** — what IDs the platform exposes for products/orders/customers; whether barcodes (EAN/GTIN) are first-class
9. **Inbound order semantics** — for `OrderSource`: event-journal cursor or polling watermark; idempotency surface
10. **Maturity target** — checkboxes (mark one): alpha / beta / stable — plus a free-text prompt for what blocks promotion
11. **Reference reading** — link to `docs/plugin-author-guide.md`, `docs/architecture-overview.md § Capability Abstractions`
12. **Acceptance criteria** — checkbox list (4–6 items: adapter implements declared capabilities, shape validators registered, connection-tester registered, unit tests, docs)

### #564 — Scaffolder script

**Entry point**: `scripts/create-adapter.mjs` (Node ESM, `node:` imports only — no external deps).

**Invocation surface**:

```bash
pnpm create-adapter <name>
pnpm create-adapter <name> --target-dir /tmp/scaffold-smoke   # for verification runs
# or
node scripts/create-adapter.mjs <name> [--target-dir <dir>]
```

`<name>` is the platform slug — lowercase ASCII, 2–32 chars, leading letter, allows internal hyphens. Same character class as npm package-name (sans scope).

The `--target-dir <dir>` flag (default: `libs/integrations`) lets the scaffolder write into a tmp dir for verification runs without polluting the worktree. The target package always lands at `<target-dir>/<name>/`.

**Validation rules** (fail-fast, exit 1):

- `<name>` missing → print usage + exit
- `<name>` matches regex `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` AND length 2–32 (rejects underscores, capital letters, leading/trailing hyphens, double hyphens, too short, too long)
- `<name>` ∈ {`prestashop`, `allegro`, `ai`} → reject (clash with shipped plugins) — only enforced when `--target-dir` points inside the repo's `libs/integrations/`
- `<name>` ∈ reserved list {`core`, `shared`, `plugin-sdk`, `web`, `api`, `worker`} → reject (workspace-name collision)
- `<target-dir>/<name>/` already exists → reject
- Repo root not found (no `pnpm-workspace.yaml`) → reject (defends against running from somewhere unexpected) — only when `--target-dir` is default; with explicit `--target-dir` the script trusts the caller

**Output**: writes the 15-file skeleton listed in §3. After success, prints a 4-line next-steps block:

```
✓ Scaffolded libs/integrations/<name>/
Next:
  1. Run `pnpm install`
  2. Read docs/plugin-author-guide.md
  3. Pick a capability port and implement your first adapter
```

**Module structure**:

The script is a single file with three sections:

1. **Validation** (`validateName`, `assertSlug`)
2. **Template resolution** (walks `scripts/create-adapter-templates/` via `fs.readdir({ recursive: true })`, applies the three-token substitution to filenames and contents — see §3 *Template storage*)
3. **Scaffolding** (`scaffoldAdapter({ name, targetDir, repoRoot, templatesDir })` exported for future reuse / testing; `main()` parses argv and calls it)

Exported `scaffoldAdapter` keeps the door open for a future test or a follow-up `--dry-run` flag without restructuring the script.

### Module template — helper pattern by default

The scaffolder produces an `<name>-integration.module.ts` using the `createNestAdapterModule(plugin)` helper from `@openlinker/plugin-sdk`. Whole template body is ~10 lines:

```typescript
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { create__Name__Plugin } from './__name__-plugin';

export const __Name__IntegrationModule = createNestAdapterModule({
  plugin: create__Name__Plugin({}),
});
```

Rationale: a fresh plugin has zero plugin-specific `@Injectable`s — repositories, provisioners, refresh services all show up later as the contributor implements capabilities. The helper covers exactly that case. The plugin-author guide already documents how to graduate to the inline-from-module pattern (the PrestaShop / Allegro shape) when the plugin grows its first plugin-specific provider.

The skeleton's `README.md` includes a one-line breadcrumb to that graduation path so the contributor doesn't get stuck when their first `@Injectable` doesn't fit the helper.

### `<name>-plugin.ts` template — empty-deps shape

`CreateXPluginDeps` is `Record<string, never>` in the skeleton. `createXPlugin({})` returns a descriptor with `supportedCapabilities: []` and a `createCapabilityAdapter` that throws "not implemented" with a guide link. Registering against `host.adapterRegistry` succeeds; the runtime `getCapabilityAdapter(connectionId, '<anything>')` call would fail at capability-match time, which is the correct behavior for a no-capability scaffold.

When the contributor adds their first capability, they widen the deps interface (or add factory closure args) and grow `supportedCapabilities`. The empty-deps starting point keeps the diff focused.

### Skeleton `README.md` content (pinned)

The scaffolded `README.md` ships with this exact shape (no more, no less):

```markdown
# @openlinker/integrations-__name__

> **Status: scaffolded — capabilities not yet implemented.**

This package implements the OpenLinker capability ports for `__name__`.
See [`docs/plugin-author-guide.md`](../../../docs/plugin-author-guide.md) for the walkthrough — what files to add, which port to implement, and how the host picks up your adapter.

The integration module is currently the `createNestAdapterModule` helper form. When you add your first plugin-specific `@Injectable` provider (a repository, provisioner, HTTP client, refresh service), swap to the inline-from-module pattern documented in the guide § Step 6 *Two authoring patterns*.
```

Token substitution flips `__name__` to the platform slug. The status line is a deliberate signal the contributor edits when capabilities land.

### #564 — Plugin-author-guide § Step 3 update

The guide currently opens Step 3 with *"Copy this tree as your starting point (`libs/integrations/<platform>/`):"* — keep that as the manual path, but add a one-paragraph callout above pointing at the scaffolder as the fast path. The two paths converge: scaffolder produces the same tree the guide tells the reader to copy.

### #564 — CONTRIBUTING § Building a New Integration update

Currently reads: *"Adding a platform integration (e.g., Shopify, …) is a separate workflow…The walkthrough lives in the [Plugin Author Guide]…"* — add a one-line "Tip: run `pnpm create-adapter <name>` to scaffold the package skeleton, then follow the guide."

### #564 — Root `package.json` script

Add one entry:

```json
"create-adapter": "node scripts/create-adapter.mjs"
```

No other root-level changes. `check:invariants` is unchanged — the scaffolder isn't an invariant.

---

## 5. Implementation steps

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `.github/ISSUE_TEMPLATE/new_integration.md` | Create | 12-section markdown template per §4. Frontmatter has `name: 🧩 Add a New Integration`, `title: '[INTEGRATION] '`, `labels: ['enhancement', 'documentation']`. Single-selection sections use checkboxes with "mark one" instruction |
| 2 | `scripts/create-adapter-templates/` | Create | ~15 template files under this directory, mirroring the skeleton tree per §3. Files carry `__name__` / `__Name__` / `__BRAND__` tokens literally |
| 3 | `scripts/create-adapter.mjs` | Create | Node ESM, ~200-300 LOC. Validates `<name>`, walks `scripts/create-adapter-templates/`, applies three-token substitution, writes to `<target-dir>/<name>/`. `node scripts/create-adapter.mjs foo` from repo root produces `libs/integrations/foo/`. Supports `--target-dir <dir>` |
| 4 | `package.json` (root) | Edit | Add `"create-adapter": "node scripts/create-adapter.mjs"` under `scripts:` |
| 5 | Workspace `tsconfig` files | Edit | Add `scripts/create-adapter-templates/**` to `exclude` (root `tsconfig.json`) so templates don't fail TS check |
| 6 | `.eslintignore` (root, create if missing) | Create/Edit | Ensure `scripts/create-adapter-templates/` is ignored by ESLint |
| 7 | `CONTRIBUTING.md` | Edit | Append a tip line to the *Building a New Integration* section about `pnpm create-adapter <name>` |
| 8 | `docs/plugin-author-guide.md` | Edit | Insert a callout above the Step 3 *"Copy this tree…"* paragraph mentioning the scaffolder as the fast path |
| 9 | **Manual verification** | Run | `mkdir -p /tmp/openlinker-scaffold-smoke && node scripts/create-adapter.mjs example --target-dir /tmp/openlinker-scaffold-smoke` → scaffold to `/tmp/openlinker-scaffold-smoke/example/`. Then `cd` there and run a tsc smoke check against the templates. Tmp dir is outside the worktree — no risk of accidentally committing the artifact |

---

## 6. Validation strategy

### Architecture compliance

- The scaffolder is a build-time DX tool. No port / adapter / domain code introduced or modified — just template authoring. Hexagonal architecture is unaffected.
- Templates produce a skeleton that **respects** the architecture: domain types under `domain/`, factory under `application/`, NestJS wiring in the module, top-level barrel imports (`@openlinker/core/...`, never deep paths).

### Naming

- Template file names follow `engineering-standards.md § Naming Conventions`: `<name>-plugin.ts`, `<name>-integration.module.ts`, `<name>-adapter.factory.ts`, `*.types.ts`. Class names match `{Platform}Capability` shape where applicable.
- Adapter-key suggested in the template comment: `<name>.publicapi.v1`. Contributor adjusts during their first PR.

### Testing strategy

**The scaffolder script does not ship with an automated unit test in this PR. A follow-up issue tracks the lint-time smoke check.** Rationale:

1. The script is exercised by manual verification (§5 step 9) during development — `node scripts/create-adapter.mjs example --target-dir /tmp/openlinker-scaffold-smoke` followed by `tsc --noEmit` against the output. That's a strong end-to-end smoke check at author time.
2. Adding a `.mjs` test runner under `scripts/` (where no tests live today) introduces infra cost. The other invariant scripts under `scripts/` ship without tests.
3. Co-locating a test inside `apps/api/test/` would be a category error — the scaffolder isn't part of the API.
4. Stage 2 from #564 (npm package / schematic) will live in its own package with its own test setup. That's the right home for invested test infrastructure.

**Follow-up tracking**: at PR-creation time, open a follow-up issue (analogous to #680 for the plugin-author-guide quote drift) for `scripts/check-create-adapter.mjs` — a lint-time invariant that scaffolds into a tmp dir via the exported `scaffoldAdapter`, asserts the expected file list, and runs `tsc --noEmit`. Chained into `check:invariants`. Honest framing: this PR ships the scaffolder; the drift guard is a separate, smaller follow-up. Cross-link from the PR body.

### Security

- Scaffolder reads no secrets, writes no creds. The only filesystem mutation is creating files under `libs/integrations/<name>/`.
- `<name>` validation defends against path traversal (regex bounds it to a single segment, no `..`, no `/`).
- Template strings contain no executable content — pure data. No `eval`, no `require(<dynamic>)`.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Template drift — reference adapter evolves, scaffolder output goes stale | Medium | Tracked openly as a known limitation. Eventual hardening: structural-shape CI check (out of scope). Inline templates keep all drift visible in one file (`scripts/create-adapter.mjs`). |
| Contributor scaffolds, then doesn't read the guide | Low | Skeleton's `README.md` and the post-scaffold console output both link the guide. Adapter-factory `createAdapters` throws a "not implemented" with a guide-link error message — runtime failure leads the contributor to the docs. |
| Scaffolder produces output that doesn't compile after a future TypeScript or dep bump | Low | Manual verification (§5 step 6) catches this every time the scaffolder is touched. If a contributor hits it months later, they file a bug; we re-verify and patch templates. |

### Open questions

None blocking. One soft choice:

1. **Issue template emoji prefix**: chose `🧩 Add a New Integration` to visually distinguish from the existing 6 templates. Drop if the reviewer pushes back.

---

## 7. Out of scope

- Scaffolding sub-flavors (`--from-prestashop` to literal-clone PS; `--with-oauth` to seed OAuth scaffolding from Allegro). Easy to add later if demand emerges.
- A "delete adapter" complement script.
- Automatic `apps/api/src/plugins.ts` registration — the contributor edits one line by hand; that's explicitly the single edit point per `docs/architecture-overview.md`.
- The lint-time quote-drift invariant for `plugin-author-guide.md` (tracked separately in #680).
- Wider issue-template ergonomics (form-style YAML templates rather than markdown). Existing templates are markdown; matching that.

---

## 8. PR shape

Single PR. Commit grouping: one commit. Conventional-commit prefix `feat(dx)` since the scaffolder is a new feature surface; `docs:` doesn't fit because it ships executable code.

Body: `Closes #567`, `Closes #564`.

Expected diff stat: ~600 LOC added (~250 LOC scaffolder + ~120 LOC issue template + ~30 LOC of template inline strings + ~10 LOC root package.json + small CONTRIBUTING/guide touches). Zero deletions.
