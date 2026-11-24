/**
 * Order next step card (#4286)
 *
 * One strip inside the header card: the most important step as a headline with
 * a primary button that opens the tab where the operator acts, then an "Also"
 * line for the next problem and a "Show all" list for the rest. Presentation
 * only: the steps come from `deriveOrderIssues`, an action only switches tab.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import type { OrderNextStep } from '../lib/order-next-step';
import type { OrderDetailTabId } from '../lib/order-detail-tabs';

export function useOrderStepTitle(): (step: OrderNextStep) => string {
  const copy = useMessages('orders').orderDetailPage.nextStep;
  const plural = usePlural();
  return (step) => {
    switch (step.kind) {
      case 'failed-destinations':
        return plural(Number(step.value ?? 0), copy.failedDestinations);
      case 'on-hold':
        return interpolate(copy.onHold, { reason: String(step.value ?? '') });
      case 'document-blocked':
        return copy.documentBlocked;
      case 'ship-by-overdue':
        return copy.shipByOverdue;
      case 'ready-to-ship':
        return copy.readyToShip;
    }
  };
}

export function OrderNextStepCard({
  steps,
  tabLabels,
  onOpenTab,
  expanded,
  onToggleExpanded,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  steps: readonly OrderNextStep[];
  tabLabels: Readonly<Record<OrderDetailTabId, string>>;
  onOpenTab: (tab: OrderDetailTabId) => void;
}): ReactElement | null {
  const copy = useMessages('orders').orderDetailPage.nextStep;
  const titleOf = useOrderStepTitle();
  const [primary, ...rest] = steps;
  if (!primary) return null;
  return (
    <section
      className={`order-next-step order-next-step--${primary.tone}`}
      aria-label={copy.label}
      data-testid="order-next-step"
      data-kind={primary.kind}
    >
      <div className="order-next-step__row">
        <div className="order-next-step__text">
          <span className="order-next-step__eyebrow">{copy.label}</span>
          <strong className="order-next-step__title">{titleOf(primary)}</strong>
        </div>
        <button
          type="button"
          className="button button--primary button--sm"
          onClick={() => { onOpenTab(primary.tab); }}
        >
          {interpolate(copy.open, { tab: tabLabels[primary.tab] })}
        </button>
      </div>
      {rest.length > 0 ? (
        <div className="order-next-step__also">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>{copy.also}</strong> {titleOf(rest[0])}
          </span>
          <button
            type="button"
            className="linkbtn"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? copy.hideAll : copy.showAll}
          </button>
        </div>
      ) : null}
      {expanded ? (
        <ul className="order-next-step__all">
          {steps.map((step) => (
            <li key={step.kind}>
              <span>{titleOf(step)}</span>
              <button type="button" className="linkbtn" onClick={() => { onOpenTab(step.tab); }}>
                {interpolate(copy.open, { tab: tabLabels[step.tab] })}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
