/**
 * Order Buyer Tax ID Value (#3180)
 *
 * Renders `OrderRecord.buyerTaxId` (#2599) as one of THREE distinct
 * renderings, each carrying its own `data-testid` — never one hook with
 * varying text. "Has none" and "we don't know" decide different fiscal
 * documents (ADR-041/ADR-063), so collapsing them into a single badge would
 * erase the exact distinction the routing rules stand on.
 *
 * The switch is on presence-then-nullness, matching the wire contract:
 * `undefined` (key absent) = not asserted, `null` = asserted-none, a string =
 * present. Never a truthiness test — `''` is not a reachable value here (the
 * backend already decoded the column), but a bare `!value` would still read
 * the wrong way if it ever were.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { useMessages } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';

export interface OrderBuyerTaxIdValueProps {
  /** `OrderRecord.buyerTaxId` verbatim — see the module doc for the three states. */
  buyerTaxId: string | null | undefined;
}

/*
 * The "not asserted" rendering carries a real (keyboard-reachable) tooltip
 * rather than a native `title` attribute - the acceptance criterion is that the
 * PII-mode caveat is visible to an operator, not only in logs or on
 * hover-if-you-happen-to. It explains the one case an operator cannot otherwise
 * tell apart from "the source never asked": a deployment running with
 * `OL_STORE_PII=false` persists nothing here, so every order on it reads exactly
 * like an order the source said nothing about. It never asserts which of the two
 * THIS order is - that would be a deployment-wide claim a single row cannot
 * observe (the `customers-list-page` `NAMELESS_LABEL` precedent). The second
 * sentence is the operator-actionable half: the tax id a simplified invoice is
 * issued ON is never there, so that document type is unreachable for the whole
 * deployment - stated as a conditional, so it still asserts nothing about THIS
 * order.
 */

export function OrderBuyerTaxIdValue({ buyerTaxId }: OrderBuyerTaxIdValueProps): ReactElement {
  const copy = useMessages('orders').buyerTaxId;
  if (buyerTaxId === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="order-buyer-tax-id-unknown"
            className="text-muted"
            tabIndex={0}
          >
            {copy.unknown}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {copy.unknownExplanation} {copy.unknownPiiExplanation}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (buyerTaxId === null) {
    return (
      <span data-testid="order-buyer-tax-id-none">
        <StatusBadge tone="neutral">{copy.none}</StatusBadge>
      </span>
    );
  }
  // Shown exactly as the source gave it — no reformatting, no country prefix.
  // OpenLinker is not the authority on what a valid tax id looks like in any
  // market; the source is.
  return (
    <span data-testid="order-buyer-tax-id" className="mono-text">
      {buyerTaxId}
    </span>
  );
}
