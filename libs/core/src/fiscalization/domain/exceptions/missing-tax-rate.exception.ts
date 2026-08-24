/**
 * Missing Tax Rate Exception - fiscalization (#2252, ADR-063 § 6)
 *
 * Raised when a sale is handed for fiscal registration with a line that carries
 * no tax rate.
 *
 * **The accepted cost is late registration**, and it is deliberate. The
 * alternative is a receipt carrying a tax letter nobody confirmed - a false
 * document reaching the buyer and the daily report, which cannot be recalled.
 * A late registration can be completed; a wrong one has to be corrected.
 *
 * **THE REVERSAL POINT IS ONE BRANCH.** If holding proves worse in practice
 * than registering with the connection's configured tax letter, the single
 * change is to remove the `assertEveryLineHasATaxRate` call in
 * `FiscalRegistrationService.register`. Nothing else in this context consults
 * the rate. Keep it that way.
 *
 * A sibling of the invoicing exception of the same name rather than a shared
 * one: the two contexts do not import each other, the messages name different
 * remedies, and a fiscal receipt is not an invoice.
 *
 * No buyer data, but not PII-clean (#1985 review): `firstLineName` is
 * `sku ?? name` off the missing line, and a SKU is not always set, so the
 * fallback is a shop-authored product name (e.g. "Printed apron") - free
 * text, not an internal identifier.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */

export class MissingFiscalTaxRateException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly lineCount: number,
    public readonly totalLines: number,
    public readonly firstLineName: string | null
  ) {
    const scope = `${String(lineCount)} of ${String(totalLines)} lines carry no tax rate`;
    super(
      `Order ${orderId} cannot be registered fiscally: ${scope}` +
        (firstLineName ? ` (first: ${firstLineName})` : '') +
        `. Add the rate in the shop's catalogue and re-sync the product. The connection's ` +
        `tax letter is not used to fill the gap - a receipt carrying an unconfirmed rate ` +
        `reaches the buyer and the daily report and cannot be recalled.`
    );
    this.name = 'MissingFiscalTaxRateException';
    Error.captureStackTrace(this, this.constructor);
  }
}
