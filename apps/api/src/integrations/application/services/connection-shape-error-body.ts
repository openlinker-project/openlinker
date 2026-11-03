/**
 * Connection shape-error body (#3861)
 *
 * The 400 a plugin's config shape validator produces, in the API error
 * envelope: `code: 'VALIDATION_FAILED'` and one `fields` entry per issue, so
 * the frontend can mark the config field and say what is wrong in the
 * operator's language. `message` and `errors` stay exactly as they were sent
 * before, for existing clients.
 *
 * An issue built by hand by a plugin may carry no constraint key; its field
 * code is then the generic `invalid`.
 *
 * @module apps/api/src/integrations/application/services
 */
import { HttpStatus } from '@nestjs/common';
import type { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import type { ApiErrorField, KnownApiErrorCode } from '@openlinker/shared/errors';

export const VALIDATION_FAILED: KnownApiErrorCode = 'VALIDATION_FAILED';

/** The field code for an issue that names no constraint. */
export const GENERIC_FIELD_CODE = 'invalid';

export function toConfigShapeErrorBody(error: InvalidConnectionConfigException): {
  statusCode: number;
  message: string;
  error: string;
  errors: InvalidConnectionConfigException['errors'];
  code: KnownApiErrorCode;
  fields: ApiErrorField[];
} {
  return {
    statusCode: HttpStatus.BAD_REQUEST,
    message: error.message,
    error: 'Bad Request',
    errors: error.errors,
    code: VALIDATION_FAILED,
    fields: error.errors.map(({ path, code }) => ({ path, code: code ?? GENERIC_FIELD_CODE })),
  };
}
