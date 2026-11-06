/**
 * Coded validation pipe (#3861)
 *
 * The API's global `ValidationPipe`, with a 400 that names what failed: the
 * envelope's `code: 'VALIDATION_FAILED'` and one `fields` entry per failed
 * constraint (see `toValidationFieldErrors`). Everything Nest already sent is
 * kept - `message` is still the array of English sentences, `error` still
 * `'Bad Request'` - so no existing client breaks.
 *
 * `createValidationPipe()` is the one producer: `main.ts` and the integration
 * harness both register it, so the suite validates requests with the pipe that
 * ships (before this the harness built its own from default options).
 *
 * @module apps/api/src/common/validation
 */
import { BadRequestException, HttpStatus, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { ApiErrorEnvelope, KnownApiErrorCode } from '@openlinker/shared/errors';
import { toValidationFieldErrors } from './validation-field-errors';

const VALIDATION_FAILED: KnownApiErrorCode = 'VALIDATION_FAILED';

export class CodedValidationPipe extends ValidationPipe {
  public override createExceptionFactory(): (errors?: ValidationError[]) => BadRequestException {
    return (errors: ValidationError[] = []): BadRequestException => {
      const body: ApiErrorEnvelope = {
        statusCode: HttpStatus.BAD_REQUEST,
        message: this.flattenValidationErrors(errors),
        error: 'Bad Request',
        code: VALIDATION_FAILED,
        fields: toValidationFieldErrors(errors),
      };
      return new BadRequestException(body);
    };
  }
}

export function createValidationPipe(): CodedValidationPipe {
  return new CodedValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
