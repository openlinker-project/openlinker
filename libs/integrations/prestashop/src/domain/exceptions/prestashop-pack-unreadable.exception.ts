/**
 * PrestaShop Pack Unreadable Exception (#3932)
 *
 * A pack's `product_bundle` held entries the adapter could not parse. Reading the
 * composition as only the entries that parsed would hand core a smaller bundle
 * than the shop sells, and a bundle definition written from it would under-reserve
 * stock, so the read is refused instead. Deterministic for a given product.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopPackUnreadableException extends Error {
  constructor(
    public readonly productId: string,
    public readonly unreadableEntries: number
  ) {
    super(
      `PrestaShop pack ${productId} has ${unreadableEntries} product_bundle entr${unreadableEntries === 1 ? 'y' : 'ies'} ` +
        `that could not be read; refusing to report a partial composition.`
    );
    this.name = 'PrestashopPackUnreadableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
