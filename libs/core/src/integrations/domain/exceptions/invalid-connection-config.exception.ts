/**
 * InvalidConnectionConfigException
 *
 * Thrown by `ConnectionConfigShapeValidatorPort` implementations when the
 * config payload fails shape validation. `ConnectionService` catches this
 * at the API boundary and maps it to `BadRequestException` with the
 * carried `pluginName` + `errors` payload so the HTTP layer surfaces
 * actionable per-field error messages.
 *
 * Keeping this in core (not throwing `BadRequestException` directly from
 * the plugin) means plugin packages don't have to import `@nestjs/common`
 * for the failure path — the contract is core-domain.
 *
 * Wire shape of `errors[]` is `{ path, message }[]` — preserved verbatim
 * from the pre-#587 `apps/api/.../util/flatten-validation-errors.ts`.
 *
 * Signature asymmetry with `InvalidCredentialsShapeException` is intentional:
 * config validation runs a DTO graph through `class-validator` and naturally
 * produces a flat list of `{ path, message }` issues, so the exception
 * carries the full list. Credentials validation today is single-message
 * (hand-rolled per plugin) — the sibling exception carries only `message`
 * to mirror the prior wire shape. Don't "normalize" the two without also
 * coordinating the HTTP-layer mapper in `ConnectionService` — they're
 * paired by design.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
import type { FlatValidationIssue } from '../types/validation.types';

export class InvalidConnectionConfigException extends Error {
  constructor(
    public readonly pluginName: string,
    public readonly errors: FlatValidationIssue[],
  ) {
    super(`Invalid ${pluginName} connection config`);
    this.name = 'InvalidConnectionConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
