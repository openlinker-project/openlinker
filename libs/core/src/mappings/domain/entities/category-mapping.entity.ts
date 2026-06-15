/**
 * Category Mapping Domain Entity
 *
 * Connection-scoped mapping from a source category (on a product master, e.g.
 * PrestaShop) to a destination category (on a marketplace/shop, e.g. Allegro),
 * used to place an offer/listing in the right destination category. Pure domain
 * entity with no framework deps.
 *
 * Neutralised in #1036 (ADR-023 §2): fields are source/destination-neutral and
 * carry both connection ids plus `destinationTaxonomyProvenance` — the
 * owner-taxonomy identifier (e.g. `'allegro'`) a borrowed-taxonomy destination
 * (ERLI) resolves against. `sourceConnectionId` is nullable: historical rows and
 * rows created before source-connection threading lands (record-only, #1036) may
 * not know their source store.
 *
 * @module libs/core/src/mappings/domain/entities
 */

export class CategoryMapping {
  constructor(
    public readonly id: string,
    public readonly sourceConnectionId: string | null,
    public readonly destinationConnectionId: string,
    public readonly sourceCategoryId: string,
    public readonly destinationCategoryId: string,
    public readonly destinationCategoryName: string,
    public readonly destinationCategoryPath: string | null,
    public readonly destinationTaxonomyProvenance: string,
  ) {}
}
