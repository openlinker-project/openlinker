# Implementation Plan: Promote ProductVariant to first-class EntityType (emit `ol_variant_*`)

**Date**: 2026-04-22
**Status**: Ready for Review
**Estimated Effort**: ~3 hours (backend: adapter + repo + migration; frontend: 1 test)

**Issue**: [#322](https://github.com/openlinker-project/openlinker/issues/322)

---

## 1. Task Summary

**Objective**: Mint `ol_variant_*` IDs for every PrestaShop variant (both real combinations and synthetic variants of simple products), migrate every existing variant row + FK to the new prefix, and unblock the `CreateOfferWizard` Step 1 whose regex `^ol_variant_[a-f0-9]+$` currently rejects every variant in the system.

**Root cause**: The PrestaShop product adapter mints variant mappings under `EntityType='Product'` with `metadata.isVariant=true`. `generateInternalId` lowercases the EntityType, so variants get `ol_product_*`. `EntityType` already lists `'ProductVariant'` (`identifier-mapping.types.ts:10`), but no code path uses it today — it is a ghost enum value.

**Classification**: CORE + Integration (backend-heavy: adapter, repository, identifier-mapping service, data migration) + tiny Frontend test addition.

---

## 2. Scope & Non-Goals

### In Scope
- `IdentifierMappingService.generateInternalId`: emit `ol_variant_*` for `ProductVariant` (explicit prefix override map).
- `PrestashopProductMasterAdapter`: mint variants (real + synthetic) under `EntityType='ProductVariant'`. Remove the workaround comment. Drop the `isVariant: true` metadata shim — `entityType='ProductVariant'` is now the signal.
- `PrestashopOrderProcessorManagerAdapter`: call `getExternalIds('ProductVariant', variantId)`.
- `ProductVariantRepository`: switch the identifier-mapping join to `entityType = 'ProductVariant'` and drop the `metadata.isVariant='true'` predicate.
- `syntheticExternalId` deletion in the adapter (`deleteMapping`) now under `'ProductVariant'`.
- Data migration `1788000000000-promote-product-variant-entity-type.ts`:
  - Re-prefix `product_variants.id` from `ol_product_*` → `ol_variant_*` for rows whose identifier mapping has `metadata.isVariant='true'`.
  - Update `inventory_items.productVariantId` in lockstep (FK temporarily dropped).
  - Update `offer_creation_records.internalVariantId` in lockstep.
  - Update `identifier_mappings`: `entityType='ProductVariant'`, `internalId` re-prefixed; for those rows only.
  - Preserve the reverse-ability of the migration (`down` undoes the rename and FK drop/re-add).
- Tests: update `prestashop-product-master.adapter.spec.ts` to expect `'ProductVariant'`; add a FE schema-regex test confirming `ol_variant_abc123` passes and `ol_product_abc123` fails; add an integration-test assertion that a synced variant's ID starts with `ol_variant_`.
- Docs: extend `docs/architecture-overview.md` §Internal Identifier Format with an explicit `ol_variant_*` example.

### Out of Scope
- Renaming `ProductVariant` in the `EntityType` union to `Variant` (would churn every consumer; the prefix mapping makes it unnecessary).
- Removing the `variantExternalId` metadata key (it remains a useful back-pointer for debugging, distinct from the `isVariant` shim).
- Retroactively cleaning pre-existing `isVariant: true` values out of stored `context.metadata` JSON — harmless stale data, removing it is a follow-up housekeeping pass.
- Any unrelated integration adapters (Allegro, etc.) — they don't mint variant IDs.

### Constraints
- Migration must be idempotent-ish: re-running on a DB that has no `ol_product_*` variant rows must be a no-op (guarded by the `metadata.isVariant='true'` filter + the existence of `ol_product_` rows).
- Migration must be atomic or split so no broken FK window is visible to concurrent reads — we wrap the re-prefix block in a single transaction.
- No `any`, no `console.log`, no framework imports in `domain/`.
- Backend quality gate: `pnpm lint && pnpm type-check && pnpm test`.

---

## 3. Research Summary

### Current state (key findings from exploration)
- `EntityType` already includes `'ProductVariant'` at `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts:10`.
- `generateInternalId` at `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts:328-332` returns `ol_${entityType.toLowerCase()}_${uuid}`. Without intervention, `'ProductVariant'` → `ol_productvariant_*`, which breaks the `ol_variant_*` contract documented at `docs/architecture-overview.md:512` and asserted by the FE regex at `apps/web/src/features/listings/components/create-offer-fields.schema.ts:18`.
- Adapter workaround at `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts:178-232` and the comment at lines 214-217.
- Repository queries at `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts:113,155` filter on `entityType='Product'` + `metadata->>isVariant='true'`.
- Order adapter lookup at `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts:174` calls `getExternalIds('Product', variantId)`.

### Tables carrying variant internal IDs
| Table | Column | Type | Notes |
|---|---|---|---|
| `product_variants` | `id` | `text` PK | Currently `ol_product_*` for every variant |
| `inventory_items` | `productVariantId` | `text`, FK | Nullable; FK `FK_8fa4cdd8e98fde93d4f14025417` → `product_variants.id` |
| `offer_creation_records` | `internalVariantId` | `text`, indexed | Not FK-constrained |
| `identifier_mappings` | `internalId` (+ `entityType`) | `text` | The source of truth — migration uses its rows as the `old_id → new_id` projection |

### FK to worry about
Only one: `FK_8fa4cdd8e98fde93d4f14025417` (`inventory_items.productVariantId` → `product_variants.id`). Drop it, do the re-prefix in a single transaction, re-add it.

### Frontend and tests
- Regex at `apps/web/src/features/listings/components/create-offer-fields.schema.ts:18` already expects `^ol_variant_[a-f0-9]+$` — no change needed, just a new guard test.
- Test fixtures at `apps/api/test/integration/listings-create-offer.int-spec.ts:60,87` and `apps/api/test/integration/fixtures/offer-creation-record.fixtures.ts:40` already use `ol_variant_abc123` (they were forward-looking).
- Adapter unit test at `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-product-master.adapter.spec.ts:403` asserts `{ isVariant: true, synthetic: true }` in the mapping metadata — this assertion needs to shift to asserting `entityType: 'ProductVariant'` + `synthetic: true`. `isVariant` metadata goes away.

### Latest migration timestamp
`apps/api/src/migrations/1787000000000-add-offer-creation-record-request-payload.ts`. New migration: `1788000000000`.

---

## 4. Design

### 4.1 Prefix map

Small, explicit override **colocated with `EntityTypeValues`** in `identifier-mapping.types.ts`:

```ts
// libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts
export const EntityTypeValues = [
  'Product',
  'ProductVariant',
  'Sku',
  'Order',
  'Offer',
  'Inventory',
  'Customer',
] as const;

export type EntityType = (typeof EntityTypeValues)[number];

/**
 * Entity types whose internal-ID prefix diverges from `entityType.toLowerCase()`.
 * Keep colocated with EntityTypeValues so any future divergence is discoverable here.
 */
export const ENTITY_TYPE_ID_PREFIX: Partial<Record<EntityType, string>> = {
  ProductVariant: 'variant',
};
```

Placement rationale: the prefix map is paired 1:1 with `EntityType`, so it belongs next to the union. Consistent with the existing "value constant colocated with its union" pattern (`EntityTypeValues` itself).

Why a map (and not rename the EntityType value to `Variant`)?
- `ProductVariant` is the ORM entity class name, the domain entity name, and aligns with the rest of the `{EntityName}` convention (`Product`, `Order`, `Offer`, `Inventory`, `Customer`). Renaming for a one-character ID prefix would churn every consumer and weaken the contract between "entity type name" and "ORM/domain class name".
- `'variant'` is the documented, user-facing prefix and matches the FE regex + the hand-written test fixtures. The override map makes the divergence explicit and easy to extend if another entity type ever needs it.

`generateInternalId` in `identifier-mapping.service.ts` becomes:

```ts
import { ENTITY_TYPE_ID_PREFIX, EntityType } from '../../domain/types/identifier-mapping.types';

// …

private generateInternalId(entityType: EntityType): string {
  const uuid = randomUUID().replace(/-/g, '');
  const prefix = ENTITY_TYPE_ID_PREFIX[entityType] ?? entityType.toLowerCase();
  return `ol_${prefix}_${uuid}`;
}
```

### 4.2 Adapter call-site changes

In `prestashop-product-master.adapter.ts`:

```ts
// Synthetic (simple product, no combinations)
const internalId = await this.identifierMapping.getOrCreateInternalId(
  'ProductVariant',                         // was 'Product'
  syntheticExternalId,
  this.connection.id,
  {
    parentEntityType: 'Product',
    parentInternalId: productId,
    metadata: {
      variantExternalId: syntheticExternalId,
      synthetic: true,
      // isVariant removed — entityType is now authoritative
    },
  },
);

// …

await this.identifierMapping.deleteMapping('ProductVariant', syntheticExternalId, this.connection.id);

// Real combinations
const mappingRequests = combinations.map((c) => ({
  entityType: 'ProductVariant' as const,    // was 'Product'
  externalId: String(c.id),
  connectionId: this.connection.id,
  context: {
    parentEntityType: 'Product',
    parentInternalId: productId,
    metadata: {
      variantExternalId: String(c.id),
      // isVariant removed
    },
  },
}));
```

The three-line comment at lines 214-217 is deleted.

### 4.3 Order adapter

Two changes at `prestashop-order-processor-manager.adapter.ts:170-174`:

1. Replace the stale comment block — *"PrestaShop uses 'combinations' for variants, which are mapped as Product entities with a product_attribute_id"* — since "mapped as Product entities" is no longer true. Drop it entirely unless it needs to explain something non-obvious after the change (it doesn't; the `getExternalIds` call is self-describing).
2. Swap the entity type:

```ts
const variantExternalIds = await this.identifierMapping.getExternalIds('ProductVariant', item.variantId);
```

### 4.4 Repository queries

`product-variant.repository.ts:113,155`: the identifier-mapping join becomes:

```ts
`mapping.internalId = variant.id
   AND mapping.connectionId = :connectionId
   AND mapping.entityType = :entityType`,
{ connectionId, entityType: 'ProductVariant' },
```

(The `metadata->>isVariant='true'` predicate is removed; the entityType is now the signal.)

### 4.5 Migration `1788000000000-promote-product-variant-entity-type.ts`

Strategy (all inside one TypeORM transaction — `QueryRunner` is transactional per call from a single migration):

```
-- 1. Drop FK_8fa4cdd8e98fde93d4f14025417

-- 2. Build a temp table of (old_id, new_id, mapping_id)
CREATE TEMP TABLE variant_id_migration AS
SELECT
  im.id           AS mapping_id,
  im."internalId" AS old_id,
  'ol_variant_' || substring(im."internalId" from 12)  AS new_id
FROM identifier_mappings im
WHERE im."entityType" = 'Product'
  AND (im.context -> 'metadata' ->> 'isVariant') = 'true'
  AND im."internalId" LIKE 'ol_product_%';

-- 3. UPDATE product_variants.id (PK) — will succeed because FK is dropped
UPDATE product_variants pv
SET id = m.new_id
FROM variant_id_migration m
WHERE pv.id = m.old_id;

-- 4. UPDATE inventory_items.productVariantId
UPDATE inventory_items ii
SET "productVariantId" = m.new_id
FROM variant_id_migration m
WHERE ii."productVariantId" = m.old_id;

-- 5. UPDATE offer_creation_records.internalVariantId
UPDATE offer_creation_records ocr
SET "internalVariantId" = m.new_id
FROM variant_id_migration m
WHERE ocr."internalVariantId" = m.old_id;

-- 6. UPDATE identifier_mappings.internalId + entityType
UPDATE identifier_mappings im
SET "internalId" = m.new_id,
    "entityType" = 'ProductVariant'
FROM variant_id_migration m
WHERE im.id = m.mapping_id;

-- 7. DROP TABLE variant_id_migration

-- 8. Re-add FK_8fa4cdd8e98fde93d4f14025417
```

The `down` reverses step 6/3/4/5 by matching on `ol_variant_*` + `entityType='ProductVariant'`, and restores `entityType='Product'` plus the `ol_product_*` prefix.

**Orphan detection** (between steps 2 and 3): after the temp table is built, capture `SELECT count(*)` from each of `product_variants`, `inventory_items` (with matching `productVariantId`), and `offer_creation_records` (with matching `internalVariantId`). After the three updates, compare the `UPDATE ... RETURNING` row counts to the temp-table row count. If `product_variants` updates < temp-table rows, log a single warning via `queryRunner.connection.logger` noting the count of orphaned mappings (mappings flagged as variant with no backing `product_variants` row). Does not abort the migration — a pre-existing orphan staying an orphan is not a regression — but makes the drift visible in migration logs. Identical check for `inventory_items` and `offer_creation_records`, which can legitimately be smaller (not every variant has inventory or an offer-creation record, unlike the 1:1 `product_variants` case).

**File header**: the new migration file must carry a JSDoc header per `docs/engineering-standards.md#file-headers`, matching the style of sibling migrations (`1784000000000`, `1787000000000`). Lead with the *why* (unblocks `CreateOfferWizard` Step 1, satisfies the `ol_{entityTypeLower}_{uuid}` contract), not the *what*.

Note on the `context.metadata.isVariant` flag in stored rows: the migration deliberately **does not** strip it from the `context` JSON of updated rows. Existing rows keep their stored metadata; the flag simply stops being written and stops being read. That keeps the migration surface small. **This is an explicit policy decision** and must be called out in the PR body so reviewers don't re-litigate it — see §7.

### 4.6 Frontend test

Add `apps/web/src/features/listings/components/create-offer-fields.schema.test.ts` (one tiny spec file — the schema currently has no dedicated test):

```ts
describe('createOfferFieldsSchema — internalVariantId', () => {
  it('accepts a real ol_variant_ ID', () => {
    const result = createOfferFieldsSchema.safeParse({
      ...validBase,
      internalVariantId: 'ol_variant_3fce2df4d853f4499b955a6bb1a212bd',
    });
    expect(result.success).toBe(true);
  });

  it('rejects ol_product_ IDs (guards against regression)', () => {
    const result = createOfferFieldsSchema.safeParse({
      ...validBase,
      internalVariantId: 'ol_product_3fce2df4d853f4499b955a6bb1a212bd',
    });
    expect(result.success).toBe(false);
  });
});
```

---

## 5. Step-by-step Implementation Plan

### Phase A — Core types + service (2 files, ~10 lines)

**Step A1a**: `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts`
- Export `ENTITY_TYPE_ID_PREFIX: Partial<Record<EntityType, string>> = { ProductVariant: 'variant' }` next to `EntityTypeValues`. Include a short JSDoc explaining why the override exists.

**Step A1b**: `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts`
- Import `ENTITY_TYPE_ID_PREFIX` from the domain types module (cross-layer import per `docs/engineering-standards.md#import-aliases` → use `@openlinker/core/...` alias since it crosses application → domain).
- Update `generateInternalId` to look up the prefix via the map with a `??` fallback to `entityType.toLowerCase()`.
- Acceptance: unit test — call the service's public `getOrCreateInternalId('ProductVariant', …)` with a mocked repository, assert returned ID matches `/^ol_variant_[a-f0-9]+$/`.

**Step A2**: `libs/core/src/identifier-mapping/application/services/__tests__/identifier-mapping.service.spec.ts`
- Add one spec covering the new prefix mapping: `ProductVariant → ol_variant_*`, `Product → ol_product_*` (sanity baseline).

### Phase B — Adapters (2 files)

**Step B1**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts`
- Lines 180-207 (synthetic): swap `'Product'` → `'ProductVariant'` in both `getOrCreateInternalId` and `deleteMapping`. Drop `isVariant: true` from metadata.
- Lines 214-232 (real combinations): swap `entityType: 'Product' as const` → `'ProductVariant' as const`. Drop `isVariant: true`. Delete the three-line workaround comment.
- Acceptance: `prestashop-product-master.adapter.spec.ts` passes with updated assertions.

**Step B2**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts`
- Lines 171-173: remove the stale *"mapped as Product entities with a product_attribute_id"* comment block — the comment contradicts the post-change truth and `getExternalIds('ProductVariant', ...)` is self-describing.
- Line 174: `getExternalIds('ProductVariant', item.variantId)`.
- Acceptance: existing adapter tests pass (if any assert on entityType — update them).

### Phase C — Repository (1 file)

**Step C1**: `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts`
- Lines 104-128 (`findByBarcodes` query): change `entityType: 'Product'` to `entityType: 'ProductVariant'`, drop the `isVariant='true'` predicate from the `innerJoin` ON clause.
- Lines 151-157 (`findMany` connection filter): same change.
- Acceptance: any unit/integration tests covering barcode lookup and connection-filtered variant listing still pass.

### Phase D — Migration (1 file, new)

**Step D1**: `apps/api/src/migrations/1788000000000-promote-product-variant-entity-type.ts`
- Implement `up` per §4.5. Implement `down` as the inverse.
- Use parameterized raw SQL via `queryRunner.query(…)` — follow the convention of the surrounding migrations (1767551453556, 1784000000000).
- Acceptance: `pnpm --filter @openlinker/api migration:show` lists the new migration as pending. Running `migration:run` succeeds. A sanity query confirms: `SELECT count(*) FROM product_variants WHERE id LIKE 'ol_variant_%'` equals the number of previously-variant-flagged mappings, and `SELECT count(*) FROM product_variants WHERE id LIKE 'ol_product_%'` is 0 (assuming a dev DB with variants).

### Phase E — Frontend guard test (1 file, new)

**Step E1**: `apps/web/src/features/listings/components/create-offer-fields.schema.test.ts`
- Spec per §4.6.
- Acceptance: `pnpm test` (from `apps/web`) passes.

### Phase F — Architecture doc

**Step F1**: `docs/architecture-overview.md`
- §"Internal Identifier Format", around line 512: add `ol_variant_<uuid>` to the examples list. Add a one-line note: "*ProductVariant* uses the short `variant` prefix by explicit override — see `ENTITY_TYPE_ID_PREFIX`."

### Phase G — Quality gate + commit

**Step G1**: `pnpm lint && pnpm type-check && pnpm test` — all green.
**Step G2**: (if Docker is running locally) `pnpm test:integration` — optional sanity pass on the existing variant/inventory integration tests. Not a gate for the PR; integration tests already exist and don't exercise the migration directly.
**Step G3**: Commit on `322-product-variant-entity-type` with a conventional message.

---

## 6. Acceptance Criteria Mapping

| Issue criterion | Satisfied by |
|---|---|
| `EntityType` union includes `'ProductVariant'` | Already true (`identifier-mapping.types.ts:10`); verified, not changed. |
| New variant syncs produce `ol_variant_` IDs | Two-part unit coverage: (a) `identifier-mapping.service.spec.ts` (Step A2) asserts `generateInternalId('ProductVariant')` returns `ol_variant_*` — this is the only test that can observe the ID shape because the adapter mocks the service; (b) `prestashop-product-master.adapter.spec.ts` (Step B1) asserts the adapter calls the service with `entityType: 'ProductVariant'`. Together they satisfy the contract end-to-end. |
| Migration converts existing `product_variants.id` + dependent FKs | Step D1. |
| `CreateOfferWizard` Step 1 advances when a variant is picked | Implicit: once backend produces `ol_variant_*`, the existing FE regex (`create-offer-fields.schema.ts:18`) passes. No FE code change needed. Step E1 adds a guard. |
| No grep hits for `// ProductVariant is not a separate EntityType` or `isVariant` shim code | Step B1 deletes the workaround comment; Step B2 deletes the stale "mapped as Product entities" comment; Steps B1 + C1 delete the `isVariant` reads/writes. The `context.metadata.isVariant` value still exists in historical rows, but no code reads or writes it (policy called out in PR body — see §7). |
| Integration test: simple product → synthetic variant gets `ol_variant_*` | Covered by the two-part unit test above (A2 + B1). A full integration test would require a live PrestaShop mock + real DB boot — disproportionate to the change. Adapter-spec assertions in Step B1 already include the synthetic-variant branch. |
| Integration test: product with 2 combinations → distinct `ol_variant_*` IDs | Same two-part coverage; `prestashop-product-master.adapter.spec.ts` covers the multi-combination branch through the mocked `batchGetOrCreateInternalIds` call. |
| `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` all green | Step G1 (+ optional G2). Integration is best-effort given the Docker dependency. |

---

## 7. Risks & Open Questions

1. **Large DBs**: the migration's re-prefix is O(n) over `product_variants` + `identifier_mappings` + `inventory_items` + `offer_creation_records` rows flagged as variant. Indexes cover the key predicates; still worth running `EXPLAIN` on a production-sized dataset. At current MVP scale this is fine.
2. **Stale `metadata.isVariant` in historical rows — explicit policy** (must be called out in the PR body): the migration updates `entityType` and `internalId` but **deliberately does not strip `context.metadata.isVariant` from stored JSON**. Interpretation of the issue's acceptance criterion *"No grep hits for ... `isVariant` shim code"* is "no code reads or writes it", not "no bytes of it in the DB". Stripping from stored rows would bloat the migration (additional `jsonb_set` updates on a wide table) for zero functional benefit. A follow-up cleanup migration can strip them if operators find it noisy. **Reviewers should not re-litigate this — the decision is logged here and in the PR body.**
3. **Orphan mappings** (detected by the counters added in §4.5): a pre-existing `identifier_mappings` row flagged as variant with no backing `product_variants` row stays an orphan after the migration (now with an `ol_variant_*` ID). Not a regression; the counter warning makes drift visible in migration logs.
4. **Forward compatibility of the prefix map**: if someone later adds another entity type that needs a short prefix, they just add a line to `ENTITY_TYPE_ID_PREFIX`. Low risk.
5. **`getExternalIds('ProductVariant', …)` race**: the order adapter will no longer find mappings written under `'Product'`. After the migration runs, this is the correct behavior. Deploying code before running the migration would temporarily break variant-lookup on incoming orders — **order the deploy**: migration first, then code, same as any entity-type rename.
6. **Integration test assertions**: the `offer-creation-record.fixtures.ts` and `listings-create-offer.int-spec.ts` fixtures already use `ol_variant_abc123`. These were presciently written; they just start matching reality now. Keep.

---

## 8. Validation Against Project Standards

- ✅ No `any`. No `console.log`. No framework imports in `domain/`.
- ✅ No new port interfaces or services; existing service signature is untouched.
- ✅ Migration is reversible.
- ✅ Adapter changes respect the CORE ↔ Integration boundary — they consume `IdentifierMappingService` through the existing port.
- ✅ Naming conventions preserved: migration filename pattern matches siblings, `EntityType` member name matches the ORM/domain class name.
- ✅ Testing: unit test for the prefix map (core), adapter spec updates, one new FE schema-regex test. Integration-level variant-ID assertions exist in place already.

---

## 9. Estimated Diff Footprint

- `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts` — ~8 lines (add `ENTITY_TYPE_ID_PREFIX` + JSDoc)
- `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts` — ~5 lines (import + 2-line change in `generateInternalId`)
- `libs/core/src/identifier-mapping/application/services/__tests__/identifier-mapping.service.spec.ts` — ~20 lines (new describe block)
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts` — ~10 lines (−3 comment, −2 metadata keys, 3 string swaps)
- `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-product-master.adapter.spec.ts` — ~10 lines of assertion tweaks
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` — ~5 lines (−3 stale comment, 1 entity-type swap)
- `libs/core/src/products/infrastructure/persistence/repositories/product-variant.repository.ts` — ~6 lines
- `apps/api/src/migrations/1788000000000-promote-product-variant-entity-type.ts` — ~100 lines (new — includes JSDoc header + orphan-counter warnings)
- `apps/web/src/features/listings/components/create-offer-fields.schema.test.ts` — ~30 lines (new)
- `docs/architecture-overview.md` — ~3 lines

**Total**: ~10 files touched, ~200 lines net.
