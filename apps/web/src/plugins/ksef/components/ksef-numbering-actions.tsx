/**
 * KSeF numbering — connection Actions row
 *
 * Contributed to `ConnectionActionsPanel` via the KSeF plugin's
 * `ConnectionActions` slot (the same seam PrestaShop uses for "Configure
 * webhooks"). Because only the KSeF plugin registers this slot, the row is
 * KSeF-only by construction — the capability gate is the plugin boundary, not a
 * platformType literal. The row's description carries the numbering status
 * inline (how many document types are routed, or "not set up yet"); while the
 * status query is in flight it shows a skeleton rather than flashing an empty
 * tail. The primary button opens the dedicated numbering page.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useNumberingRoutesQuery } from '../../../features/invoicing';
import type { Connection } from '../../../features/connections';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';

interface KsefNumberingActionsProps {
  connection: Connection;
  readOnly?: boolean;
}

export function KsefNumberingActions({
  connection,
  readOnly = false,
}: KsefNumberingActionsProps): ReactElement {
  const routesQuery = useNumberingRoutesQuery(connection.id);
  const routeCount = routesQuery.data?.length ?? 0;
  const configured = routeCount > 0;
  const resolved = routesQuery.isSuccess;
  const to = `/connections/${connection.id}/numbering`;

  return (
    <div className="action-list__item">
      <div>
        <strong>Invoice numbering</strong>
        <p className="muted-text">
          Sequential numbers OpenLinker stamps on every KSeF invoice.{' '}
          {!resolved ? (
            <span className="numbering-status-skeleton" aria-hidden="true" />
          ) : configured ? (
            <span>
              {routeCount} document {routeCount === 1 ? 'type' : 'types'} routed
            </span>
          ) : (
            <span className="numbering-status-warning">not set up yet</span>
          )}
        </p>
      </div>
      {readOnly ? (
        <ReadOnlyLock active message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button tone={configured ? 'secondary' : 'primary'} disabled>
            {configured ? 'Configure…' : 'Set up…'}
          </Button>
        </ReadOnlyLock>
      ) : (
        <Link className={`button button--${configured ? 'secondary' : 'primary'}`} to={to}>
          {configured ? 'Configure…' : 'Set up…'}
        </Link>
      )}
    </div>
  );
}
