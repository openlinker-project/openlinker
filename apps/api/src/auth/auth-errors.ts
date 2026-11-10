/**
 * Auth errors (#3865)
 *
 * The coded HTTP errors the authentication endpoints and guards send. Each
 * carries a stable code the frontend picks its copy by (ADR-081); `message`
 * stays the English sentence the endpoint always sent.
 *
 * A code here never says more than its message: a login refusal stays one
 * code whichever half of the credentials was wrong, and a registration
 * collision never names the field that collided (#3156).
 *
 * 401 and 429 have no entry in `codedHttpError`'s class map, so they are
 * built here with Nest's own class (401) or the coded fallback (429), keeping
 * the `instanceof UnauthorizedException` checks callers rely on.
 *
 * @module apps/api/src/auth
 */
import { HttpStatus, UnauthorizedException, type HttpException } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorParams } from '@openlinker/shared/errors';
import {
  CodedHttpException,
  codedErrorBody,
  codedHttpError,
} from '../common/errors/coded-http.exception';

export function unauthorized(
  code: ApiErrorCode,
  message: string,
  params?: ApiErrorParams
): UnauthorizedException {
  return new UnauthorizedException(
    codedErrorBody(HttpStatus.UNAUTHORIZED, code, message, params)
  );
}

export function tooManyRequests(code: ApiErrorCode, message: string): HttpException {
  return new CodedHttpException(HttpStatus.TOO_MANY_REQUESTS, code, message);
}

export function insufficientPermissions(): HttpException {
  return codedHttpError(HttpStatus.FORBIDDEN, 'INSUFFICIENT_PERMISSIONS', 'Insufficient permissions');
}
