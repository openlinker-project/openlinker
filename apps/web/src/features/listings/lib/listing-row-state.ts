/**
 * Listing row state (#2028)
 *
 * Pure derivations behind the redesigned `/listings` row anatomy: which badges
 * a row earns, and whether it carries an attention line under its identifiers.
 * Kept out of the page so the rules are unit-testable and so the lifecycle-tab
 * work (#2029) can narrow them in one place.
 *
 * The #1965 mockup's rule is that a badge appears only when a row DEPARTS from
 * its tab's nominal state, so the tab itself carries the lifecycle. Until the
 * tabs exist every lifecycle shares one list, so `Active` stands in as nominal
 * and the other four buckets are badged. When #2029 lands, pass the active tab
 * in and suppress the badge whose label the tab already states.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { OfferMapping } from '../api/listings.types';

export interface ListingRowBadge {
  id: string;
  label: string;
  tone: StatusBadgeTone;
  pulse?: boolean;
  solid?: boolean;
  /** Hover copy - carries the nuance the two-word label cannot. */
  title?: string;
}

export interface ListingRowAlert {
  text: string;
  /** Rendered verbatim when it is the marketplace validator speaking. */
  title: string;
}

/**
 * The overselling case: a live listing for a product whose master record is
 * gone. `isStale` alone is not enough - the pause normally zeroes the offer, so
 * a non-zero channel quantity is what makes it sellable.
 */
export function isOverselling(row: OfferMapping): boolean {
  const quantity = row.commercial?.availableQuantity;
  return Boolean(row.identity?.isStale) && quantity != null && quantity > 0;
}

/**
 * Badges for one row, loudest first. Zero, one or two: a stale row that is also
 * rejected earns both, because suppressing either would hide a fact the
 * operator needs to act on.
 */
export function listingRowBadges(row: OfferMapping): ListingRowBadge[] {
  const badges: ListingRowBadge[] = [];

  if (row.identity?.isStale) {
    const overselling = isOverselling(row);
    badges.push({
      id: 'stale',
      label: overselling ? 'Selling deleted product' : 'Product deleted',
      tone: 'error',
      solid: overselling,
      title: overselling
        ? 'The master product is gone but the channel still reports stock, so this offer can still sell.'
        : 'The master product is gone. This offer should have been paused.',
    });
  }

  const status = row.channelStatus;
  if (!status) return badges;

  if (status.publicationStatus === 'activating') {
    badges.push({ id: 'lifecycle', label: 'Activating', tone: 'info', pulse: true });
    return badges;
  }
  if (status.publicationStatus === 'inactivating') {
    badges.push({ id: 'lifecycle', label: 'Deactivating', tone: 'info', pulse: true });
    return badges;
  }

  switch (status.lifecycle) {
    case 'Inactive':
      badges.push({
        id: 'lifecycle',
        label: 'Rejected',
        tone: 'error',
        title: 'The marketplace validator refused this offer.',
      });
      break;
    case 'Draft':
      badges.push({
        id: 'lifecycle',
        label: 'Draft',
        tone: 'neutral',
        solid: true,
        title: 'On the channel but not live.',
      });
      break;
    case 'Ended':
      badges.push({ id: 'lifecycle', label: 'Ended', tone: 'neutral' });
      break;
    case 'Unsynced':
      badges.push({
        id: 'lifecycle',
        label: 'Not synced',
        tone: 'neutral',
        title: 'No channel status has ever been read for this offer.',
      });
      break;
    case 'Active':
      break;
  }

  return badges;
}

/**
 * The one attention line under the identifiers. Staleness outranks a validator
 * message: a listing that can sell a deleted product is the more urgent of the
 * two, and stacking both would push every neighbouring row taller.
 */
export function listingRowAlert(row: OfferMapping): ListingRowAlert | null {
  if (isOverselling(row)) {
    const quantity = row.commercial?.availableQuantity ?? 0;
    const text = `Still ${quantity} available on channel - the master product no longer exists`;
    return { text, title: text };
  }

  const message = row.channelStatus?.validationMessages[0];
  return message ? { text: message, title: message } : null;
}
