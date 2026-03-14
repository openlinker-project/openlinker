/**
 * Duplicate Allegro Quantity Command Error
 *
 * Domain exception thrown when attempting to create an Allegro quantity command
 * record that already exists. This error is thrown by the repository when a unique
 * constraint violation occurs, allowing the service to handle concurrency
 * cases appropriately.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class DuplicateAllegroQuantityCommandError extends Error {
  constructor(commandId: string) {
    super(`Allegro quantity command record already exists for commandId: ${commandId}`);
    this.name = 'DuplicateAllegroQuantityCommandError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}


