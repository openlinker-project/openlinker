/**
 * Payment Mapping Domain Entity
 *
 * Represents a connection-scoped mapping from an Allegro payment provider name
 * to a PrestaShop payment module name. Pure domain entity with no framework deps.
 *
 * @module libs/core/src/mappings/domain/entities
 */

export class PaymentMapping {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly allegroPaymentProvider: string,
    public readonly prestashopPaymentModule: string,
  ) {}
}
