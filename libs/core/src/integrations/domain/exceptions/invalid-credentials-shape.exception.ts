/**
 * InvalidCredentialsShapeException
 *
 * Thrown by `ConnectionCredentialsShapeValidatorPort` implementations when
 * the credentials payload fails shape validation. `ConnectionService`
 * catches this at the API boundary and maps it to `BadRequestException`.
 *
 * Sibling of {@link InvalidConnectionConfigException} — same rationale
 * (plugins don't depend on NestJS exception types for failure paths).
 *
 * The single `message` payload is intentionally simple — credential-shape
 * checks tend to be one-or-two-field assertions ("webserviceApiKey must be
 * a non-empty string"), not multi-field DTO validation. Plugins that grow
 * a multi-field credentials DTO can flatten their errors into the message
 * string or extend this exception locally.
 *
 * Signature asymmetry with `InvalidConnectionConfigException` (which carries
 * `errors: FlatValidationIssue[]`) is intentional and paired with the
 * HTTP-layer mapper in `ConnectionService.validateCredentialsShape`
 * (single-string response body) vs `validateConfigShape` (`{ message,
 * errors }` body). Don't normalize the two without also coordinating the
 * mapper and the FE consumers that read the response body.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class InvalidCredentialsShapeException extends Error {
  constructor(
    public readonly pluginName: string,
    detail: string,
  ) {
    super(`Invalid ${pluginName} credentials: ${detail}`);
    this.name = 'InvalidCredentialsShapeException';
    Error.captureStackTrace(this, this.constructor);
  }
}
