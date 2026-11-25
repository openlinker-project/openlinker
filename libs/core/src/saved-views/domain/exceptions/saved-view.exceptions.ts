/**
 * Saved View Domain Exceptions
 *
 * Mapped to HTTP at the controller (core never constructs a NestJS exception):
 * not-found 404, forbidden 403, name-taken and revision-conflict 409,
 * invalid 400.
 *
 * @module libs/core/src/saved-views/domain/exceptions
 */
import type { SavedViewLimitRule } from '../types/saved-view.types';

/** Also raised for ANOTHER user's personal view: its existence is not disclosed. */
export class SavedViewNotFoundError extends Error {
  constructor(public readonly viewId: string) {
    super(`Saved view not found: ${viewId}`);
    this.name = 'SavedViewNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SavedViewForbiddenError extends Error {
  constructor(message = 'Only an administrator may change a shared view') {
    super(message);
    this.name = 'SavedViewForbiddenError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SavedViewNameTakenError extends Error {
  constructor(
    public readonly pageKey: string,
    public readonly name: string
  ) {
    super(`A view named "${name}" already exists on ${pageKey}`);
    this.name = 'SavedViewNameTakenError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SavedViewRevisionConflictError extends Error {
  constructor(
    public readonly viewId: string,
    public readonly expectedRevision: number
  ) {
    super(`Saved view ${viewId} changed since revision ${expectedRevision}`);
    this.name = 'SavedViewRevisionConflictError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidSavedViewError extends Error {
  constructor(
    public readonly field: string,
    message: string,
    public readonly rule: SavedViewLimitRule,
    public readonly limit?: number
  ) {
    super(message);
    this.name = 'InvalidSavedViewError';
    Error.captureStackTrace(this, this.constructor);
  }
}
