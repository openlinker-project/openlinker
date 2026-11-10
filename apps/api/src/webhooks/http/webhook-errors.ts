/**
 * Webhook ingress errors (#3865)
 *
 * The coded HTTP errors the inbound webhook endpoint sends. The caller is a
 * marketplace or shop rather than an operator, but the codes still let a
 * delivery log name the refusal without parsing prose.
 *
 * 401 and 413 have no entry in `codedHttpError`'s class map, so they are
 * built here as Nest's own exception classes with the coded body.
 *
 * @module apps/api/src/webhooks/http
 */
import {
  HttpStatus,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiErrorCode, ApiErrorParams } from '@openlinker/shared/errors';
import { codedErrorBody } from '../../common/errors/coded-http.exception';

export function webhookUnauthorized(
  code: ApiErrorCode,
  message: string,
  params?: ApiErrorParams
): UnauthorizedException {
  return new UnauthorizedException(codedErrorBody(HttpStatus.UNAUTHORIZED, code, message, params));
}

export function webhookPayloadTooLarge(
  message: string,
  params: ApiErrorParams
): PayloadTooLargeException {
  return new PayloadTooLargeException(
    codedErrorBody(HttpStatus.PAYLOAD_TOO_LARGE, 'WEBHOOK_PAYLOAD_TOO_LARGE', message, params)
  );
}
