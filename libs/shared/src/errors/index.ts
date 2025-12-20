/**
 * Custom Error Classes
 *
 * Domain-specific error classes for handling application errors with
 * proper error types and messages. Provides base DomainError class and
 * specialized error types for common scenarios (NotFound, Validation, Conflict).
 *
 * @module libs/shared/src/errors
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} not found: ${id}` : `${resource} not found`);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(`Validation error: ${message}`);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(`Conflict: ${message}`);
  }
}

