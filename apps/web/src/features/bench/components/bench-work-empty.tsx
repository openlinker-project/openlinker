/**
 * The bench's two empty states (#2416, `W3b-3`, story B3)
 *
 * *"Nothing to pack right now"* and *"routing is not switched on, so this bench
 * will never receive work"* are DIFFERENT FACTS, and the whole point of this
 * component is that they never render as the same screen.
 *
 * Conflating them is what makes a working bench look broken: a packer staring
 * at an empty page cannot tell whether to wait or to fetch a supervisor, and
 * the second state does not resolve by waiting however long they do it.
 *
 * The second names its remedy, per B3. It points at the settings page that says
 * who carries work out, because *that* is the missing fact — creating a stock
 * location is a different setup step and would not make a parcel arrive here.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { useMessages } from '../../../shared/i18n';

export interface BenchWorkEmptyProps {
  /**
   * Whether work can reach this bench at all.
   *
   * The caller passes the server's answer rather than inferring one from an
   * empty array — an empty array is exactly what both states look like, which
   * is the confusion this component exists to remove.
   */
  readonly routingReady: boolean;
}

export function BenchWorkEmpty({ routingReady }: BenchWorkEmptyProps): ReactElement {
  const isAdmin = useIsAdmin();
  const copy = useMessages('bench').work;

  if (routingReady) {
    return (
      <div className="bench-work-empty" data-testid="bench-work-empty-idle">
        <h2 className="bench-work-empty__title">{copy.emptyIdle.title}</h2>
        <p className="bench-work-empty__body">{copy.emptyIdle.body}</p>
        {/* Says the pipe is healthy, which is the fact that distinguishes this
            screen from the other one. Without it the two read alike. */}
        <p className="bench-work-empty__note">{copy.emptyIdle.reassurance}</p>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="bench-work-empty" data-testid="bench-work-empty-not-set-up">
        <h2 className="bench-work-empty__title">{copy.emptyNotSetUpAdmin.title}</h2>
        <p className="bench-work-empty__body">{copy.emptyNotSetUpAdmin.body}</p>
        <Link className="button button--primary" to="/settings/packing" data-testid="link-setup-oms">
          {copy.emptyNotSetUpAdmin.action}
        </Link>
      </div>
    );
  }

  return (
    <div className="bench-work-empty" data-testid="bench-work-empty-not-routed">
      <h2 className="bench-work-empty__title">{copy.emptyNotRouted.title}</h2>
      <p className="bench-work-empty__body">{copy.emptyNotRouted.body}</p>
      <Alert
        tone="warning"
        title={copy.emptyNotRouted.remedyTitle}
        action={
          <Link className="button button--secondary button--sm" to="/settings/packing" data-testid="link-packing-setup">
            {copy.emptyNotRouted.remedyLink}
          </Link>
        }
      >
        {copy.emptyNotRouted.remedyBody}
      </Alert>
    </div>
  );
}
