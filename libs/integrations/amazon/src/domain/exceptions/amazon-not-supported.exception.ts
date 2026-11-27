/**
 * Amazon Not Supported Exception
 *
 * A request this integration does not carry out (a field it does not write, a
 * listing Amazon fulfils itself). Deterministic: the same request is refused
 * the same way, so the retry classifier makes it terminal.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
export class AmazonNotSupportedException extends Error {
  constructor(detail: string) {
    super(`Not supported on Amazon: ${detail}`);
    this.name = 'AmazonNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
