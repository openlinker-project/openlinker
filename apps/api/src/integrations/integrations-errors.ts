/**
 * Integrations errors (#3865)
 *
 * Coded HTTP errors shared by the integrations endpoints. Each carries a
 * stable code the frontend picks its copy by (ADR-081); `message` stays the
 * English sentence the endpoint always sent.
 *
 * A 500 has no entry in `codedHttpError`'s class map, so it is built here as
 * Nest's own `InternalServerErrorException` with the coded body.
 *
 * @module apps/api/src/integrations
 */
import { HttpStatus, InternalServerErrorException } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorParams } from '@openlinker/shared/errors';
import { codedErrorBody } from '../common/errors/coded-http.exception';

export function internalServerError(
  code: ApiErrorCode,
  message: string,
  params?: ApiErrorParams
): InternalServerErrorException {
  return new InternalServerErrorException(
    codedErrorBody(HttpStatus.INTERNAL_SERVER_ERROR, code, message, params)
  );
}
