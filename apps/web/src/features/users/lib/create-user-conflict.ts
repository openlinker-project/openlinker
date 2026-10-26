/**
 * Create-user conflict (#3456 / #3457)
 *
 * `POST /users` answers 409 `{ field, message }` naming the colliding field
 * (`username` or `email`) and never its value. A form maps the field onto its
 * own input rather than showing a generic banner.
 *
 * @module features/users/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type { CreateUserConflictField } from '../api/users.types';

/** The field a create-user 409 names, or `null` if `error` is not that 409. */
export function readCreateUserConflictField(error: unknown): CreateUserConflictField | null {
  if (!(error instanceof ApiError) || !error.isConflict()) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const field = (details as { field?: unknown }).field;
  return field === 'username' || field === 'email' ? field : null;
}
