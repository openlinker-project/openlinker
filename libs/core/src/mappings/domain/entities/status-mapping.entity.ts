/**
 * Status Mapping Domain Entity
 *
 * Represents a connection-scoped mapping from an Allegro order status
 * to a PrestaShop order status ID. Pure domain entity with no framework deps.
 *
 * @module libs/core/src/mappings/domain/entities
 */

export class StatusMapping {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly allegroStatus: string,
    public readonly prestashopStatusId: string,
  ) {}
}
