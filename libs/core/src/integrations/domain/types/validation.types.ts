/**
 * Shared validation types (#586 / #587)
 *
 * The flat error-list shape lives in the domain layer because it forms part
 * of `InvalidConnectionConfigException`'s public contract — every plugin
 * that throws the exception emits this shape, and `ConnectionService` maps
 * it unchanged onto a `BadRequestException` response body. `ValidationErrorLike`
 * lives here too so the `flattenValidationErrors` utility (application
 * layer) can stay structurally compatible with `class-validator`'s
 * `ValidationError` without forcing core to depend on `class-validator`
 * at runtime.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Minimal structural shape matched by `class-validator`'s `ValidationError`.
 * Listing only the fields `flattenValidationErrors` reads.
 */
export interface ValidationErrorLike {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorLike[];
}

/**
 * Flat, framework-neutral validation issue. The shape carried by
 * `InvalidConnectionConfigException.errors` and the HTTP 400 response body.
 */
export interface FlatValidationIssue {
  path: string;
  message: string;
  /**
   * The failed constraint's key (`isNotEmpty`, `min` ...), when the issue came
   * from class-validator through `flattenValidationErrors`. Optional: a
   * validator that builds its issues by hand may omit it. The API forwards it
   * as the field's code so the frontend can say what is wrong in the
   * operator's language (#3861).
   */
  code?: string;
}
