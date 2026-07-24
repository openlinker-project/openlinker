/**
 * Delivery Chip
 *
 * Mapping-aware delivery presentation for the orders list + order detail
 * (#1793, epic #1776). Renders one of four physical outcomes and, on a
 * `default`-resolved shop-fulfilled order, an actionable rider stacked on top
 * (never replacing the outcome):
 *
 * - `DeliveryChip` — the outcome pill plus, in list mode, the compact rider
 *   pill beneath it (outcome + rider stacked).
 * - `DeliveryOutcomeChip` — the outcome pill alone (order-detail Carrier row).
 * - `DeliveryRiderChip` — the compact rider pill (list).
 * - `DeliveryRiderBanner` — the order-detail inline banner: explanation text +
 *   a fix-it button SLOT. The button's navigation is wired later (#1794); here
 *   it is a non-functional placeholder, or a caller-supplied `actionSlot`.
 *
 * Colours reuse the design tokens via `StatusBadge`: green (`success`) =
 * resolved, blue (`info`) = awaiting-label, grey (`neutral`, dashed) = no
 * method / shop-fulfilled, amber (`warning`) = unmapped, semantic conflict
 * orange (`--status-conflict`, via a className override — distinct from the
 * brand accent) = not-connected. Colour is never the only signal — every
 * chip carries its text label + tone dot.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';

import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { OrderDeliveryRider } from '../api/orders.types';
import type { DeliveryOutcome } from '../lib/delivery-outcome';
import type { DeliveryOwner } from '../lib/delivery-owner';
import { ConnectionDot } from './connection-dot';

const OUTCOME_LABEL: Record<DeliveryOutcome, string> = {
  resolved: 'Labelled',
  'awaiting-label': 'Awaiting label',
  'shop-fulfilled': 'Ships',
  'no-method': 'No delivery method',
};

const OUTCOME_TONE: Record<DeliveryOutcome, StatusBadgeTone> = {
  resolved: 'success',
  'awaiting-label': 'info',
  'shop-fulfilled': 'neutral',
  'no-method': 'warning',
};

type ActionableRider = 'unmapped' | 'not-connected' | 'disabled';

const RIDER_LABEL: Record<ActionableRider, string> = {
  unmapped: 'Unmapped',
  'not-connected': 'Not connected',
  disabled: 'Carrier disabled',
};

/**
 * An actionable rider is one that renders a chip/banner (`unmapped` /
 * `not-connected` / `disabled`).
 */
function isActionableRider(
  rider: OrderDeliveryRider | null | undefined,
): rider is OrderDeliveryRider & { rider: ActionableRider } {
  return (
    !!rider &&
    (rider.rider === 'unmapped' ||
      rider.rider === 'not-connected' ||
      rider.rider === 'disabled')
  );
}

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface DeliveryOutcomeChipProps {
  outcome: DeliveryOutcome;
  /**
   * Presentational owner (#1776) — the connection whose `ConnectionDot` renders
   * before the word on resolved / awaiting-label / shop-fulfilled chips. The
   * chip stays presentational: the caller resolves ids to names
   * (`resolveDeliveryOwner`) and passes the result. Ignored for `no-method`
   * (the warning triangle stands alone) and absent → no dot.
   */
  owner?: DeliveryOwner;
  /**
   * Quiet takeover marker (#1776) — on a shop-fulfilled chip where OpenLinker
   * could take over (rider unmapped / not-connected / disabled), draw an accent
   * edge + a trailing caret and extend the accessible name, keeping the list
   * chip button-free. The caller computes this; the chip only renders it.
   */
  switchable?: boolean;
  className?: string;
}

export function DeliveryOutcomeChip({
  outcome,
  owner,
  switchable = false,
  className = '',
}: DeliveryOutcomeChipProps): ReactElement {
  // No-method is an unresolved/attention state, not a physical outcome: mark it
  // with a warning triangle (in place of the tone dot) so it reads as distinct
  // from the shop-fulfilled neutral chip. It ignores the owner badge.
  const noMethod = outcome === 'no-method';
  const showOwner = !noMethod && owner !== undefined;
  return (
    <StatusBadge
      tone={OUTCOME_TONE[outcome]}
      withDot={false}
      compact
      className={cx(
        'delivery-outcome-chip',
        noMethod && 'delivery-outcome-chip--dashed',
        noMethod && 'delivery-outcome-chip--warn',
        switchable && 'delivery-outcome-chip--switchable',
        className,
      )}
    >
      {noMethod ? (
        <svg
          className="delivery-outcome-chip__tri"
          viewBox="0 0 16 16"
          width="11"
          height="11"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M8 1.6 15 14H1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
          <rect x="7.3" y="6" width="1.4" height="4" rx="0.7" fill="currentColor" />
          <rect x="7.3" y="11" width="1.4" height="1.5" rx="0.7" fill="currentColor" />
        </svg>
      ) : null}
      {showOwner ? (
        <ConnectionDot name={owner.name} platformType={owner.platformType} variant={owner.variant} />
      ) : null}
      {OUTCOME_LABEL[outcome]}
      {switchable ? (
        <>
          <span className="delivery-outcome-chip__caret" aria-hidden="true">
            ›
          </span>
          <span className="sr-only"> - OpenLinker can take this over (see order)</span>
        </>
      ) : null}
    </StatusBadge>
  );
}

interface DeliveryRiderChipProps {
  rider: OrderDeliveryRider;
  className?: string;
}

export function DeliveryRiderChip({
  rider,
  className = '',
}: DeliveryRiderChipProps): ReactElement | null {
  if (!isActionableRider(rider)) {
    return null;
  }
  return (
    <StatusBadge
      tone="warning"
      withDot
      compact
      className={cx(
        'delivery-rider-chip',
        rider.rider === 'not-connected' && 'delivery-rider-chip--not-connected',
        rider.rider === 'disabled' && 'delivery-rider-chip--not-connected',
        className,
      )}
    >
      {RIDER_LABEL[rider.rider]}
    </StatusBadge>
  );
}

interface DeliveryChipProps {
  outcome: DeliveryOutcome;
  /** Rider stacked beneath the outcome (list surface). `none`/absent renders nothing. */
  rider?: OrderDeliveryRider | null;
  className?: string;
}

export function DeliveryChip({
  outcome,
  rider,
  className = '',
}: DeliveryChipProps): ReactElement {
  return (
    <span className={cx('delivery-chip', className)}>
      <DeliveryOutcomeChip outcome={outcome} />
      {isActionableRider(rider) ? <DeliveryRiderChip rider={rider} /> : null}
    </span>
  );
}

// Banner copy branches on whether the heuristic could name the candidate
// carrier (`carrier` is `null` when it couldn't). The `disabled` rider must
// always render a usable sentence - never "the a carrier connection" - so it
// switches structure on carrier presence rather than leaning on a fallback word.
const RIDER_BANNER_TEXT: Record<ActionableRider, (carrier: string | null) => string> = {
  unmapped: (carrier) =>
    `This delivery method isn't mapped to a carrier. Map it to ${carrier ?? 'a carrier'} so OpenLinker generates the label.`,
  'not-connected': (carrier) =>
    `OpenLinker supports ${carrier ?? 'a carrier'}, but no ${carrier ?? 'carrier'} connection is set up. Connect one to fulfil this delivery.`,
  disabled: (carrier) =>
    carrier
      ? `This delivery method routes to ${carrier}, but the ${carrier} connection is disabled. Enable it so OpenLinker can generate the label.`
      : 'This delivery method routes to a disabled carrier connection. Enable it so OpenLinker can generate the label.',
};

const RIDER_ACTION_LABEL: Record<ActionableRider, (carrier: string | null) => string> = {
  unmapped: () => 'Add mapping',
  'not-connected': (carrier) => (carrier ? `Connect ${carrier}` : 'Connect'),
  disabled: (carrier) => (carrier ? `Enable ${carrier}` : 'Enable'),
};

interface DeliveryRiderBannerProps {
  rider: OrderDeliveryRider;
  /**
   * Fix-it action. The navigation is wired in #1794 — when omitted, a
   * non-functional placeholder button renders in its place (a slot).
   */
  actionSlot?: ReactNode;
  className?: string;
}

export function DeliveryRiderBanner({
  rider,
  actionSlot,
  className = '',
}: DeliveryRiderBannerProps): ReactElement | null {
  if (!isActionableRider(rider)) {
    return null;
  }
  const carrier = rider.candidateCarrier?.displayName ?? null;
  return (
    <div
      className={cx(
        'delivery-rider-banner',
        (rider.rider === 'not-connected' || rider.rider === 'disabled') &&
          'delivery-rider-banner--not-connected',
        className,
      )}
      role="note"
    >
      <p className="delivery-rider-banner__text">{RIDER_BANNER_TEXT[rider.rider](carrier)}</p>
      <div className="delivery-rider-banner__action">
        {actionSlot ?? (
          <button
            type="button"
            className="delivery-rider-banner__button"
            disabled
            aria-disabled="true"
            title="Coming soon"
          >
            {RIDER_ACTION_LABEL[rider.rider](carrier)}
          </button>
        )}
      </div>
    </div>
  );
}
