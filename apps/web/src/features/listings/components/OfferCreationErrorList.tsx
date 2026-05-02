/**
 * OfferCreationErrorList
 *
 * Thin wrapper over the shared `AllegroErrorList` primitive (#486). Kept as
 * a feature-local export so existing call sites and tests in the listings
 * tracker don't need to move. New consumers should import `AllegroErrorList`
 * from `shared/ui/allegro-error-list` directly.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { AllegroErrorList } from '../../../shared/ui/allegro-error-list';
import type { OfferCreationError } from '../api/listings.types';

interface OfferCreationErrorListProps {
  errors: OfferCreationError[] | null | undefined;
  className?: string;
}

export function OfferCreationErrorList({
  errors,
  className,
}: OfferCreationErrorListProps): ReactElement | null {
  return <AllegroErrorList errors={errors} className={className} />;
}
