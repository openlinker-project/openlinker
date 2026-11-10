/**
 * OMS errors (#3865)
 *
 * The coded HTTP errors the OMS sourcing-rule and routing dry-run endpoints
 * send. Each carries a stable code and the values the frontend's copy needs
 * (ADR-081); `message` stays the English sentence the endpoint always sent.
 *
 * @module apps/api/src/oms
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import { codedHttpError } from '../common/errors/coded-http.exception';

/** The connection is not the OpenLinker OMS, so it has no rules or router. */
export function connectionNotOms(
  connectionId: string,
  platformType: string,
  message: string
): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'CONNECTION_NOT_OMS', message, {
    connectionId,
    platformType,
  });
}

