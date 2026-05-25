/**
 * InPost Config Exception
 *
 * Thrown when a connection's config or credentials are invalid or missing
 * required fields (no `apiToken`, no `organizationId`, …). Distinct from
 * `InpostValidationException`, which covers per-shipment/command validation.
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
export class InpostConfigException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'InpostConfigException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InpostConfigException);
    }
  }
}
