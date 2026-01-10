/**
 * Allegro Quantity Command Not Found Error
 *
 * Domain exception thrown when an Allegro quantity command record is not found.
 * This error is thrown by the repository when attempting to update or retrieve
 * a command that doesn't exist.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroQuantityCommandNotFoundException extends Error {
  constructor(commandId: string) {
    super(`Allegro quantity command not found: commandId=${commandId}`);
    this.name = 'AllegroQuantityCommandNotFoundException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}



