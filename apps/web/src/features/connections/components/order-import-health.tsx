/**
 * Order Import Health
 *
 * The health-tab detail of a connection's order import (#4228): how many orders
 * came in recently, when the last one did, what is waiting, what failed, and
 * whether a history or date-range import is still running. It is read from the
 * connection's own job rows, so it answers when the shop does not.
 *
 * An unreadable read is stated as such. It is never drawn as zero orders, which
 * would read as "nothing is wrong".
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import type { OrderImportStatus } from '../api/connections.types';

interface OrderImportHealthProps {
  orderImport: OrderImportStatus | null;
  /** Opens the manual product sync, the fix for orders that name a product OpenLinker does not know. */
  onSyncProducts?: () => void;
  /** Puts every failed order of this connection back in the queue; absent when the user cannot retry. */
  onRetry?: () => void;
  retrying?: boolean;
}

export function OrderImportHealth({
  orderImport,
  onSyncProducts,
  onRetry,
  retrying = false,
}: OrderImportHealthProps): ReactElement | null {
  const copy = useMessages('connections').orderSyncPanel.health;
  const format = useFormat();
  const plural = usePlural();

  if (orderImport === null) {
    return null;
  }

  const { importedLast24h, lastPolledAt, failures, waiting, activeImport } = orderImport;

  return (
    <div className="order-import-health">
      <dl className="order-import-health__stats">
        <div className="order-import-health__stat">
          <dt>{copy.lastChecked}</dt>
          <dd>{lastPolledAt === null ? copy.neverChecked : format.relativeTime(lastPolledAt)}</dd>
        </div>
        <div className="order-import-health__stat">
          <dt>{copy.imported}</dt>
          <dd>{format.number(importedLast24h)}</dd>
        </div>
        {waiting > 0 ? (
          <div className="order-import-health__stat">
            <dt>{copy.waiting}</dt>
            <dd>{format.number(waiting)}</dd>
          </div>
        ) : null}
      </dl>

      {failures.length > 0 ? (
        <ul className="order-import-health__failure-list" aria-label={copy.failures.title}>
          {failures.map((failure) => {
            // A cause this build does not know is shown as the generic one, never as a crash.
            const reason = copy.failures.reasons[failure.code] ?? copy.failures.reasons.other;
            return (
              <li key={failure.code} className="order-import-health__failure">
                <p className="order-import-health__failure-head">
                  {plural(failure.count, copy.failures.count)} · {reason.title}
                </p>
                <p className="order-import-health__failure-text">{reason.text}</p>
                <p className="order-import-health__failure-meta">
                  {failure.sampleOrderId === null
                    ? format.relativeTime(failure.lastFailedAt)
                    : interpolate(copy.failures.latest, {
                        order: failure.sampleOrderId,
                        when: format.relativeTime(failure.lastFailedAt),
                      })}
                </p>
                {failure.code !== 'missing-mapping' && failure.sampleMessage !== '' ? (
                  <p className="order-import-health__failure-original">
                    <span>{copy.failures.original}</span> {failure.sampleMessage}
                  </p>
                ) : null}
                <p className="order-import-health__failure-fix">
                  <strong>{copy.failures.fixLabel}</strong> {reason.fix}{' '}
                  <Link to="/jobs-logs" className="link">
                    {copy.viewJobs}
                  </Link>
                  {failure.code === 'missing-mapping' && onSyncProducts ? (
                    <>
                      {' '}
                      <Button tone="secondary" onClick={onSyncProducts}>
                        {copy.failures.syncProducts}
                      </Button>
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {failures.length > 0 && onRetry ? (
        <p className="order-import-health__retry">
          <Button tone="secondary" onClick={onRetry} disabled={retrying}>
            {retrying ? copy.failures.retrying : copy.failures.retryAll}
          </Button>
        </p>
      ) : null}
      {activeImport ? (
        <div className="order-import-health__run" role="status">
          <span className="order-import-health__run-bar" aria-hidden="true" />
          <div>
            <p className="order-import-health__run-title">{copy.importRunning}</p>
            <p className="order-import-health__run-detail">
              {[
                activeImport.direction === 'newest-first' ? copy.newestFirst : copy.oldestFirst,
                activeImport.from === null
                  ? copy.fromStart
                  : interpolate(copy.fromDay, { date: format.date(`${activeImport.from}T12:00:00`) }),
                activeImport.to === null
                  ? null
                  : interpolate(copy.toDay, { date: format.date(`${activeImport.to}T12:00:00`) }),
                interpolate(copy.startedAgo, { when: format.relativeTime(activeImport.startedAt) }),
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
