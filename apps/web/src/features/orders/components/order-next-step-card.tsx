/**
 * Order next step card (#4286)
 *
 * One card above the tabs that says what to look at first and opens the tab
 * where the operator acts. Presentation only: the step comes from
 * `deriveOrderNextStep`, the action only switches tab.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import type { OrderNextStep } from '../lib/order-next-step';
import type { OrderDetailTabId } from '../lib/order-detail-tabs';

export function OrderNextStepCard({
  step,
  tabLabels,
  onOpenTab,
}: {
  step: OrderNextStep;
  tabLabels: Readonly<Record<OrderDetailTabId, string>>;
  onOpenTab: (tab: OrderDetailTabId) => void;
}): ReactElement {
  const copy = useMessages('orders').orderDetailPage.nextStep;
  const plural = usePlural();
  const title =
    step.kind === 'failed-destinations'
      ? plural(Number(step.value ?? 0), copy.failedDestinations)
      : step.kind === 'on-hold'
        ? interpolate(copy.onHold, { reason: String(step.value ?? '') })
        : copy[step.kind === 'document-blocked' ? 'documentBlocked' : step.kind === 'ship-by-overdue' ? 'shipByOverdue' : 'readyToShip'];
  return (
    <section
      className={`order-next-step order-next-step--${step.tone}`}
      aria-label={copy.label}
      data-testid="order-next-step"
      data-kind={step.kind}
    >
      <div className="order-next-step__text">
        <span className="order-next-step__eyebrow">{copy.label}</span>
        <strong className="order-next-step__title">{title}</strong>
      </div>
      <button
        type="button"
        className="button button--secondary button--sm"
        onClick={() => { onOpenTab(step.tab); }}
      >
        {interpolate(copy.open, { tab: tabLabels[step.tab] })}
      </button>
    </section>
  );
}
