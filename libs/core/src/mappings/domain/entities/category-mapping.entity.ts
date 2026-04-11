/**
 * Category Mapping Domain Entity
 *
 * Represents a connection-scoped mapping from a PrestaShop category
 * to an Allegro category. Pure domain entity with no framework deps.
 *
 * Note: Unlike other mapping types (StatusMapping, CarrierMapping, PaymentMapping)
 * which map Allegro source values to PrestaShop target values, CategoryMapping
 * maps PrestaShop → Allegro because the use case is "given a PrestaShop product
 * category, which Allegro category should be used for offer creation?"
 *
 * @module libs/core/src/mappings/domain/entities
 */

export class CategoryMapping {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly prestashopCategoryId: string,
    public readonly allegroCategoryId: string,
    public readonly allegroCategoryName: string,
    public readonly allegroCategoryPath: string | null,
  ) {}
}
