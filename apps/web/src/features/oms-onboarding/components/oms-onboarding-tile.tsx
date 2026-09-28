/**
 * Packing tile (#3457)
 *
 * The Settings entry point to `/settings/packing`.
 *
 * **Deliberately NOT admin-gated**, like `WhoDecidesTile`: the page is also
 * the status page ("is packing on?"), which every role may read. The write
 * controls inside it are what gate on admin.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';

export function OmsOnboardingTile(): ReactElement {
  return (
    <article className="panel panel--dense" data-testid="oms-onboarding-tile">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{COPY.page.eyebrow}</p>
          <h3 className="section-title">{COPY.tile.title}</h3>
        </div>
      </div>
      <p className="muted-text">{COPY.tile.description}</p>
      <Link className="button button--secondary button--sm" to="/settings/packing">
        {COPY.tile.action}
      </Link>
    </article>
  );
}
