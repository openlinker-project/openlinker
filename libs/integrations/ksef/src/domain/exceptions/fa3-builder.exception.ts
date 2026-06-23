/**
 * FA(3) Builder / Mapping Domain Exceptions
 *
 * Domain-level failures raised while mapping a neutral `IssueInvoiceCommand`
 * onto an FA(3) document and serialising it. These are deterministic input
 * faults (an unmapped tax rate, a malformed buyer identifier) — they can never
 * succeed on retry, so the adapter catches them and marks the `InvoiceRecord`
 * `failed` with the message rather than retry-storming (ADR-026: all FA(3)/PL
 * specifics live in this package, never in core).
 *
 * None of these exceptions carry buyer PII or credential material in their
 * message — only the neutral field/path that violated a rule, so they are safe
 * to surface to the host classifier and structured logs.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */

/** Base for every FA(3) build/mapping fault — lets callers catch the family. */
export class Fa3BuildException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Fa3BuildException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Fa3BuildException);
    }
  }
}

/**
 * A neutral `InvoiceLine.taxRate` string had no FA(3) `P_12` mapping. Carries
 * the offending neutral code only (no monetary value, no buyer data).
 */
export class UnmappedTaxRateException extends Fa3BuildException {
  constructor(public readonly neutralTaxRate: string) {
    super(`No FA(3) P_12 mapping for neutral tax rate: "${neutralTaxRate}"`);
    this.name = 'UnmappedTaxRateException';
  }
}

/**
 * A buyer identifier could not be resolved to a valid FA(3) `Podmiot2` choice —
 * malformed NIP, malformed EU-VAT, or a foreign id without a country code.
 * Carries the neutral scheme + a generic reason; never the raw identifier value.
 */
export class InvalidBuyerIdentificationException extends Fa3BuildException {
  constructor(
    public readonly scheme: string,
    public readonly reason: string,
  ) {
    super(`Invalid buyer identification for scheme "${scheme}": ${reason}`);
    this.name = 'InvalidBuyerIdentificationException';
  }
}

/**
 * The command's ISO-4217 currency had no FA(3) `KodWaluty` representation.
 * Carries the offending neutral currency code only.
 */
export class UnsupportedCurrencyException extends Fa3BuildException {
  constructor(public readonly currency: string) {
    super(`No FA(3) KodWaluty mapping for currency: "${currency}"`);
    this.name = 'UnsupportedCurrencyException';
  }
}
