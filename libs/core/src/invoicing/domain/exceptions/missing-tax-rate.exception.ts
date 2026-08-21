/**
 * Missing Tax Rate Exception (#2248, ADR-052 § 6)
 *
 * Raised when issuance is attempted for an order whose lines do not all carry
 * a tax rate.
 *
 * This is the one refusal that also closes the MANUAL paths. Every other
 * sales-document block means "auto-issue did not happen", and issuing by hand
 * past those is a legitimate operator action; this one means "this cannot be
 * issued", because the only way past it is a provider substituting a guessed
 * rate onto a real fiscal document. The remedy is in the shop's catalogue, not
 * in OpenLinker - which is why the message names the product rather than
 * offering an override.
 *
 * PII-clean by construction: it carries the order id, a count and an internal
 * product id. No buyer data, no line names.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
import type { MissingTaxRateFinding } from '../types/order-tax-rate-gate.types';
import { describeMissingTaxRate } from '../types/order-tax-rate-gate.types';

export class MissingTaxRateException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly finding: MissingTaxRateFinding
  ) {
    super(
      `Order ${orderId} cannot be invoiced: ${describeMissingTaxRate(finding)}. ` +
        `Add the rate in the shop's catalogue and re-sync the product; OpenLinker ` +
        `does not substitute one.`
    );
    this.name = 'MissingTaxRateException';
    Error.captureStackTrace(this, this.constructor);
  }
}
