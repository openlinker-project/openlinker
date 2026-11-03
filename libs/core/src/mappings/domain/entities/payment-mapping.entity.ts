/**
 * Payment Mapping Domain Entity
 *
 * Represents a connection-scoped mapping from an Allegro payment provider name
 * to a PrestaShop payment module name. Pure domain entity with no framework deps.
 *
 * Source-keyed: `connectionId` is the SOURCE connection. At order creation the
 * PrestaShop adapter sends the mapped name as the order's payment label (#3474);
 * the payment module itself is not switched.
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
