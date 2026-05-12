/**
 * OfferCreationErrorList
 *
 * Thin wrapper over the shared `StructuredErrorList` primitive that wires in
 * the Allegro translator (#486, generalised in #607). Kept as a feature-local
 * export so existing call sites and tests in the listings tracker don't need
 * to move. New consumers should import `StructuredErrorList` from
 * `shared/ui/structured-error-list` directly and pass their platform's
 * translator.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { StructuredErrorList } from '../../../shared/ui/structured-error-list';
import { translateAllegroError } from '../../allegro/lib/translate-allegro-error';
import type { OfferCreationError } from '../api/listings.types';

interface OfferCreationErrorListProps {
  errors: OfferCreationError[] | null | undefined;
  className?: string;
}

export function OfferCreationErrorList({
  errors,
  className,
}: OfferCreationErrorListProps): ReactElement | null {
  return (
    <StructuredErrorList
      errors={errors}
      translate={translateAllegroError}
      className={className}
    />
  );
}
