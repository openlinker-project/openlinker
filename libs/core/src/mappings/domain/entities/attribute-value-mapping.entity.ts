/**
 * Attribute Value Mapping Domain Entity
 *
 * A single source-value → destination-value translation belonging to an
 * {@link AttributeMapping} (e.g. `Red → Czerwony`). Pure domain entity, no
 * framework deps (#1038, ADR-023 §4).
 *
 * @module libs/core/src/mappings/domain/entities
 */

export class AttributeValueMapping {
  constructor(
    public readonly id: string,
    public readonly attributeMappingId: string,
    public readonly sourceValue: string,
    public readonly destinationValue: string,
  ) {}
}
