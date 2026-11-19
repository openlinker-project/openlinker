/**
 * Order Sync Panel
 *
 * Connection detail health-tab panel stating where order sync starts (#4228):
 * a new connection reads orders from the moment it was connected, and past
 * orders are not imported. Presentation only - the read is the existing
 * `use-connection-sync-status-query` (same query key as the queue panel, so no
 * extra request).
 *
 * A missing start date is rendered as an absence, never as a date: a
 * connection that predates start dates, or an adapter with no order feed, has
 * nothing to show. The panel never claims history was imported: it says only
 * where reading started and when the shop was last checked.
 *
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useConnectionSyncStatusQuery } from '../hooks/use-connection-sync-status-query';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useDemoMode } from '../../system';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Button } from '../../../shared/ui/button';
import type { Connection } from '../api/connections.types';
import { OrderSyncRestartDialog } from './order-sync-restart-dialog';

interface OrderSyncPanelProps {
  connection: Pick<Connection, 'id' | 'platformType' | 'adapterKey'>;
}

export function OrderSyncPanel({ connection }: OrderSyncPanelProps): ReactElement {
  const connectionId = connection.id;
  const [restartOpen, setRestartOpen] = useState(false);
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const copy = useMessages('connections').orderSyncPanel;
  const format = useFormat();
  const statusQuery = useConnectionSyncStatusQuery(connectionId);
  const data = statusQuery.data;
  const startedAt = data?.orderSyncStartedAt ?? null;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        {write.visible ? (
          <Button
            tone="secondary"
            onClick={() => setRestartOpen(true)}
            disabled={write.demoReadOnly}
          >
            {copy.restart.action}
          </Button>
        ) : null}
      </div>

      {statusQuery.isLoading ? (
        <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />
      ) : null}

      {statusQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(statusQuery.error, 'connections')}
          action={
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void statusQuery.refetch()}
            >
              {copy.retry}
            </button>
          }
        />
      ) : null}

      {data ? (
        <>
          <div className="order-sync-panel__status">
            <span
              className={[
                'order-sync-panel__dot',
                startedAt === null ? 'order-sync-panel__dot--idle' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            />
            <div>
              <p className="order-sync-panel__headline">{copy.headline}</p>
              <p className="order-sync-panel__since">
                {startedAt === null
                  ? copy.sinceUnknown
                  : interpolate(copy.since, { date: format.dateTime(startedAt) })}
              </p>
              <p className="order-sync-panel__fact">
                {data.lastCursorAdvanceAt === null
                  ? copy.noCheck
                  : interpolate(copy.lastCheck, {
                      when: format.relativeTime(data.lastCursorAdvanceAt),
                    })}
              </p>
            </div>
          </div>
          <p className="order-sync-panel__note">{copy.note}</p>
        </>
      ) : null}
      <OrderSyncRestartDialog
        connection={connection}
        open={restartOpen}
        onOpenChange={setRestartOpen}
      />
    </div>
  );
}
