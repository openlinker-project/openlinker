/**
 * AlreadyListedChip
 *
 * Soft "already on {destination}" chip (#1837) - informational, never
 * blocking. Shared by the bulk review steps (marketplace + shop) and the
 * offer/product picker modal so the markup and its a11y treatment (the
 * decorative dot is `aria-hidden`) live in one place instead of four
 * hand-rolled copies that could drift.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';

interface AlreadyListedChipProps {
  /** Destination connection name, e.g. "My Allegro" / "My Shop". */
  destinationName: string;
  /** Tooltip/title text. Callers keep their own copy - marketplace vs shop
   *  wording is intentionally different (duplicate offer vs upsert). */
  title: string;
}

export function AlreadyListedChip({ destinationName, title }: AlreadyListedChipProps): ReactElement {
  return (
    <span className="bulk-chip bulk-chip--neutral" title={title}>
      <span className="bulk-chip__dot" aria-hidden="true" />
      already on {destinationName}
    </span>
  );
}
