/**
 * OfferCreationErrorList
 *
 * Renders the structured `errors` array returned on a failed
 * OfferCreationRecord. Field paths (e.g. `parameters.EAN`) render in
 * monospace so they stand out from the human-readable message.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import type { OfferCreationError } from '../api/listings.types';

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
      {errors.map((error, index) => (
        <li
          key={`${error.code}-${error.field ?? 'no-field'}-${index}`}
          className="offer-creation-errors__item"
        >
          {error.field ? (
            <span className="offer-creation-errors__field mono-text">{error.field}</span>
          ) : null}
          <span className="offer-creation-errors__message">{error.message}</span>
          <span className="offer-creation-errors__code mono-text">{error.code}</span>
        </li>
      ))}
    </ul>
  );
}
