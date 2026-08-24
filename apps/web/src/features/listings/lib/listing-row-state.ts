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
import type { OfferLifecycle, OfferMapping } from '../api/listings.types';
import {
  problemLine,
  readAccountScopedProblems,
  readOfferScopedProblems,
} from './listing-problems';

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
  /**
   * Muted styling: this line reports a state, not outstanding work (#2231). It
   * exists so the red line always means "someone has to change something" - an
   * offer the seller switched off deliberately says so quietly instead of
   * looking like a failure, and a row whose only problem is shop-level points at
   * the banner that carries it rather than repeating it.
   */
  muted?: boolean;
}

/**
 * What the channel's own stock reading says about a row whose OL side is
 * broken. `unknown` is a first-class answer, not a synonym for zero: on a
 * connection whose offer-status sync has never run (Erli ships its scheduler
 * task opt-in and off) EVERY row lands here, and claiming an offer "should
 * have been paused" on a reading OL never took would be a fabrication.
 */
type ChannelStockSignal = 'selling' | 'paused' | 'unknown';

function channelStockSignal(row: OfferMapping): ChannelStockSignal {
  const quantity = row.commercial?.availableQuantity;
  if (quantity == null) return 'unknown';
  return quantity > 0 ? 'selling' : 'paused';
}

/**
 * The overselling case: a live listing for a product whose master record is
 * gone. `isStale` alone is not enough - the pause normally zeroes the offer, so
 * a non-zero channel quantity is what makes it sellable.
 */
export function isOverselling(row: OfferMapping): boolean {
  return Boolean(row.identity?.isStale) && channelStockSignal(row) === 'selling';
}

/**
 * A mapping whose `internalId` no longer resolves to any variant. Strictly
 * `null`, never `undefined`: the detail endpoint omits the projection entirely,
 * and an absent projection says nothing about whether a variant exists.
 */
export function isUnlinked(row: OfferMapping): boolean {
  return row.identity === null;
}

const STALE_TITLE: Record<ChannelStockSignal, string> = {
  selling:
    'The master product is gone but the channel still reports stock, so this offer can still sell.',
  paused: 'The master product is gone and the channel reports no stock, so the pause took effect.',
  unknown:
    'The master product is gone. No channel quantity has been read, so it is not known whether this offer was paused.',
};

const UNLINKED_TITLE: Record<ChannelStockSignal, string> = {
  selling:
    'No OpenLinker variant is linked to this listing, and the channel still reports stock - neither inventory nor pricing can reach it.',
  paused: 'No OpenLinker variant is linked to this listing. The channel reports no stock.',
  unknown:
    'No OpenLinker variant is linked to this listing, and no channel quantity has been read, so it is not known whether it can still sell.',
};

/**
 * Badges for one row, loudest first. Zero, one or two: a stale row that is also
 * rejected earns both, because suppressing either would hide a fact the
 * operator needs to act on.
 *
 * `activeLifecycle` (#2032 review thread 12.4) suppresses the plain lifecycle
 * badge when it would just restate the selected tab - the tab's own label
 * already says "Ended" for every row on the Ended tab, so repeating it on
 * every row is noise. Compared against `status.lifecycle` (the bucket), never
 * against the badge's own label text: the Unsynced bucket's badge label is
 * "Not synced", not "Unsynced", so a text comparison would silently miss it.
 * The `activating`/`inactivating` transient badges are NOT suppressible -
 * they carry a fact the "Active" tab label alone does not state.
 */
export function listingRowBadges(
  row: OfferMapping,
  activeLifecycle?: OfferLifecycle
): ListingRowBadge[] {
  const badges: ListingRowBadge[] = [];
  const signal = channelStockSignal(row);

  if (row.identity?.isStale) {
    badges.push({
      id: 'stale',
      label: signal === 'selling' ? 'Selling deleted product' : 'Product deleted',
      tone: 'error',
      solid: signal === 'selling',
      title: STALE_TITLE[signal],
    });
  } else if (isUnlinked(row)) {
    // A listing OL can no longer key on is the same money-shaped state as a
    // stale one, and per the delete-then-recreate note it never self-heals.
    badges.push({
      id: 'unlinked',
      label: 'Unlinked',
      tone: 'error',
      solid: signal === 'selling',
      title: UNLINKED_TITLE[signal],
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

  if (status.lifecycle === activeLifecycle) return badges;

  switch (status.lifecycle) {
    case 'Invalid':
      // Named `Invalid`, not `Inactive` (#2032 review thread 9) - Allegro's
      // own INACTIVE already means "not live", and that reading would make
      // an Allegro-literate operator expect most of their deactivated offers
      // on this tab instead of Draft. Not "Rejected" either: the backend
      // derives this bucket from `inactive` PLUS validator messages, which a
      // seller who deactivated the offer himself can also satisfy - the
      // messages are real, the refusal may not be.
      badges.push({
        id: 'lifecycle',
        label: 'Invalid',
        tone: 'error',
        title: 'Not live on the channel, with validator errors outstanding.',
      });
      break;
    case 'Draft':
      // Soft, like Ended and Not synced: solid is the escalation treatment the
      // overselling badge steps up to, and Draft is the least urgent of the
      // three.
      badges.push({
        id: 'lifecycle',
        label: 'Draft',
        tone: 'neutral',
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
 * The one attention line under the identifiers. A broken OL-side link outranks
 * a validator message: a listing that can sell what OL cannot control is the
 * more urgent of the two, and stacking both would push every neighbouring row
 * taller.
 */
export function listingRowAlert(row: OfferMapping): ListingRowAlert | null {
  const quantity = row.commercial?.availableQuantity;

  if (quantity != null && quantity > 0) {
    if (row.identity?.isStale) {
      const text = `Still ${quantity} available on channel - the master product no longer exists`;
      return { text, title: text };
    }
    if (isUnlinked(row)) {
      const text = `Still ${quantity} available on channel - no OpenLinker product is linked to this listing`;
      return { text, title: text };
    }
  }

  // Offer-scoped only: a shop-level problem is reported on every offer of the
  // connection, so it is rendered once above the table (#2231).
  const problems = readOfferScopedProblems(row);
  if (problems.length > 0) {
    const first = problemLine(problems[0]);
    const overflow = problems.length - 1;
    return {
      // One line, always: `.listing-cell__reason` is single-line by design, and
      // a second line would push every neighbouring row taller. The count is
      // what says the first line is not the whole story.
      text: overflow > 0 ? `${first} · +${overflow} more problem${overflow > 1 ? 's' : ''}` : first,
      // The full list, in the channel's own sentences, for the hover.
      title: problems.map((problem) => problem.message).join('\n'),
      muted: false,
    };
  }

  const status = row.channelStatus;
  if (!status) return null;

  // Everything below is muted: the row has nothing outstanding of its own.
  if (readAccountScopedProblems(row).length > 0) {
    return {
      text: 'Blocked by a problem with the shop, not this listing',
      title:
        'The channel reports a problem with the seller account rather than with this listing. See the notice above the table - fixing it there unblocks every listing on this connection.',
      muted: true,
    };
  }

  if (status.publicationStatus === 'inactive') {
    // Draft with nothing to say about why. Said out loud, quietly, so an empty
    // reason slot is never mistaken for "we did not look".
    return {
      text: 'Set to inactive on the channel, no problems reported',
      title:
        'The channel reports this listing as not live and lists no problems with it. Nothing is outstanding on our side.',
      muted: true,
    };
  }

  return null;
}
