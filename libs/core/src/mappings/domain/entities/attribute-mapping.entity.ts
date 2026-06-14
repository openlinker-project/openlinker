/**
 * Attribute Mapping Domain Entity
 *
 * Source/destination-neutral mapping from a source product attribute key (e.g.
 * `"Color"` on a PrestaShop/WooCommerce variant) to a destination parameter
 * name (e.g. Allegro `"Kolor"`), used by attribute projection (#1038, ADR-023
 * §4) to populate a listing's category parameters. Scoped by both connection
 * ids; an optional `destinationCategoryId` carries a per-category override on
 * top of the connection-wide default (`null`). Pure domain entity, no framework
 * deps.
 *
 * @module libs/core/src/mappings/domain/entities
 */

import type { AttributeValueMapping } from './attribute-value-mapping.entity';

export class AttributeMapping {
  constructor(
    public readonly id: string,
    public readonly sourceConnectionId: string,
    public readonly destinationConnectionId: string,
    public readonly sourceAttributeKey: string,
    public readonly destinationParameterName: string,
    public readonly destinationCategoryId: string | null,
    /** Per-value translations (e.g. `Red → Czerwony`). Empty when source and
     * destination value vocabularies already agree. */
    public readonly values: AttributeValueMapping[],
  ) {}
}
