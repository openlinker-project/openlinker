/**
 * Wizard success screen (#4135)
 *
 * What a connection wizard shows once the connection exists: its name, the
 * Active badge, optionally the shop it feeds, the next-step blocks the wizard
 * passes in, and the way on to the connection. Shared so the shop, carrier and
 * channel wizards end the same way.
 *
 * @module features/connections/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { Connection } from '../api/connections.types';
import { useConnectionQuery } from '../hooks/use-connection-query';
import { useConnectionsQuery } from '../hooks/use-connections-query';

/** The shop a channel feeds, read from the channel's own pairing key. */
export function TargetShopRow({
  connectionId,
}: {
  readonly connectionId: string;
}): ReactElement | null {
  const copy = useMessages('connections').wizardCreated;
  const connection = useConnectionQuery(connectionId).data;
  const all = useConnectionsQuery().data ?? [];
  const masterId = connection?.config?.['masterCatalogConnectionId'];
  const shop =
    typeof masterId === 'string' ? all.find((c: Connection) => c.id === masterId) : undefined;
  if (!shop) return null;
  return (
    <div>
      <dt>{copy.targetShop}</dt>
      <dd>{shop.name}</dd>
    </div>
  );
}

export interface WizardCreatedScreenProps {
  readonly connectionId: string;
  readonly connectionName: string;
  /** Title of the success alert (the wizard's own "Connection created"). */
  readonly title: string;
  /** Show the shop this connection feeds (channels only). */
  readonly showTargetShop?: boolean;
  /** Next-step blocks, rendered between the summary and the actions. */
  readonly children?: ReactNode;
  /** Extra links beside "Go to connection". */
  readonly extraActions?: ReactNode;
}

export function WizardCreatedScreen({
  connectionId,
  connectionName,
  title,
  showTargetShop = false,
  children,
  extraActions,
}: WizardCreatedScreenProps): ReactElement {
  const copy = useMessages('connections').wizardCreated;
  return (
    <div className="wizard-card">
      <Alert tone="success" title={title}>
        <StatusBadge tone="success">{copy.active}</StatusBadge>
      </Alert>
      <dl className="definition-list">
        <div>
          <dt>{copy.name}</dt>
          <dd>{connectionName}</dd>
        </div>
        {showTargetShop ? <TargetShopRow connectionId={connectionId} /> : null}
      </dl>
      {children}
      <div className="form-actions">
        <Link className="button" to={`/connections/${connectionId}`}>
          {copy.goToConnection}
        </Link>
        {extraActions}
      </div>
    </div>
  );
}
