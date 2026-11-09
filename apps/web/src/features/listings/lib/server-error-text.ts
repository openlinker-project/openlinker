/**
 * Server Error Text
 *
 * Puts a server error message behind a translated prefix ("The server said:
 * ...") so it is never shown to an operator bare, and falls back to
 * OpenLinker's own copy when the server sent nothing usable.
 *
 * @module features/listings/lib
 */
import { interpolate } from '../../../shared/i18n';

export function serverErrorText(
  template: string,
  message: string | undefined,
  fallback: string
): string {
  return message ? interpolate(template, { message }) : fallback;
}
