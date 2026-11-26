/**
 * Mirakl Inactivity Reason Policy
 *
 * Turns OF21's `inactivity_reasons` into the neutral validation problems the
 * listings screens show (#2231 shape, as Erli does for `buyableProblems`).
 *
 * Reasons that describe the SHOP rather than the offer (no shipping rate set
 * up, shop closed) are `account` scope, so the screens show them once per
 * connection instead of on every offer. A reason this plugin does not know is
 * passed through verbatim as an offer problem, never dropped.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { CreateOfferValidationError, OfferValidationScope } from '@openlinker/core/listings';

interface ReasonCopy {
  readonly summary: string;
  readonly message: string;
  readonly scope: OfferValidationScope;
}

function copyFor(brand: string): Readonly<Record<string, ReasonCopy>> {
  return {
    ZERO_QUANTITY: {
      summary: `Out of stock on ${brand}`,
      message: `${brand} shows no stock for this offer. Check the master stock and the connection's stock buffer.`,
      scope: 'offer',
    },
    NO_MIN_SHIPPING_RATE: {
      summary: `No shipping rate set on ${brand}`,
      message: `${brand} has no shipping rate for this offer's logistic class. Set shipping rates in the ${brand} seller panel.`,
      scope: 'account',
    },
    SHOP_NOT_OPEN: {
      summary: `Shop closed on ${brand}`,
      message: `The shop is not open on ${brand}, so none of its offers can sell. Open it in the ${brand} seller panel.`,
      scope: 'account',
    },
  };
}

export function mapMiraklInactivityReasons(
  reasons: readonly string[] | undefined,
  brand: string
): CreateOfferValidationError[] {
  const copy = copyFor(brand);
  return (reasons ?? [])
    .filter((reason) => reason.trim() !== '')
    .map((reason) => {
      const known = copy[reason];
      return known
        ? { code: reason, ...known }
        : {
            code: reason,
            summary: `Inactive on ${brand}: ${reason}`,
            message: `${brand} reports this offer as inactive (${reason}).`,
            scope: 'offer' as const,
          };
    });
}
