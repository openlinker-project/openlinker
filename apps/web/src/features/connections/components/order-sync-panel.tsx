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
 * nothing to show. The history row says only what is true today; there is no
 * import action.
 *
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useConnectionSyncStatusQuery } from '../hooks/use-connection-sync-status-query';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
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
        <div className="order-sync-panel__rows">
          <div className="order-sync-panel__row">
            <div className="order-sync-panel__row-head">
              <span className="order-sync-panel__label">{copy.live.label}</span>
              <StatusBadge tone={startedAt === null ? 'neutral' : 'success'}>
                {startedAt === null ? copy.live.badgeBefore : copy.live.badge}
              </StatusBadge>
            </div>
            {startedAt === null ? (
              <p className="order-sync-panel__caption">{copy.live.before}</p>
            ) : (
              <>
                <div className="order-sync-panel__lane" aria-hidden="true">
                  <div className="order-sync-panel__fill" />
                </div>
                <p className="order-sync-panel__caption">
                  {interpolate(copy.live.from, { date: format.dateTime(startedAt) })}
                  {' · '}
                  {data.lastCursorAdvanceAt === null
                    ? copy.live.noActivity
                    : interpolate(copy.live.lastActivity, {
                        when: format.relativeTime(data.lastCursorAdvanceAt),
                      })}
                </p>
              </>
            )}
          </div>

          <div className="order-sync-panel__row">
            <div className="order-sync-panel__row-head">
              <span className="order-sync-panel__label">{copy.history.label}</span>
              <StatusBadge tone="neutral">{copy.history.badge}</StatusBadge>
            </div>
            <div className="order-sync-panel__lane" aria-hidden="true" />
            <p className="order-sync-panel__caption">{copy.history.caption}</p>
          </div>
        </div>
      ) : null}
      <OrderSyncRestartDialog
        connection={connection}
        open={restartOpen}
        onOpenChange={setRestartOpen}
      />
    </div>
  );
}
