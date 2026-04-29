/**
 * Flatten class-validator ValidationError tree into a flat list of
 * `{ path, message }` entries suitable for surfacing in HTTP error bodies.
 *
 * Walks nested `children` recursively, joining property names with `.`
 * (matching the dot-paths the rest of the codebase uses for adapter
 * preflight errors, e.g. `sellerDefaults.responsibleProducerId`).
 *
 * @module apps/api/src/integrations/application/services/util
 */
import type { ValidationError } from 'class-validator';

export interface FlatValidationIssue {
  path: string;
  message: string;
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
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
