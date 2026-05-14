/**
 * flattenValidationErrors — utility for translating class-validator's
 * recursive `ValidationError[]` tree into a flat `{ path, message }` list
 * suitable for an HTTP 400 body.
 *
 * Typed against a structural `ValidationErrorLike` shape rather than
 * `class-validator`'s concrete `ValidationError` class — keeps `libs/core`
 * free of a runtime dependency on `class-validator` while remaining
 * compatible with both (a) plugin packages that DO use class-validator
 * (their `ValidationError` structurally satisfies `ValidationErrorLike`)
 * and (b) plugins that hand-roll their own shape check and want to
 * produce the same wire shape.
 *
 * Wire shape (`{ path, message }[]`) is preserved verbatim from the
 * pre-#587 `apps/api/.../util/flatten-validation-errors.ts` that this
 * replaces — no FE / consumer change.
 *
 * Lives in core (not the API package) so every plugin can produce the
 * same flat-error format via `InvalidConnectionConfigException.errors`,
 * and the API boundary maps it unchanged into `BadRequestException`'s
 * response body.
 *
 * @module libs/core/src/integrations/application/util
 */

// The structural `ValidationErrorLike` + `FlatValidationIssue` types live
// in the domain layer (they form part of `InvalidConnectionConfigException`'s
// contract). Imported here for the function signatures, then re-exported so
// consumers that only need the utility don't have to reach into `domain/types/`.
import type { ValidationErrorLike, FlatValidationIssue } from '../../domain/types/validation.types';
export type { ValidationErrorLike, FlatValidationIssue } from '../../domain/types/validation.types';

/**
 * Walk a `ValidationError` tree depth-first, joining nested property names
 * with `.` so deeply-nested failures surface with full paths (e.g.
 * `sellerDefaults.location.postcode`).
 */
export function flattenValidationErrors(
  errors: ValidationErrorLike[],
  parentPath = ''
): FlatValidationIssue[] {
  const out: FlatValidationIssue[] = [];

  for (const err of errors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;

    if (err.constraints) {
      for (const message of Object.values(err.constraints)) {
        out.push({ path, message });
      }
    }

    if (err.children && err.children.length > 0) {
      out.push(...flattenValidationErrors(err.children, path));
    }
  }

  return out;
}
