/**
 * OfferCreationErrorList
 *
 * Renders the structured `errors` array returned on a failed
 * OfferCreationRecord. Field paths (e.g. `parameters.EAN`) render in
 * monospace so they stand out from the human-readable message.
 *
 * For codes in the Allegro friendly-message allowlist (#448) the primary
 * message text is replaced with operator-actionable copy and the original
 * Allegro `userMessage` is moved into a collapsed `<details>` block —
 * progressive disclosure so the support path stays one click away. Codes
 * outside the allowlist render byte-identically to before.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import type { OfferCreationError } from '../api/listings.types';
import { translateAllegroError } from '../lib/allegro-error-mapping';

interface OfferCreationErrorListProps {
  errors: OfferCreationError[] | null | undefined;
  className?: string;
}

export function OfferCreationErrorList({
  errors,
  className = '',
}: OfferCreationErrorListProps): ReactElement | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const classes = ['offer-creation-errors', className].filter(Boolean).join(' ');

  return (
    <ul className={classes} aria-label="Offer creation errors">
      {errors.map((error, index) => {
        const translation = translateAllegroError(error);
        const primaryMessage = translation?.message ?? error.message;
        return (
          <li
            key={`${error.code}-${error.field ?? 'no-field'}-${index}`}
            className="offer-creation-errors__item"
          >
            {error.field ? (
              <span className="offer-creation-errors__field mono-text">{error.field}</span>
            ) : null}
            <span className="offer-creation-errors__message">{primaryMessage}</span>
            <span className="offer-creation-errors__code mono-text">{error.code}</span>
            {translation ? (
              <details className="offer-creation-errors__raw">
                <summary>Allegro&apos;s original message</summary>
                <span className="offer-creation-errors__raw-body">{error.message}</span>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
