/**
 * First order panel (#3457)
 *
 * Right after turning packing on: waits for the first order that reaches the
 * pack bench, then says it arrived.
 *
 * "Arrived" means the newest Fulfilment task was created at or after the
 * moment this page turned packing on — so a task routed before an earlier
 * stop and restart does not read as "your first order".
 *
 * The stock line is a statement of what happens, not an observation: the
 * browser cannot see the product master's stock move for one order.
 *
 * States (mockup vocabulary): `waiting-first-order`, `first-order-arrived`.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { formatRelativeTime } from '../../../shared/format/format-relative-time';
import { Button } from '../../../shared/ui/button';
import type { FulfillmentTask } from '../../fulfillment';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';

export interface FirstOrderPanelProps {
  readonly arrivedTask: FulfillmentTask | null;
  readonly masterNames: string;
  readonly onGoToStatus: () => void;
}

export function FirstOrderPanel({ arrivedTask, masterNames, onGoToStatus }: FirstOrderPanelProps): ReactElement {
  return (
    <section className="panel oms-onboarding__panel" data-testid="first-order-panel">
      <h2 className="oms-onboarding__panel-title">{COPY.status.firstOrderTitle}</h2>
      <div className="oms-onboarding__first-order" aria-live="polite">
        {arrivedTask === null ? (
          <div className="oms-onboarding__event">
            <span className="oms-onboarding__spinner" aria-hidden="true" />
            <span>
              <strong>{COPY.status.waitingTitle}</strong>
              <span className="oms-onboarding__check-detail">{COPY.status.waitingBody}</span>
            </span>
          </div>
        ) : (
          <>
            <div className="oms-onboarding__event">
              <span className="oms-onboarding__tick oms-onboarding__tick--ok" aria-hidden="true">
                ✓
              </span>
              <span>
                <strong>{COPY.status.arrivedTitle(arrivedTask.orderReference ?? arrivedTask.orderId)}</strong>
                <span className="oms-onboarding__check-detail">
                  {COPY.status.arrivedMeta(arrivedTask.lines.length, formatRelativeTime(arrivedTask.createdAt))}
                </span>
              </span>
            </div>
            <div className="oms-onboarding__event">
              <span className="oms-onboarding__tick oms-onboarding__tick--ok" aria-hidden="true">
                ✓
              </span>
              <span>{COPY.status.arrivedStock(masterNames)}</span>
            </div>
            <div className="oms-onboarding__actions">
              <Link className="button button--primary" to="/fulfillment" data-testid="link-open-fulfilment">
                {COPY.status.openFulfilment}
              </Link>
              <Link className="button button--secondary" to="/bench" data-testid="link-open-pack-bench">
                {COPY.status.openBench}
              </Link>
              <Button type="button" tone="ghost" data-testid="btn-go-to-status" onClick={onGoToStatus}>
                {COPY.status.goToStatus}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
