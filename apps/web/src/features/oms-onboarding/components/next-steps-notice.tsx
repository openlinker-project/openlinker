/**
 * Next steps after turning packing on (#3457)
 *
 * Turning packing on hands the fulfilment flow — packing and shipping — to
 * OpenLinker, but two things that flow depends on live on other pages: the
 * automation that buys a label once an order is packed, and Who decides what.
 * Both are LINKS to those pages, so the operator is one click away rather than
 * told the name of a menu.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';

export function NextStepsNotice(): ReactElement {
  return (
    <Alert tone="success" title={COPY.nextSteps.title} data-testid="packing-next-steps">
      <span>{COPY.nextSteps.body}</span>
      <ul className="oms-onboarding__next-steps">
        <li>
          <Link to="/automations" data-testid="link-setup-automations">
            {COPY.nextSteps.automationsLink}
          </Link>{' '}
          <span className="oms-onboarding__next-hint">— {COPY.nextSteps.automationsHint}</span>
        </li>
        <li>
          <Link to="/settings/who-decides" data-testid="link-who-decides">
            {COPY.nextSteps.whoDecidesLink}
          </Link>{' '}
          <span className="oms-onboarding__next-hint">— {COPY.nextSteps.whoDecidesHint}</span>
        </li>
      </ul>
    </Alert>
  );
}
