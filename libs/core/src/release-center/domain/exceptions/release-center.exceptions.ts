/**
 * Release Center Domain Exceptions
 *
 * Mapped to HTTP at the controller (409 regression, 422 limit, 400 invalid);
 * core never constructs a NestJS exception.
 *
 * @module libs/core/src/release-center/domain/exceptions
 */
import type { ReleaseItemScope } from '../types/release-center.types';

export class InvalidReleaseVersionError extends Error {
  constructor(public readonly value: string) {
    super(`Not a release version: ${value}`);
    this.name = 'InvalidReleaseVersionError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidReleaseStateError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'InvalidReleaseStateError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** The cursor would move backwards; the caller answers with the current state. */
export class ReleaseVersionRegressionError extends Error {
  constructor(
    public readonly current: string,
    public readonly attempted: string
  ) {
    super(`Release version ${attempted} is older than the stored ${current}`);
    this.name = 'ReleaseVersionRegressionError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ReleaseStateLimitExceededError extends Error {
  constructor(
    public readonly scope: ReleaseItemScope,
    public readonly limit: number
  ) {
    super(`Release item state limit of ${limit} reached for scope ${scope}`);
    this.name = 'ReleaseStateLimitExceededError';
    Error.captureStackTrace(this, this.constructor);
  }
}
