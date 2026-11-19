/**
 * Amazon API Error
 *
 * An SP-API call answered with a non-2xx status. Carries Amazon's own error
 * code (`errors[0].code`, e.g. `InvalidInput`, `Unauthorized`,
 * `QuotaExceeded`) and the request id Amazon support asks for. The message is
 * Amazon's, which never echoes the access token.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
export class AmazonApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string | undefined,
    public readonly detail: string | undefined,
    public readonly requestId: string | undefined,
  ) {
    super(
      `Amazon SP-API responded ${statusCode}` +
        (errorCode ? ` ${errorCode}` : '') +
        (detail ? `: ${detail}` : ''),
    );
    this.name = 'AmazonApiError';
    Error.captureStackTrace(this, this.constructor);
  }
}
