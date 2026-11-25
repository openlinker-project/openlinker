/**
 * Release Center Exception Filter
 *
 * Maps release-center refusals to accurate statuses: a limit or an unknown
 * connection id is well-formed input against current data (422), a rejected
 * version regression is a state conflict (409), and malformed input that got
 * past the DTO is 400. Registered globally; mirrored by the integration
 * harness through `buildGlobalExceptionFilters`.
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  InvalidReleaseStateError,
  InvalidReleaseVersionError,
  ReleaseStateLimitExceededError,
  ReleaseVersionRegressionError,
} from '@openlinker/core/release-center';
import { UnknownReleaseConnectionError } from '../../release-center/release-center.errors';

type ReleaseCenterRefusal =
  | InvalidReleaseStateError
  | InvalidReleaseVersionError
  | ReleaseStateLimitExceededError
  | ReleaseVersionRegressionError
  | UnknownReleaseConnectionError;

@Catch(
  InvalidReleaseStateError,
  InvalidReleaseVersionError,
  ReleaseStateLimitExceededError,
  ReleaseVersionRegressionError,
  UnknownReleaseConnectionError
)
export class ReleaseCenterExceptionFilter implements ExceptionFilter {
  catch(exception: ReleaseCenterRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof ReleaseVersionRegressionError
        ? HttpStatus.CONFLICT
        : exception instanceof ReleaseStateLimitExceededError ||
            exception instanceof UnknownReleaseConnectionError
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : HttpStatus.BAD_REQUEST;
    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
    });
  }
}
