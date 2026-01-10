/**
 * Allegro Config Exception
 *
 * Domain exception for Allegro configuration errors. Thrown when connection
 * configuration is invalid or missing required fields.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroConfigException extends Error {
  constructor(message: string, public readonly connectionId?: string) {
    super(message);
    this.name = 'AllegroConfigException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroConfigException);
    }
  }
}


