# Implementation Plan — Move ORM-entity exports off the public context barrels

**Issue**: #594 (Modularity Thread F · F7 · MEDIUM · SDK-11)
**Parent**: #552 — Modularity Thread F (SDK boundary preparation)

---

## 1. Understanding the task

### Goal

Every core bounded-context barrel currently re-exports its TypeORM entity classes. Anything visible in a public barrel becomes a backwards-compat liability — and ORM entities are infrastructure detail (decorated TypeORM classes carrying column types, indexes, FKs). A plugin author building against `@openlinker/core/<ctx>` should not be forced to see them.

Move all ORM-entity exports off the main context barrels onto dedicated `@openlinker/core/<ctx>/orm-entities` sub-paths consumed only by:

- TypeORM data-source / migration glob loaders (today: `apps/api/src/database/data-source.ts` — uses a filesystem glob, so this consumer is *not* actually affected).
- Integration-test fixtures and helpers in `apps/api/test/` and `apps/worker/test/`.
- Core orchestration modules that need to `TypeOrmModule.forFeature([…])` a sibling context's entity (today: `libs/core/src/listings/listings.module.ts`).

### Layer

CORE / DX — touches `libs/core` public surface, `libs/core/package.json` `exports` field, ESLint guards, integration tests, docs. No runtime behaviour changes.

### Non-goals

- **Do NOT** refactor where individual modules register ORM entities (`TypeOrmModule.forFeature`). Same registrations, just routed through new import paths.
- **Do NOT** pull repository class exports off the barrels (separate concern; the `WebhookDeliveryRepository` `export *` in `libs/core/src/webhooks/index.ts` is intentionally left in place).
- **Do NOT** remove the AI module's ORM entities — they aren't exported from `@openlinker/core/ai` today, so nothing to do.
- **Do NOT** widen scope to `AllegroCategoryCacheOrmEntity` (app-local in `apps/api/src/categories/`) or `AllegroQuantityCommandOrmEntity` (plugin-local in `libs/integrations/allegro/`). Both stay private to their owners.
- **Do NOT** rename or reshape any ORM entity class.

---

## 2. Research findings

### Current ORM exports (main barrels)

```
libs/core/src/products/index.ts:63        ProductOrmEntity
libs/core/src/products/index.ts:64        ProductVariantOrmEntity
libs/core/src/inventory/index.ts:55       InventoryItemOrmEntity
libs/core/src/orders/index.ts:102         OrderRecordOrmEntity
libs/core/src/sync/index.ts:108           SyncJobOrmEntity
libs/core/src/sync/index.ts:109           ConnectionCursorOrmEntity
libs/core/src/identifier-mapping/index.ts:27   IdentifierMappingOrmEntity
libs/core/src/identifier-mapping/index.ts:28   ConnectionOrmEntity
libs/core/src/integrations/index.ts:55    IntegrationCredentialOrmEntity
libs/core/src/users/index.ts:31           UserOrmEntity
libs/core/src/users/index.ts:32           PasswordResetTokenOrmEntity
libs/core/src/customers/index.ts:27       CustomerProjectionOrmEntity
libs/core/src/customers/index.ts:28       CustomerAddressProjectionOrmEntity
libs/core/src/customers/index.ts:29       DestinationAddressMappingOrmEntity
libs/core/src/content/index.ts:32         ProductContentFieldOrmEntity
libs/core/src/webhooks/index.ts            WebhookDeliveryOrmEntity (re-exported via `export *`)
```

### Cross-context consumers (the only legitimate ones today)

`apps/api/test/integration/`:
- `fixtures/inventory.fixtures.ts` → `ProductOrmEntity`, `InventoryItemOrmEntity`
- `fixtures/order.fixtures.ts` → `OrderRecordOrmEntity`
- `fixtures/sync-job.fixtures.ts` → `SyncJobOrmEntity`
- `helpers/test-database.helper.ts` → `ConnectionOrmEntity`
- `helpers/test-connection.helper.ts` → `ConnectionOrmEntity`
- `order-destination-retry.int-spec.ts` → `IdentifierMappingOrmEntity`
- `connection-credentials.int-spec.ts` → `IntegrationCredentialOrmEntity`
- `content-editor-and-suggest.int-spec.ts` → `ProductOrmEntity`
- `content-draft.int-spec.ts` → `ProductOrmEntity`, `ProductContentFieldOrmEntity`
- `sync-jobs-retry-grouped.int-spec.ts` → `SyncJobOrmEntity`

`apps/worker/test/integration/`:
- `product-sync-e2e.int-spec.ts` → `ProductOrmEntity`, `ProductVariantOrmEntity`
- `marketplace-offers-sync-e2e.int-spec.ts` → `ProductOrmEntity`, `ProductVariantOrmEntity`, `IdentifierMappingOrmEntity`
- `master-inventory-sync-all-e2e.int-spec.ts` → `IdentifierMappingOrmEntity`
- `helpers/test-sync-job.helper.ts` → `SyncJobOrmEntity`
- `helpers/test-connection.helper.ts` → `ConnectionOrmEntity`

`libs/core/` internal:
- `listings/listings.module.ts:11` → `IdentifierMappingOrmEntity` (used in `TypeOrmModule.forFeature([…])`)

### Currently-exported-but-unused entities

These barrels expose ORM classes that have **zero** consumers outside their own module:

- `users/index.ts` → `UserOrmEntity`, `PasswordResetTokenOrmEntity`
- `customers/index.ts` → `CustomerProjectionOrmEntity`, `CustomerAddressProjectionOrmEntity`, `DestinationAddressMappingOrmEntity`
- `webhooks/index.ts` → `WebhookDeliveryOrmEntity` (via `export *`)
- `sync/index.ts` → `ConnectionCursorOrmEntity`

These can be **deleted outright** from their barrels. No sub-barrel needed for them — `data-source.ts` finds the files via its `**/*.orm-entity{.ts,.js}` glob, and same-module registrations use relative paths.

### `data-source.ts` is not actually affected

`apps/api/src/database/data-source.ts:64-66`:
```ts
entities: [
  __dirname + '/../../../../libs/core/src/**/*.orm-entity{.ts,.js}',
],
```

TypeORM CLI loads entity classes by globbing the filesystem — the barrel exports were never on the load path. The issue's wording ("subpath used only by `apps/api/src/data-source.ts` and integration test setup") slightly misrepresents this; in practice the sub-barrel only needs to support integration tests + the one in-core cross-context module registration. Worth recording.

### ESLint guards today

`.eslintrc.js` already blocks these patterns for `libs/integrations/**`, `apps/{api,worker}/**/*.ts`, and `libs/core/src/**/domain/ports/**/*.{port,capability,types}.ts`:

```
@openlinker/core/*/domain/**
@openlinker/core/*/application/**
@openlinker/core/*/infrastructure/**
```

`@openlinker/core/<ctx>/orm-entities` is a 3-segment path — none of the existing patterns match it. New ban entries are needed for `libs/integrations/**` and port files, otherwise plugin authors could simply read ORM types through the sub-barrel and we'd be back where we started.

---

## 3. Design

### Sub-barrel pattern

For each context that has cross-context consumers, add a thin file at `libs/core/src/<ctx>/orm-entities.ts`:

```ts
/**
 * <Context> — ORM Entities sub-barrel.
 *
 * Host-only seam. Consumed exclusively by:
 *   - TypeORM data-source / migration loaders.
 *   - Integration-test fixtures and helpers.
 *   - Core orchestration modules registering sibling-context entities.
 *
 * Plugin packages (libs/integrations/**) must not import from here.
 *
 * @module libs/core/src/<ctx>/orm-entities
 */
export { XxxOrmEntity } from './infrastructure/persistence/entities/xxx.orm-entity';
```

`libs/core/package.json` `exports`:

```json
"./<ctx>/orm-entities": {
  "types": "./dist/<ctx>/orm-entities.d.ts",
  "require": "./dist/<ctx>/orm-entities.js",
  "default": "./dist/<ctx>/orm-entities.js"
}
```

### Which contexts get a sub-barrel

| Context | Sub-barrel? | Reason |
|---|---|---|
| `products` | ✅ | `ProductOrmEntity`, `ProductVariantOrmEntity` used by tests |
| `inventory` | ✅ | `InventoryItemOrmEntity` used by fixtures |
| `orders` | ✅ | `OrderRecordOrmEntity` used by fixtures |
| `sync` | ✅ | `SyncJobOrmEntity` used by tests (only) |
| `identifier-mapping` | ✅ | `ConnectionOrmEntity`, `IdentifierMappingOrmEntity` used by tests + `listings.module.ts` |
| `integrations` | ✅ | `IntegrationCredentialOrmEntity` used by tests |
| `content` | ✅ | `ProductContentFieldOrmEntity` used by tests |
| `users` | ❌ | no external consumer — drop from main barrel, no sub-barrel needed |
| `customers` | ❌ | no external consumer |
| `webhooks` | ❌ | no external consumer (remove the orm-entity `export *` line) |
| `ai` | ❌ | already not in main barrel; no external consumer |

`sync/orm-entities.ts` only re-exports `SyncJobOrmEntity`. `ConnectionCursorOrmEntity` has no external consumer, so it's dropped, not promoted.

### ESLint guard updates

Two existing override blocks gain a fourth pattern:

```js
// libs/integrations/** (line ~297-316) — plugin contract surface
'@openlinker/core/*/orm-entities',

// libs/core/src/**/domain/ports/**/*.{port,capability,types}.ts (line ~270-290)
'@openlinker/core/*/orm-entities',
```

`apps/{api,worker}/**/*.ts` stays as-is — those are the legitimate consumers.

### Documentation updates

- `docs/architecture-overview.md` § 6 "Listings (Offers)" — currently calls out `@openlinker/core/listings/services` as "the explicit sub-barrel". Add a short note that ORM entities live on `@openlinker/core/<ctx>/orm-entities` per #594.
- `docs/engineering-standards.md` § "Import Aliases" — currently says the only allowed sub-path is `@openlinker/core/listings/services`. Extend to mention `@openlinker/core/<ctx>/orm-entities` as a host-only sub-barrel.

---

## 4. Step-by-step implementation

### Step 1 — Create sub-barrel files (7 files)

Files to create:
- `libs/core/src/products/orm-entities.ts` — `ProductOrmEntity`, `ProductVariantOrmEntity`
- `libs/core/src/inventory/orm-entities.ts` — `InventoryItemOrmEntity`
- `libs/core/src/orders/orm-entities.ts` — `OrderRecordOrmEntity`
- `libs/core/src/sync/orm-entities.ts` — `SyncJobOrmEntity`
- `libs/core/src/identifier-mapping/orm-entities.ts` — `IdentifierMappingOrmEntity`, `ConnectionOrmEntity`
- `libs/core/src/integrations/orm-entities.ts` — `IntegrationCredentialOrmEntity`
- `libs/core/src/content/orm-entities.ts` — `ProductContentFieldOrmEntity`

Each file follows the template in §3.

**Acceptance**: `tsc -b libs/core` succeeds; each sub-barrel resolves its re-exported class.

### Step 2 — Update `libs/core/package.json` `exports`

Add 7 entries under the existing `exports` map. Alphabetical placement next to each context's main entry where practical, otherwise grouped at the end. The pattern mirrors the existing `./listings/services` entry.

**Acceptance**: `node -e "require.resolve('@openlinker/core/products/orm-entities')"` resolves after a fresh `pnpm build` (and via the `paths` mapping during TypeScript compilation without a build, since this is a workspace package).

### Step 3 — Drop ORM-entity exports from main barrels (11 files)

Edit `libs/core/src/<ctx>/index.ts` for each of:
- `products` — drop 2 lines + the `// ORM Entities …` comment.
- `inventory` — drop 1 line + comment.
- `orders` — drop 1 line + comment.
- `sync` — drop both `SyncJobOrmEntity` and `ConnectionCursorOrmEntity` exports + comment.
- `identifier-mapping` — drop 2 lines + comment.
- `integrations` — drop the `IntegrationCredentialOrmEntity` line (added in #591) + neighboring comment if present.
- `content` — drop the `ProductContentFieldOrmEntity` line + comment.
- `users` — drop 2 lines + comment.
- `customers` — drop 3 lines + comment.
- `webhooks` — drop the `export * from './infrastructure/persistence/entities/webhook-delivery.orm-entity';` line.
- (No change to `ai/index.ts` — already free of ORM exports.)

**Acceptance**: `pnpm --filter @openlinker/core build` succeeds. `grep -rn "OrmEntity" libs/core/src/*/index.ts` returns no results.

### Step 4 — Migrate consumers to new sub-barrel imports (≈16 files)

`apps/api/test/integration/fixtures/`:
- `inventory.fixtures.ts` — `@openlinker/core/products` → `@openlinker/core/products/orm-entities`; `@openlinker/core/inventory` → `@openlinker/core/inventory/orm-entities`.
- `order.fixtures.ts` — `@openlinker/core/orders` → `@openlinker/core/orders/orm-entities`.
- `sync-job.fixtures.ts` — `@openlinker/core/sync` → `@openlinker/core/sync/orm-entities`.

`apps/api/test/integration/helpers/`:
- `test-database.helper.ts` — `@openlinker/core/identifier-mapping` → `@openlinker/core/identifier-mapping/orm-entities`.
- `test-connection.helper.ts` — same as above.

`apps/api/test/integration/*.int-spec.ts`:
- `order-destination-retry.int-spec.ts` → `@openlinker/core/identifier-mapping/orm-entities`.
- `connection-credentials.int-spec.ts` → `@openlinker/core/integrations/orm-entities`.
- `content-editor-and-suggest.int-spec.ts` → `@openlinker/core/products/orm-entities`.
- `content-draft.int-spec.ts` → both `@openlinker/core/products/orm-entities` and `@openlinker/core/content/orm-entities`.
- `sync-jobs-retry-grouped.int-spec.ts` → `@openlinker/core/sync/orm-entities`.

`apps/worker/test/integration/`:
- `product-sync-e2e.int-spec.ts` → `@openlinker/core/products/orm-entities`.
- `marketplace-offers-sync-e2e.int-spec.ts` → split into `/products/orm-entities` and `/identifier-mapping/orm-entities`.
- `master-inventory-sync-all-e2e.int-spec.ts` → `/identifier-mapping/orm-entities`.
- `helpers/test-sync-job.helper.ts` → `/sync/orm-entities`.
- `helpers/test-connection.helper.ts` → `/identifier-mapping/orm-entities`.

`libs/core/src/listings/listings.module.ts`:
- Split the single import `import { IdentifierMappingModule, IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping'` into two:
  ```ts
  import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
  import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
  ```

**Acceptance**: `grep -rn "OrmEntity.*from '@openlinker/core" apps/ libs/integrations/` returns only `@openlinker/core/<ctx>/orm-entities` paths (or nothing in plugin packages).

### Step 5 — Tighten ESLint guards

Edit `.eslintrc.js`:

1. **`libs/integrations/**` override** (around line 297-316): add `@openlinker/core/*/orm-entities` to the banned group. Update the message to mention ORM entities are host-only (`See #594`).

2. **Port-files override** (`libs/core/src/**/domain/ports/**/*.{port,capability,types}.ts`, around line 270-290): add `@openlinker/core/*/orm-entities` to the banned group. Ports are the plugin contract surface; they must never reference ORM types.

`apps/{api,worker}/**/*.ts` stays untouched — legitimate consumers.

**Acceptance**: synthetic-injection check —
```bash
echo "import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';" \
  >> libs/integrations/prestashop/src/index.ts
pnpm lint 2>&1 | grep "no-restricted-imports"  # should report the violation
git checkout libs/integrations/prestashop/src/index.ts
```

### Step 6 — Update docs

`docs/architecture-overview.md` § 6 "Listings (Offers)" — extend the "Public surface" note to mention ORM-entity sub-barrels:

> Cross-context ORM-entity access (host-only) is routed through `@openlinker/core/<ctx>/orm-entities` sub-barrels per #594. Plugin packages must not consume these — see `.eslintrc.js`.

`docs/engineering-standards.md` § "Import Aliases" — extend the runtime-constraint paragraph (`libs/core/package.json` exports…) and the "Why this approach" section to note the `orm-entities` sub-barrel as the second explicit sub-path (alongside `listings/services`).

### Step 7 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

All three must pass with zero errors / zero failures.

---

## 5. Validation

### Architecture compliance
- ✅ Sub-barrels live alongside the main `index.ts` (same `libs/core/src/<ctx>/`), not inside `domain/` or `application/`. No layer-boundary violation.
- ✅ ORM-entity access requires an explicit `/orm-entities` segment in the import — the layering signal is in the import path, easy to grep for, easy to lint.
- ✅ Plugin packages (`libs/integrations/**`) and port files are blocked by ESLint from reaching the sub-barrel. Host apps (`apps/api`, `apps/worker`) are explicitly allowed.
- ✅ `data-source.ts` glob loader unaffected — it never used the barrel.

### Naming
- ✅ `orm-entities` matches the issue's recommended segment name.
- ✅ Files use `.ts` (sub-barrel) — pattern mirrors `libs/core/src/listings/services/index.ts` precedent. Note: `listings/services` is a directory; `orm-entities` is a single file at the context root. Both forms are valid; the file form is simpler when the sub-barrel only re-exports.

### Testing strategy
- No new unit tests required — this is a pure re-export shuffle, no runtime logic.
- Integration tests already cover every consumer file touched in Step 4 — they all currently pass and must continue to pass with the new import paths.
- ESLint synthetic-injection check (Step 5) confirms the new guard fires.

### Security
- No new attack surface. ORM entities still loaded by the data-source the same way.

### Risks & open questions

- **Same-context ports/types unaffected**: ports never import ORM entities directly today. Verified by `grep -rn "OrmEntity" libs/core/src/**/domain/ports/`.
- **`listings.module.ts` cross-context ORM registration**: this module already double-registers an entity owned by another context. Out of scope to refactor here (would need a sub-issue under Thread F). Moving the import path keeps the existing behaviour intact.
- **Backwards compatibility**: this PR breaks anyone importing `XxxOrmEntity` from `@openlinker/core/<ctx>` without going through the sub-barrel. Inside the monorepo we control all consumers; the ESLint guard catches future regressions. No published consumers to worry about (all packages are still `0.1.0`, private).
- **TypeScript path mapping**: `tsconfig.base.json` uses `paths` resolution against `libs/core/src/<ctx>` — the sub-barrel `<ctx>/orm-entities.ts` is reachable as `@openlinker/core/<ctx>/orm-entities` without any tsconfig change.
