# Implementation Plan — Plugin-Owned Migrations (#599)

**Issue:** [F12 HIGH] Plugin-owned migrations have no shipping path
**Branch:** `599-plugin-owned-migrations`
**Parent epic:** #552 — Modularity Thread F (SDK boundary)
**Builds on:** #593 (`AdapterPlugin` contract), #597 (`@openlinker/plugin-sdk` package)

---

## 1. Goal & Non-Goals

### Goal

Today `apps/api/src/migrations/` is the only home for TypeORM migrations. A plugin shipping its own ORM entities — e.g. Allegro's `AllegroQuantityCommandOrmEntity`, or a future Shopify offer-cache table — has nowhere to put its DDL but to drop it into core's migrations dir. The live exhibit: `apps/api/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts` is Allegro's table living in core's migrations folder because there's no other place.

This PR adds a per-plugin migration shipping path:

- Extend the `AdapterPlugin` contract with a `migrations?: string[]` field (TypeORM-style glob paths).
- Add a CLI-friendly seam `apps/api/src/plugin-migrations.ts` listing plugin migration globs — mirrors `apps/api/src/plugins.ts` (the single edit point an OSS contributor touches to enable a plugin).
- Aggregate in `apps/api/src/database/data-source.ts`: `migrations: [...coreGlob, ...pluginGlobs]`.
- Extend `scripts/check-migration-timestamps.mjs` to scan the aggregated set (cross-plugin timestamp collisions are caught at lint time).
- Move the Allegro quantity-commands migration into `libs/integrations/allegro/src/migrations/` as the live proof.
- Update `docs/migrations.md` § Architecture: scope "apps/api owns the *core* schema, plugins own theirs."

### Non-Goals

- **No dynamic plugin discovery at CLI time.** The data-source is loaded by TypeORM CLI without NestJS bootstrap; we can't read plugin descriptors at runtime there. The `plugin-migrations.ts` seam is the OSS-contributor-facing source of truth at the CLI layer; the descriptor's `migrations` field is informational + used by integration-test harnesses. The two are kept in sync manually — same as `plugins.ts` today.
- **No changes to migration-running behaviour at test time.** Test env uses `synchronize: true` (auto-create tables from ORM entities); plugin tables already work in int-tests via `TypeOrmModule.forFeature`. We're not making integration tests run migrations.
- **No new migration-tooling commands.** Plugin authors still use `pnpm --filter @openlinker/api migration:generate` against the aggregated data-source to author migrations.
- **No plugin-uninstall / migration-revert-on-uninstall machinery.** Out of scope (no plugin uninstall flow exists yet).
- **No changes to `AiIntegrationModule`.** It's not a per-connection plugin; it doesn't ship its own tables. (The `prompt_templates` and `ai_provider_active_setting` tables it uses live in core — see `docs/architecture-overview.md` § AI.)

---

## 2. Current State (Research Findings)

### Migration seams today

| Seam | File | Behaviour |
|---|---|---|
| TypeORM CLI data-source | `apps/api/src/database/data-source.ts` | `entities: [.../libs/core/src/**/*.orm-entity{.ts,.js}]`, `migrations: [.../apps/api/src/migrations/**/*{.ts,.js}]`. Loaded directly by `typeorm` CLI without Nest bootstrap. |
| Runtime DB module | `libs/shared/src/database/database.module.ts` | `autoLoadEntities: true`, `synchronize: !production`, `migrationsRun: false`. Migrations never auto-run; CLI invocation is the canonical path. |
| Int-test harness | `apps/api/test/integration/setup.ts:81-100` | Reads `dataSource.options.synchronize`; if true, **skips migrations**. Tables come from auto-create via `TypeOrmModule.forFeature`. |
| Timestamp invariant | `scripts/check-migration-timestamps.mjs` | Hardcoded scan path `apps/api/src/migrations`. Validates 13-digit prefix, class-suffix match, uniqueness. |
| Plugin list (Nest) | `apps/api/src/plugins.ts` + `apps/worker/src/plugins.ts` | The OSS-contributor single edit point for enabling a plugin. Lists NestJS modules; not loaded by TypeORM CLI. |

### Allegro's "leaked" migration (the live exhibit)

```
apps/api/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts
                                                             ^^^^^^^^^^^^^^^
                                                             plugin-specific!
```

Creates `allegro_quantity_commands` (FK to `connections.id`) — supports `AllegroQuantityCommandOrmEntity` registered by `AllegroIntegrationModule` via `TypeOrmModule.forFeature(...)`. The table is part of the Allegro plugin's surface, not core's. Migrating this file out of `apps/api/src/migrations/` into the plugin's package validates the new contract end-to-end.

### Plugin SDK (post-#593)

`AdapterPlugin` interface at `libs/plugin-sdk/src/adapter-plugin.ts`:
```typescript
export interface AdapterPlugin {
  readonly manifest: AdapterMetadata;
  register?(host: HostServices): void;
  createCapabilityAdapter<T>(connection, capability, host): Promise<T>;
}
```

Adding a `migrations` field to this interface gives plugin authors a declarative seam matching the issue's recommendation.

---

## 3. Design

### 3.1 New field on `AdapterPlugin`

```typescript
// libs/plugin-sdk/src/adapter-plugin.ts
export interface AdapterPlugin {
  readonly manifest: AdapterMetadata;
  register?(host: HostServices): void;
  createCapabilityAdapter<T>(...): Promise<T>;

  /**
   * Optional. TypeORM migration glob paths the plugin ships. Resolved
   * relative to the plugin's package root (typically
   * `dist/migrations/**\/*{.ts,.js}` for published packages, or
   * `src/migrations/**\/*{.ts,.js}` for the in-tree dev path).
   *
   * Plugin authors declare what they ship; the host's
   * `apps/api/src/plugin-migrations.ts` list is the authoritative seam
   * the TypeORM CLI reads at boot. Keep the two in sync — descriptor is
   * informational, CLI list is canonical (mirrors the
   * `plugins.ts`/descriptor split for runtime adapter registration).
   */
  readonly migrations?: readonly string[];
}
```

### 3.2 New CLI seam: `apps/api/src/plugin-migrations.ts`

```typescript
// apps/api/src/plugin-migrations.ts
/**
 * API Plugin Migrations
 *
 * The TypeORM CLI data-source at `apps/api/src/database/data-source.ts`
 * reads this list to aggregate plugin-owned migrations into the core
 * migration set. Mirrors `apps/api/src/plugins.ts` — the single edit
 * point an OSS contributor touches to enable a plugin's tables.
 *
 * Each entry is an absolute path (resolved via `path.resolve`) to a
 * glob the TypeORM CLI can expand. In-tree paths point at the
 * workspace source; published-package paths would point at
 * `node_modules/<pkg>/dist/migrations/...`.
 *
 * Keep aligned with each plugin's `AdapterPlugin.migrations` field
 * (the descriptor-side declaration). The CLI doesn't read descriptors;
 * the descriptor doesn't drive the CLI. Both are author-facing.
 *
 * @module apps/api/src
 */
import { resolve } from 'node:path';

export const apiPluginMigrations: string[] = [
  // Allegro plugin (#599)
  resolve(__dirname, '../../../libs/integrations/allegro/src/migrations/**/*{.ts,.js}'),
];
```

### 3.3 `data-source.ts` aggregation

```typescript
// apps/api/src/database/data-source.ts
import { apiPluginMigrations } from '../plugin-migrations';

// …
migrations: [
  __dirname + '/../migrations/**/*{.ts,.js}',
  ...apiPluginMigrations,
],
```

### 3.4 Invariant script extension

`scripts/check-migration-timestamps.mjs` is currently hardcoded to scan `apps/api/src/migrations/`. Add a sibling scan over plugin migration directories so cross-plugin timestamp collisions also fail `pnpm lint`.

**Approach (single source of truth):** the invariant script imports the same list `data-source.ts` reads — `apps/api/src/plugin-migrations.ts`. The `.mjs` script loads the TS file via `ts-node/register` (already a build-time dev dep). One list, no drift risk by plugin #3 / #4. The script extracts the directory portion of each glob and walks those directories the same way it walks `apps/api/src/migrations`.

This is a small loader complication but a permanent ergonomics win — no cross-reference comments to enforce, no JSON manifest middleware. If `ts-node/register` proves too heavy at lint time, fall back to a minimal `.cjs` shim that re-exports the path list (TypeScript's import is the seam; the script reads via `require()`).

### 3.5 Move Allegro migration

```
apps/api/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts
  →
libs/integrations/allegro/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts
```

Update `libs/integrations/allegro/src/allegro-plugin.ts` to declare:

```typescript
{
  manifest: { /* … unchanged … */ },
  migrations: [
    // Resolved relative to package root at runtime; in dev, points at src/.
    // Listed informationally — the authoritative CLI seam is
    // apps/api/src/plugin-migrations.ts.
  ],
  register(host) { /* unchanged */ },
  createCapabilityAdapter(...) { /* unchanged */ },
}
```

**Decision: include the field.** Populated by `createAllegroPlugin()` for plugin-author ergonomics — the plugin's barrel can advertise what tables it ships. The field is informational only; per §3.1's JSDoc, the CLI seam in §3.2 (`apps/api/src/plugin-migrations.ts`) is what TypeORM actually reads.

### 3.6 Build-output consideration

Production runs migrations against compiled JS, not source TS. The `dist/` layout for `libs/integrations/allegro/` is `dist/index.js` + `dist/migrations/<file>.js`. The glob `libs/integrations/allegro/src/migrations/**/*{.ts,.js}` works in dev (source) but not in prod (compiled). 

Mirroring the existing core data-source approach: the glob `__dirname + '/../../../../libs/core/src/**/*.orm-entity{.ts,.js}'` already handles dev (`.ts`) + prod (`.js`) via the `{.ts,.js}` extension alternation. The plugin migration glob uses the same pattern.

But: in prod (`apps/api/dist/...`), `__dirname` points into `apps/api/dist/apps/api/src/database/` and the relative path `../../../../libs/integrations/allegro/src/migrations/` falls outside the compiled dist tree. Need to verify the existing core data-source actually works in prod — if it does, the plugin path will work for the same reasons.

Quick check during research: `data-source.ts` is itself compiled to `apps/api/dist/apps/api/src/database/data-source.js`. The glob `__dirname + '/../../../../libs/core/src/**/*.orm-entity{.ts,.js}'` resolves to `<repo-root>/libs/core/src/...` — that's where the source lives, NOT where the compiled output lives. So the existing setup only works for production deployments that ship the *source* tree alongside the compiled output, OR via `composite: true` `references` that emit `.d.ts` alongside `.ts`. In practice: the production deployment artifact must include `libs/core/src/**/*.orm-entity.ts` for entity discovery, OR the data-source is regenerated for production. This is a *pre-existing* concern that's out of scope for #599. Plugin migrations follow the same convention.

---

## 4. Step-by-Step Implementation

### Phase A — SDK contract extension

1. Add `migrations?: readonly string[]` to `AdapterPlugin` at `libs/plugin-sdk/src/adapter-plugin.ts`. Plan §3.1.

### Phase B — CLI seam + data-source aggregation

2. Create `apps/api/src/plugin-migrations.ts` per §3.2. Initial content: one entry for Allegro.
3. Update `apps/api/src/database/data-source.ts` to import + spread `apiPluginMigrations` into the `migrations` array. Plan §3.3.

### Phase C — Move Allegro's migration

4. `git mv apps/api/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts libs/integrations/allegro/src/migrations/1767900000000-add-allegro-quantity-commands-table.ts`. Keep the timestamp + class name identical (no `migrations` table row churn — the canonical name TypeORM stores is the class name, not the file path).
5. Verify the Allegro `tsconfig.json` includes `src/**/*` (it should — check). Add `migrations` to the package's published files in `package.json` `files: ["dist"]` if needed.
6. Add the `migrations` declaration to `libs/integrations/allegro/src/allegro-plugin.ts`. Plan §3.5.

### Phase D — Invariant script

7. Update `scripts/check-migration-timestamps.mjs` to also scan `libs/integrations/allegro/src/migrations/`. Use a list constant in the script — keep aligned with `apps/api/src/plugin-migrations.ts` (add a comment in both files cross-referencing).
8. Verify `pnpm lint` still passes (the moved migration's timestamp + class name should still match).

### Phase E — Doc update

9. Update `docs/migrations.md` § Architecture: "apps/api owns the *core* schema, plugins own theirs." Add a new sub-section "Plugin-owned migrations (#599)" with the recipe: declare `migrations` on `AdapterPlugin` + register the glob in `apps/api/src/plugin-migrations.ts`.

### Phase F — Validate

10. `pnpm lint` (must pass; invariant script catches timestamp collisions across paths).
11. `pnpm type-check` (clean).
12. `pnpm test` (all unit tests green).
13. `pnpm --filter @openlinker/api migration:show` — confirms TypeORM CLI sees the migration at its new path. Should report `[X] AddAllegroQuantityCommandsTable1767900000000` if previously run, or `[ ] ` if not (the migration is idempotent in either case).
14. **Integration tests** (`pnpm test:integration`) — the heavy gate. With test env using `synchronize: true`, the Allegro table comes from auto-create at boot; migration path is not exercised in tests. But verify the int-test harness still boots cleanly and the `allegro_quantity_commands` table exists.

---

## 5. Testing Strategy

| Path | What to verify |
|---|---|
| Unit tests | No new behaviour; existing tests stay green. SDK type-check confirms `AdapterPlugin.migrations` is well-typed. |
| `pnpm lint` (invariant script) | Validates 40 core + 1 plugin migration. Timestamps unique across the union. |
| `pnpm migration:show` | Reports the moved Allegro migration at its new path. |
| Integration tests | Allegro plugin still boots, `allegro_quantity_commands` table exists. (Indirect — test env uses synchronize.) |
| Manual prod-path smoke | Out of CI scope; the data-source loader resolves the moved migration glob correctly. Verified by `migration:show` succeeding. |

---

## 6. Architecture Compliance

- ✅ Contract change lives in `@openlinker/plugin-sdk` — the framework-neutral SDK package, where the rest of the descriptor surface lives (post-#593).
- ✅ CLI seam (`apps/api/src/plugin-migrations.ts`) mirrors the existing `apps/api/src/plugins.ts` pattern — single edit point for enabling a plugin's schema. No NestJS dependency in the seam itself; it's pure path strings.
- ✅ No domain layer changes; no port/adapter contracts modified.
- ✅ Plugin migration files live in `libs/integrations/<platform>/src/migrations/` — the natural home next to the ORM entities (`libs/integrations/<platform>/src/infrastructure/persistence/entities/`) those migrations create tables for.
- ✅ Timestamp invariant remains enforced — extension covers the new paths.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Cross-plugin timestamp collisions (Allegro + future Shopify pick the same 13-digit prefix). | Invariant script extension covers the aggregated set — collision fails `pnpm lint` at pre-commit / CI. |
| Production glob path resolution breaks for plugin migrations the same way it could for core ORM entities. | Pre-existing concern; not in scope for #599. Plugin migrations follow the same glob pattern + same risk surface. If prod path discovery is broken for either, it's a single-issue fix that affects both. |
| Moving the migration changes TypeORM's recorded `name` in the `migrations` table (it tracks by class name). | Verified that file location does NOT affect the `name` column — TypeORM stores the migration *class name* (e.g. `AddAllegroQuantityCommandsTable1767900000000`). Moving the file but keeping the class name + timestamp identical means existing prod DBs see no change. |
| `apps/api/src/plugin-migrations.ts` and `scripts/check-migration-timestamps.mjs` drift over time (two lists of paths). | Cross-reference comment in both files. Two entries on day one; reviewers must update both when adding a plugin. Cost of duplication outweighs the cost of a JSON-loader middleware for now. |
| Test harness using `synchronize: true` masks migration regressions. | Out of scope — this PR doesn't change the test-env decision. Production migration-run path is the testing gate, exercised by deployment, not int-tests. Pre-existing characteristic. |
| The new field on `AdapterPlugin` is optional, but plugin authors might confuse `descriptor.migrations` with the CLI seam. | The field's JSDoc explicitly says the CLI list is authoritative; the descriptor field is informational. Document in `migrations.md`. |

---

## 8. What's Deferred

- **Per-plugin migration-table partitioning** (separate `migrations_<plugin>` tables per plugin). TypeORM's `migrationsTableName` is process-wide. Out of scope; aggregated single `migrations` table is fine for the current scale.
- **Plugin uninstall / migration-revert-on-uninstall** — no uninstall flow exists.
- **Migration generation from a plugin context** (`pnpm --filter @openlinker/integrations-allegro migration:generate`). Today plugin authors run `pnpm --filter @openlinker/api migration:generate -- src/migrations/Foo` and then manually move the file into their plugin package. Acceptable for the first cut. A future Thread F PR could add a per-plugin migration-generate script.
- **Dynamic plugin migration discovery via `node_modules` walks**. The static `plugin-migrations.ts` list is simpler and matches the existing `plugins.ts` paradigm.

---

## 9. Open Questions

None blocking. The two minor judgment calls noted in §3.4 (duplication vs JSON manifest) and §3.5 (include descriptor field for ergonomics or not) are resolved in favour of the simpler option. If review pushes back on the duplication, switching to a JSON manifest is a 10-line follow-up.
