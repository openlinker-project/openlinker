/**
 * Amazon Listing Update Not Supported Exception
 *
 * Amazon answered a listing patch `INVALID`: it validated the request and
 * wrote nothing. Raised as a `*NotSupported*` error, not as an `AmazonApiError`,
 * because core reads only that shape (and `MasterProductNotFoundError`) as a
 * refusal: any other error from a stock write is recorded as "in doubt" and
 * never retried, which is wrong for a write Amazon positively did not apply
 * (`inventory-correction.service.ts`, #3566). Terminal for the retry
 * classifier, like every `AmazonNotSupportedException`.
 *
 * Carries Amazon's first issue code and message, never the request body.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
import { AmazonNotSupportedException } from './amazon-not-supported.exception';

export class AmazonListingUpdateNotSupportedException extends AmazonNotSupportedException {
  constructor(
    readonly sku: string,
    readonly issueCode: string,
    issueMessage: string,
    readonly requestId?: string,
  ) {
    super(`listing ${sku}`);
    // The parent's "Not supported on Amazon" prefix does not fit: OpenLinker
    // asked, Amazon validated the request and refused it.
    this.message = `Amazon refused the update of listing ${sku} (${issueCode}: ${issueMessage})`;
    this.name = 'AmazonListingUpdateNotSupportedException';
  }
}
