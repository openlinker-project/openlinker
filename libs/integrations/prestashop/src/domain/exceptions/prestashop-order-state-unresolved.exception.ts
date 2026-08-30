/**
 * PrestaShop Order-State Unresolved Exception
 *
 * Raised when no `ps_order_state` row on the shop stands for a neutral
 * `OrderStatus` OpenLinker needs to write (#2607).
 *
 * PrestaShop order-state ids are shop data, so the target of a status write
 * must be found in the shop's own state catalogue. When nothing matches, the
 * write is refused. The alternative - falling back to a default-install id -
 * is what #2607 removes: it moves a real order into whatever state happens to
 * carry that number, and reports success. An operator can fix this by adding
 * the state to the shop or by mapping the status explicitly on the connection.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopOrderStateUnresolvedException extends Error {
  constructor(
    public readonly olStatus: string,
    public readonly connectionId: string
  ) {
    super(
      `No PrestaShop order state on connection ${connectionId} means "${olStatus}". ` +
        `Add a matching order state in the shop, or map "${olStatus}" to a state id ` +
        `in the connection's order-status mappings. A state added in the shop is picked up ` +
        `when the process next reads the catalogue, so mapping the status takes effect sooner.`
    );
    this.name = 'PrestashopOrderStateUnresolvedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
