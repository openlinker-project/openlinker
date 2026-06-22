/**
 * InvalidBuyerProfileError
 *
 * Neutral mapping error thrown by the Order -> IssueInvoiceCommand composer when
 * an order cannot yield a valid `BuyerProfile` — no billing/shipping address to
 * derive the buyer from, or no derivable buyer name. Messages cite ONLY
 * `order.id` (never buyer name/address/tax id) to stay PII-clean. No
 * country/document-type vocabulary.
 *
 * @module libs/core/src/invoicing/application/mappers/errors
 */
export class InvalidBuyerProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBuyerProfileError';
  }
}
