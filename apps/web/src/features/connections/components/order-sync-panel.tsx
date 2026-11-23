/**
 * Order Sync Panel
 *
 * Orders-tab panel for the order import (#4228): where it started, when the
 * shop was last checked and how the import is doing. "Check for new orders" runs
 * the check from here; "Import older orders…" opens the one dialog for a period
 * or a new start. Presentation only - the read is the existing
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
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../shared/ui/toast-provider';
import { useEnqueueSyncJobMutation, useRetryGroupedSyncJobsMutation } from '../../sync-jobs';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useConnectionSyncStatusQuery } from '../hooks/use-connection-sync-status-query';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useDemoMode } from '../../system';
import { useAdaptersQuery } from '../../adapters';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Button } from '../../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { Connection, OrderStartStatus } from '../api/connections.types';
import { ORDER_SYNC_START_DEFAULT_MODES } from '../lib/order-sync-start';
import { deriveOrderImportVerdict, type OrderImportVerdict } from '../lib/order-import-verdict';
import { OrderImportHealth } from './order-import-health';
import { OrderSyncRestartDialog } from './order-sync-restart-dialog';

const VERDICT_TONE: Record<OrderImportVerdict, StatusBadgeTone> = {
  ok: 'success',
  behind: 'warning',
  failing: 'warning',
  notChecked: 'neutral',
  unknown: 'neutral',
};

interface OrderSyncPanelProps {
  connection: Pick<Connection, 'id' | 'platformType' | 'adapterKey'>;
}

export function OrderSyncPanel({ connection }: OrderSyncPanelProps): ReactElement {
  const connectionId = connection.id;
  const [restartOpen, setRestartOpen] = useState(false);
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const sync = useWriteAccess('sync:write', demoMode);
  const navigate = useNavigate();
  const copy = useMessages('connections').orderSyncPanel;
  const format = useFormat();
  const adapters = useAdaptersQuery();
  const adapter =
    adapters.data?.find((a) => a.adapterKey === connection.adapterKey) ??
    adapters.data?.find((a) => a.platformType === connection.platformType && a.isDefault);
  // An adapter that declares no start modes cannot start from a chosen point (it reads
  // its whole history), so a start row and "Import older orders" would promise nothing.
  const hasStartChoice =
    (adapter?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES).length > 0;
  const statusQuery = useConnectionSyncStatusQuery(connectionId);
  const retryJobs = useRetryGroupedSyncJobsMutation();
  const { showToast } = useToast();

  const enqueueCheck = useEnqueueSyncJobMutation();

  async function checkNow(): Promise<void> {
    try {
      await enqueueCheck.mutateAsync({
        connectionId,
        jobType: 'marketplace.orders.poll',
        payload: { schemaVersion: 1 },
        idempotencyKey: `manual:${connectionId}:marketplace.orders.poll:${crypto.randomUUID()}`,
      });
      showToast({
        tone: 'success',
        title: copy.checkNowStartedTitle,
        description: copy.checkNowStartedMessage,
      });
      void statusQuery.refetch();
    } catch (error) {
      showToast({ tone: 'error', description: describeApiError(error, 'connections') });
    }
  }

  async function retryFailed(): Promise<void> {
    try {
      await retryJobs.mutateAsync({ connectionId, jobType: 'marketplace.order.sync' });
      showToast({ tone: 'success', title: copy.health.failures.retryDone, description: '' });
      await statusQuery.refetch();
    } catch (error) {
      showToast({ tone: 'error', description: describeApiError(error, 'connections') });
    }
  }
  const data = statusQuery.data;
  const startedAt = data?.orderSyncStartedAt ?? null;
  const verdict = deriveOrderImportVerdict(data?.orderImport ?? null, new Date(), data?.status);
  // What to do about the verdict. Failures carry their own fix inside each cause's card.
  const nextStep = verdict === 'ok' || verdict === 'failing' ? null : copy.verdictNext[verdict];

  // The start is stated as the SETTING it is (what was chosen and what that means for
  // older orders), never as activity, and never with a date that is only the time a
  // marker was written.
  function describeStart(start: OrderStartStatus | null, fallbackAt: string | null): string {
    if (start === null) {
      return fallbackAt === null
        ? copy.startText.unknown
        : interpolate(copy.startText.started, { date: format.dateTime(fallbackAt) });
    }
    const order =
      start.order === 'newest-first' ? copy.orderPhrase.newest : copy.orderPhrase.oldest;
    const date = start.from !== null ? format.date(`${start.from}T12:00:00`) : '';
    if (start.pending) {
      const what =
        start.mode === 'now'
          ? copy.startText.whatNow
          : start.mode === 'from'
            ? interpolate(copy.startText.whatFrom, { date, order })
            : interpolate(copy.startText.whatAll, { order });
      return interpolate(copy.startText.pending, { what });
    }
    const when = start.appliedAt === null ? '' : format.dateTime(start.appliedAt);
    if (start.mode === 'now') return interpolate(copy.startText.now, { date: when });
    if (start.mode === 'from') return interpolate(copy.startText.from, { date, order });
    return interpolate(copy.startText.all, { order });
  }

  return (
    <div className="panel panel--dense order-sync-panel">
      <div className="panel__header">
        <h3 className="section-title">{copy.title}</h3>
        <div className="order-sync-panel__actions">
          {sync.visible ? (
            <Button
              tone="secondary"
              onClick={() => void checkNow()}
              disabled={enqueueCheck.isPending || sync.demoReadOnly}
            >
              {copy.syncNow}
            </Button>
          ) : null}
        </div>
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

      <div className="order-sync-panel__verdict" role="status">
        {data ? (
          <>
            <StatusBadge tone={VERDICT_TONE[verdict]} withDot>
              {copy.verdict[verdict]}
            </StatusBadge>
            <p className="order-sync-panel__verdict-text">
              {interpolate(copy.verdictText[verdict], {
                when: data.orderImport?.lastPolledAt
                  ? format.relativeTime(data.orderImport.lastPolledAt)
                  : '',
              })}
            </p>
          </>
        ) : null}
      </div>

      {data ? (
        <>
          {nextStep !== null ? (
            <p className="order-sync-panel__next">
              <strong>{copy.nextLabel}</strong> {nextStep}
            </p>
          ) : null}
          {hasStartChoice ? (
            <div className="order-sync-panel__start-row">
              <div className="order-sync-panel__start-main">
                <span className="order-sync-panel__start-label">{copy.startLabel}</span>
                <p className="order-sync-panel__start">
                  {describeStart(data.orderStart, startedAt)}
                </p>
              </div>
              {write.visible ? (
                <Button
                  tone="secondary"
                  onClick={() => setRestartOpen(true)}
                  disabled={write.demoReadOnly}
                >
                  {copy.change}
                </Button>
              ) : null}
            </div>
          ) : null}
          <OrderImportHealth
            orderImport={data.orderImport}
            onRetry={sync.visible && !sync.demoReadOnly ? () => void retryFailed() : undefined}
            retrying={retryJobs.isPending}
            onSyncProducts={
              sync.visible
                ? () => void navigate(`/connections/${connectionId}?tab=actions&sync=products`)
                : undefined
            }
          />
        </>
      ) : null}
      <OrderSyncRestartDialog
        connection={connection}
        open={restartOpen}
        onOpenChange={setRestartOpen}
        hasFeedPosition={data?.orderStart != null && !data.orderStart.pending}
      />
    </div>
  );
}
