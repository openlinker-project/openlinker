/**
 * Automation run log — placeholder (#2364)
 *
 * ## Owned by W2-48, not by #2364
 *
 * #2364's acceptance criteria require a `Run log` action in the automations
 * header opening `/automations/activity`. The combined feed behind it is
 * W2-48's, and the shipped API has no route that could serve one: firings are
 * read per rule (`GET /automations/:id/runs`) and there is no cross-rule
 * endpoint.
 *
 * So the route is registered with this page rather than left unregistered. A
 * header action pointing at an unregistered path clicks through to a blank
 * screen — the exact hazard `returns.route.tsx` records when it explains why
 * `rowHref` was held back until the detail route existed.
 *
 * **Replace this body when W2-48 lands. Do not delete the route** — the header
 * action depends on it.
 *
 * @module apps/web/src/pages/automations
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { EmptyState } from '../../shared/ui/feedback-state';
import { AUTOMATION_ACTIVITY_COPY } from '../../features/automation';

export function AutomationActivityPage(): ReactElement {
  return (
    <PageLayout
      eyebrow={AUTOMATION_ACTIVITY_COPY.eyebrow}
      title={AUTOMATION_ACTIVITY_COPY.title}
      description={AUTOMATION_ACTIVITY_COPY.description}
      actions={
        <Link className="button button--secondary" to="/automations">
          {AUTOMATION_ACTIVITY_COPY.backToIndex}
        </Link>
      }
    >
      <EmptyState
        title={AUTOMATION_ACTIVITY_COPY.notYetTitle}
        message={AUTOMATION_ACTIVITY_COPY.notYetMessage}
      />
    </PageLayout>
  );
}
