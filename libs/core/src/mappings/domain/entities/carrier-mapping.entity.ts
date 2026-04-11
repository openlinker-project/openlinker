/**
 * Carrier Mapping Domain Entity
 *
 * Represents a connection-scoped mapping from an Allegro delivery method ID
 * to a PrestaShop carrier ID. Pure domain entity with no framework deps.
 *
 * @module libs/core/src/mappings/domain/entities
 */

export class CarrierMapping {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly allegroDeliveryMethodId: string,
    public readonly prestashopCarrierId: string,
  ) {}
}
