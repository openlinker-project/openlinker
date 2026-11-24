/**
 * Sourcing-rules tile (#3060)
 *
 * The `SettingsPage` entry point for `/settings/sourcing-rules`, and the ONLY
 * way in: there is no sidebar item, so the page's back-link and its two-level
 * crumb both point back here.
 *
 * Admin-gated at the mount site, like every settings tile except
 * `WhoDecidesTile` — the sourcing-rules API is `@Roles('admin')` end to end
 * (#2953), reads included, so a non-admin reaching the page would meet a 403
 * rather than a read-only view.
 *
 * @module apps/web/src/features/oms/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';

export function SourcingRulesTile(): ReactElement {
  const copy = useMessages('oms-core').sourcingRulesTile;
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
      </div>
      <p className="muted-text">{copy.description}</p>
      <Link className="button button--secondary button--sm" to="/settings/sourcing-rules">
        {copy.linkLabel}
      </Link>
    </article>
  );
}
