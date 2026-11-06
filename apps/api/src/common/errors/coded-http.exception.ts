/**
 * CodedHttpException
 *
 * An HTTP error that names its own stable `code` and the `params` the
 * frontend's copy needs (#3860). Throw it instead of a bare `HttpException`
 * when an endpoint refuses for a reason an operator should be told about; the
 * frontend picks the sentence by `code` (ADR-081), and `message` stays English
 * for developers and logs.
 *
 * Lives in the API rather than next to `ApiErrorEnvelope` in `libs/shared`
 * because it extends Nest's `HttpException`, and `@openlinker/shared/errors`
 * is framework-free (plugins import it). Only the API throws HTTP errors.
 *
 * @module apps/api/src/common/errors
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ApiErrorCode, ApiErrorEnvelope, ApiErrorParams } from '@openlinker/shared/errors';

/**
 * Further body fields kept for clients that already read them (`error`,
 * `retryable`, `issuingConnectionId` ...) or an optional envelope field such as
 * `providerMessage`. They can never replace `statusCode`, `code`, `message` or
 * `params` (#3864).
 */
export type CodedHttpExceptionExtras = Readonly<Record<string, unknown>>;

/** The envelope body every coded error sends. Extras first, so they cannot override it. */
export function codedErrorBody(
  status: number,
  code: ApiErrorCode,
  message: string,
  params?: ApiErrorParams,
  extras?: CodedHttpExceptionExtras
): ApiErrorEnvelope & Record<string, unknown> {
  const body: ApiErrorEnvelope & Record<string, unknown> = {
    ...(extras ?? {}),
    statusCode: status,
    code,
    message,
  };
  if (params !== undefined) body.params = params;
  else delete body.params;
  return body;
}

export class CodedHttpException extends HttpException {
  readonly code: ApiErrorCode;
  readonly params: ApiErrorParams | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    params?: ApiErrorParams,
    extras?: CodedHttpExceptionExtras
  ) {
    super(codedErrorBody(status, code, message, params, extras), status);
    this.code = code;
    this.params = params;
  }
}

const NEST_EXCEPTION_BY_STATUS: Readonly<
  Record<number, new (body: Record<string, unknown>) => HttpException>
> = {
  400: BadRequestException,
  403: ForbiddenException,
  404: NotFoundException,
  409: ConflictException,
  422: UnprocessableEntityException,
  501: NotImplementedException,
  502: BadGatewayException,
  503: ServiceUnavailableException,
};

/**
 * A coded error as Nest's own exception for the status (`BadRequestException`
 * for 400 ...), with the coded envelope as its body (#3864). Converting an
 * existing endpoint keeps the class its callers and tests already tell errors
 * apart by; only the body gains a code. A status with no Nest class falls back
 * to `CodedHttpException`.
 */
export function codedHttpError(
  status: number,
  code: ApiErrorCode,
  message: string,
  params?: ApiErrorParams,
  extras?: CodedHttpExceptionExtras
): HttpException {
  const NestException = NEST_EXCEPTION_BY_STATUS[status];
  if (NestException === undefined) {
    return new CodedHttpException(status, code, message, params, extras);
  }
  return new NestException(codedErrorBody(status, code, message, params, extras));
}
