/**
 * KSeF numbering - connection Actions row
 *
 * Contributed to `ConnectionActionsPanel` via the KSeF plugin's
 * `ConnectionActions` slot (the same seam PrestaShop uses for "Configure
 * webhooks"). Because only the KSeF plugin registers this slot, the row is
 * KSeF-only by construction - the capability gate is the plugin boundary, not a
 * platformType literal. The row's description carries the numbering status
 * inline (how many document types are routed, or "not set up yet"); while the
 * status query is in flight it shows a skeleton rather than flashing an empty
 * tail. The primary button opens the dedicated numbering page.
 *
 * This is pure navigation, never a write, so it stays a live link even for a
 * demo viewer - the read-only gate lives on the final save inside the numbering
 * editor, not on the door into it.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useNumberingRoutesQuery } from '../../../features/invoicing';
import type { Connection } from '../../../features/connections';
import { usePlural } from '../../../shared/i18n';
import { useKsefMessages } from '../messages';

interface KsefNumberingActionsProps {
  connection: Connection;
}

export function KsefNumberingActions({
  connection,
}: KsefNumberingActionsProps): ReactElement {
  const copy = useKsefMessages().ksefNumberingActions;
  const plural = usePlural();
  const routesQuery = useNumberingRoutesQuery(connection.id);
  const routeCount = routesQuery.data?.length ?? 0;
  const configured = routeCount > 0;
  const resolved = routesQuery.isSuccess;
  const to = `/connections/${connection.id}/numbering`;

  return (
    <div className="action-list__item">
      <div>
        <strong>{copy.title}</strong>
        <p className="muted-text">
          {copy.description}{' '}
          {!resolved ? (
            <span className="numbering-status-skeleton" aria-hidden="true" />
          ) : configured ? (
            <span>{plural(routeCount, copy.routedCount)}</span>
          ) : (
            <span className="numbering-status-warning">{copy.notSetUp}</span>
          )}
        </p>
      </div>
      <Link className={`button button--${configured ? 'secondary' : 'primary'}`} to={to}>
        {configured ? copy.configure : copy.setUp}
      </Link>
    </div>
  );
}
