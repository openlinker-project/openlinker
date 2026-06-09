# ADR-021: Product synchronization with cross-platform category and attribute mapping

- **Status**: Proposed
- **Date**: 2026-06-09
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker currently synchronizes products across platforms but lacks generalized category and attribute mapping. Today:

- **Category mapping** exists only as a one-off implementation: PrestaShop → Allegro via hardcoded logic in the PrestaShop adapter.
- **Attribute mapping** is explicitly deferred — variants are mapped by barcode, but product attributes (color, size, material, etc.) are not transformed.
- **WooCommerce integration** is in-progress and needs category/attribute support without platform-specific code duplication.
- **Offer creation** currently works with raw product data; category and attribute mismatches cause offer-rejection on some platforms (e.g., Allegro requires specific category structure and attribute parameters).

Platforms have fundamentally different data models: PrestaShop uses flat categories + attribute combinations, Allegro uses tree categories + typed parameters (offer-section vs product-section), WooCommerce uses hierarchical categories + global attributes. Mapping between them requires a generalized mechanism — not per-adapter logic.

## Decision

Introduce **port-based cross-platform mapping abstractions**:

1. **CategoryMappingPort** — defines contract for mapping product categories between source and destination platforms
2. **AttributeMappingPort** — defines contract for mapping product attributes (color, size, material, etc.) between platforms
3. **DB-persisted mapping storage** — store mappings in `category_mappings` and `attribute_mappings` tables, indexed by `sourcePlatformType, destinationPlatformType, sourceCategoryId/sourceAttributeKey`
4. **Platform-pair scoping** — a single mapping entry covers all connections of a given platform pair (PrestaShop → Allegro applies to every PrestaShop and Allegro connection)
5. **Integration into ProductSyncService and OfferCreationService** — apply mappings during product pull and offer creation
6. **Fallback behavior** — warn + continue (unmapped categories default to uncategorized; unmapped attributes are omitted) rather than fail-fast

The mappings are **platform-aware but connection-agnostic**: PrestaShop → Allegro mappings apply to all PrestaShop-Allegro connection pairs. Per-connection overrides are deferred.

## Design: Mapping Ports

### CategoryMappingPort

```typescript
export interface CategoryMappingPort {
  /**
   * Map a source platform category ID to destination platform category structure
   */
  mapCategory(input: {
    sourcePlatformType: string;
    destinationPlatformType: string;
    sourceCategoryId: string;
    sourceCategory: ProductCategory;
  }): Promise<MappedCategory>;

  /**
   * Find destination category by barcode (Allegro use case)
   */
  findDestinationCategoryByBarcode(input: {
    sourcePlatformType: string;
    destinationPlatformType: string;
    barcode: string;
  }): Promise<MappedCategory | null>;
}

export interface MappedCategory {
  destinationCategoryId: string;
  destinationCategoryPath?: string; // For hierarchical platforms
  attributes?: Record<string, string>; // Category-required attributes
}
```

### AttributeMappingPort

```typescript
export interface AttributeMappingPort {
  /**
   * Map product attributes from source to destination platform
   */
  mapAttributes(input: {
    sourcePlatformType: string;
    destinationPlatformType: string;
    sourceAttributes: Record<string, string[]>; // source attr key → values
    destinationCategoryId?: string; // Some platforms require category context
  }): Promise<MappedAttributes>;
}

export interface MappedAttributes {
  mappedAttributes: Array<{
    destinationAttributeKey: string;
    destinationAttributeValues: string[];
    section?: 'offer' | 'product'; // Allegro distinction
  }>;
  unmappedSourceKeys: string[]; // Logged for operator awareness
}
```

## Storage Schema

### `category_mappings` table

```sql
CREATE TABLE category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform_type VARCHAR NOT NULL,
  destination_platform_type VARCHAR NOT NULL,
  source_category_id VARCHAR NOT NULL,
  source_category_name VARCHAR,
  destination_category_id VARCHAR,
  destination_category_path VARCHAR, -- hierarchical path for nested categories
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID, -- User ID (future: audit trail)
  notes TEXT, -- Operator notes on why this mapping exists
  
  UNIQUE(source_platform_type, destination_platform_type, source_category_id),
  INDEX(source_platform_type, destination_platform_type)
);
```

### `attribute_mappings` table

```sql
CREATE TABLE attribute_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform_type VARCHAR NOT NULL,
  destination_platform_type VARCHAR NOT NULL,
  source_attribute_key VARCHAR NOT NULL,
  destination_attribute_key VARCHAR NOT NULL,
  destination_section VARCHAR DEFAULT 'offer', -- 'offer' | 'product' for Allegro
  required_for_categories VARCHAR[] DEFAULT '{}', -- If category-dependent
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  notes TEXT,
  
  UNIQUE(source_platform_type, destination_platform_type, source_attribute_key, destination_attribute_key),
  INDEX(source_platform_type, destination_platform_type)
);

CREATE TABLE attribute_value_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_mapping_id UUID NOT NULL REFERENCES attribute_mappings(id) ON DELETE CASCADE,
  source_value VARCHAR NOT NULL,
  destination_value VARCHAR NOT NULL,
  
  UNIQUE(attribute_mapping_id, source_value),
  INDEX(attribute_mapping_id)
);
```

## Integration Points

### 1. Product Sync Service

When `ProductSyncService` pulls a product from the master and propagates it to a destination:

```typescript
async syncProductToConnection(
  masterProductId: string,
  targetConnectionId: string,
  targetPlatformType: string,
): Promise<void> {
  const product = await this.productRepository.findById(masterProductId);
  const sourcePlatformType = product.sourcePlatformType;
  
  // Map categories
  const mappedCategories = await Promise.all(
    product.categories.map(cat =>
      this.categoryMapping.mapCategory({
        sourcePlatformType,
        destinationPlatformType: targetPlatformType,
        sourceCategoryId: cat.id,
        sourceCategory: cat,
      }).catch(() => null) // Unmapped: log warning, continue
    )
  );
  
  // Map attributes
  const sourceAttrs = product.attributes || {};
  const mappedAttrs = await this.attributeMapping.mapAttributes({
    sourcePlatformType,
    destinationPlatformType: targetPlatformType,
    sourceAttributes: sourceAttrs,
  });
  
  // Update product with mapped values
  const syncPayload = {
    ...product,
    categories: mappedCategories.filter(Boolean),
    attributes: mappedAttrs.mappedAttributes,
  };
  
  await this.productMaster.updateProduct(syncPayload);
}
```

### 2. Offer Creation Service

When creating an offer on a destination marketplace, apply mappings:

```typescript
async createOfferFromProduct(
  variantId: string,
  targetConnectionId: string,
): Promise<OfferCreationResult> {
  const variant = await this.variantRepository.findById(variantId);
  const product = await this.productRepository.findById(variant.productId);
  const connection = await this.connectionRepository.findById(targetConnectionId);
  
  // Get master platform type
  const sourcePlatformType = product.sourcePlatformType;
  const destPlatformType = connection.platformType;
  
  // Map product structure
  const mappedCategory = await this.categoryMapping.mapCategory({
    sourcePlatformType,
    destinationPlatformType: destPlatformType,
    sourceCategoryId: product.primaryCategoryId,
    sourceCategory: product.primaryCategory,
  }).catch(() => {
    this.logger.warn(`Category mapping failed for ${product.id}; using uncategorized`);
    return { destinationCategoryId: 'uncategorized' };
  });
  
  const mappedAttrs = await this.attributeMapping.mapAttributes({
    sourcePlatformType,
    destinationPlatformType: destPlatformType,
    sourceAttributes: variant.attributes || {},
    destinationCategoryId: mappedCategory.destinationCategoryId,
  });
  
  // Enrich offer payload with mapped values
  const offerPayload = {
    ...variant,
    categoryId: mappedCategory.destinationCategoryId,
    categoryPath: mappedCategory.destinationCategoryPath,
    attributes: mappedAttrs.mappedAttributes,
  };
  
  return this.offerCreationService.createOffer(offerPayload, connection);
}
```

## Alternatives considered

- **Code-based mappings** (adapters contain hardcoded rules): Rejected — not reusable across connections, harder to audit and update. DB-based allows operators to inspect and override mappings without code changes.

- **Per-connection scoping** (mappings stored per connection pair): Rejected as initial scope — adds complexity. Platform-pair scoping covers the MVP: one PrestaShop → Allegro mapping applies to all PS→Allegro connection pairs. Per-connection overrides are deferred.

- **Fail-fast on unmapped values** (throw error if category/attribute not mapped): Rejected — would block real products that have unmapped categories on edge platforms. Warn + continue with safe defaults enables MVP and degraded functionality, discovered during offer-sync testing.

- **Inline mapping during adapter pull** (adapters apply mappings themselves): Rejected — violates separation of concerns. Adapters translate the external platform format to the neutral domain model; mapping between platforms is an orchestration concern in core services, not adapter responsibility.

## Consequences

**Pros:**
- **Generalized mechanism** — PrestaShop, WooCommerce, Allegro, and future platforms all use the same port contracts; no per-adapter mapping code.
- **Auditable** — operators inspect and manage mappings in the database; changes are versioned and logged.
- **Deferred categorization logic** — categories are mapped structurally (IDs and paths), not semantically. Platform-specific categorization rules (e.g., "this product belongs to Electronics on Allegro") are deferred as a separate templating layer.
- **Attribute flexibility** — per-platform attribute sections (Allegro `offer` vs `product` parameters) are supported via the `section` field.
- **Graceful degradation** — unmapped categories/attributes don't block offers; they degrade to safe defaults and warn.

**Cons / trade-offs:**
- **Manual mapping maintenance** — operators must maintain mappings in the database. No auto-discovery. Mitigated by admin UI for category/attribute mapping management (deferred feature).
- **Initial scope is platform-pair** — per-connection overrides are deferred. Operators can't override a PrestaShop → Allegro category mapping for a single connection pair.
- **No semantic categorization** — mappings are structural (ID → ID). Semantic rules ("this product is Electronics") require a separate templating/classification system (deferred).
- **Attribute value mapping is manual** — no ML/fuzzy matching. "Red" on PrestaShop must be explicitly mapped to "Rot" on Allegro. Covers 80% of cases (most platforms use English or a fixed enum); long-tail cases require operator intervention.

**Future work:**
- **Admin UI** for mapping management (category/attribute browser, bulk import)
- **Per-connection mapping overrides** (allow one Allegro connection to override the platform-pair PrestaShop → Allegro mapping)
- **Auto-categorization** (ML model or rule engine to assign products to destination categories)
- **Attribute value fuzzy matching** (suggest mappings for unmapped attribute values)

## References

- Related PRs: none yet
- Related issues: WooCommerce bidirectional sync, category mapping generalization
- Related ADRs: [ADR-010](./010-variant-keyed-master-inventory.md) (variant-keyed inventory), [ADR-004](./004-identifier-mapping-service.md) (cross-platform identifier resolution)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Products, Listings
