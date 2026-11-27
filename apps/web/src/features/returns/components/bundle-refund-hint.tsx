/**
 * Bundle Refund Hint (#3933)
 *
 * One line beside the refund amount: "According to the Allegro formula: X. Use".
 * The formula is what was paid for the set minus the full standalone price of
 * what the buyer keeps, never below zero.
 *
 * **A suggestion, never a default.** The refund field stays empty and editable;
 * the figure reaches it only when the operator presses Use. The calculation is
 * one click away so the number can be checked rather than trusted, and when it
 * cannot be computed (a kept component has no price of its own) the line says so
 * instead of showing a figure built on a guess. Rendered only when a bundle came
 * back in parts: a whole set has nothing for the formula to say.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useBundleRefundHintQuery } from '../hooks/use-bundle-refund-hint-query';

interface BundleRefundHintProps {
  returnId: string;
  currency: string | null;
  /** Puts the figure in the refund field. Called ONLY on the operator's click. */
  onUse: (amount: string) => void;
}

export function BundleRefundHint({
  returnId,
  currency,
  onUse,
}: BundleRefundHintProps): ReactElement | null {
  const copy = useMessages('bundle-returns').hint;
  const format = useFormat();
  const hint = useBundleRefundHintQuery(returnId, true);

  if (hint.data === undefined || !hint.data.applicable) {
    return null;
  }
  const data = hint.data;
  const money = (amount: number): string => format.money(amount, currency ?? undefined);

  if (data.hintGross === null) {
    return (
      <p className="text-muted" data-testid="return-component-allegro-unavailable">
        {copy.unavailable}
      </p>
    );
  }

  return (
    <div data-testid="return-component-allegro-hint">
      <p>
        <span data-testid="return-component-allegro-amount">
          {interpolate(copy.label, { amount: money(data.hintGross) })}
        </span>{' '}
        <Button
          data-testid="return-component-allegro-use"
          onClick={() => onUse(data.hintGross === null ? '' : data.hintGross.toFixed(2))}
          tone="secondary"
          type="button"
        >
          {copy.use}
        </Button>
      </p>
      <p className="text-muted">{copy.notApplied}</p>
      <details data-testid="return-component-allegro-calc">
        <summary>{copy.calcTitle}</summary>
        {data.paidForSetGross !== null ? (
          <p>{interpolate(copy.calcPaid, { amount: money(data.paidForSetGross) })}</p>
        ) : null}
        {data.keptStandaloneGross !== null ? (
          <p>{interpolate(copy.calcKept, { amount: money(data.keptStandaloneGross) })}</p>
        ) : null}
        <p className="text-muted">{copy.calcResult}</p>
      </details>
    </div>
  );
}
