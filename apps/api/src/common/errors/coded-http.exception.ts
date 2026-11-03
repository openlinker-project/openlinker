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
import { HttpException } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorEnvelope, ApiErrorParams } from '@openlinker/shared/errors';

export class CodedHttpException extends HttpException {
  readonly code: ApiErrorCode;
  readonly params: ApiErrorParams | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, params?: ApiErrorParams) {
    const body: ApiErrorEnvelope = {
      statusCode: status,
      code,
      message,
      ...(params !== undefined ? { params } : {}),
    };
    super(body, status);
    this.code = code;
    this.params = params;
  }
}
