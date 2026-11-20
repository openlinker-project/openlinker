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
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import type { OrderImportStatus } from '../api/connections.types';

interface OrderImportHealthProps {
  orderImport: OrderImportStatus | null;
}

export function OrderImportHealth({ orderImport }: OrderImportHealthProps): ReactElement | null {
  const copy = useMessages('connections').orderSyncPanel.health;
  const format = useFormat();

  if (orderImport === null) {
    return null;
  }

  const {
    importedLast24h,
    lastPolledAt,
    failedLast7d,
    failures,
    waiting,
    lastImportedAt,
    activeImport,
  } = orderImport;

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
        <div className="order-import-health__stat">
          <dt>{copy.lastOrder}</dt>
          <dd>{lastImportedAt === null ? copy.noneRecently : format.relativeTime(lastImportedAt)}</dd>
        </div>
        {waiting > 0 ? (
          <div className="order-import-health__stat">
            <dt>{copy.waiting}</dt>
            <dd>{format.number(waiting)}</dd>
          </div>
        ) : null}
        {failedLast7d > 0 ? (
          <div className="order-import-health__stat order-import-health__stat--warn">
            <dt>{copy.failed}</dt>
            <dd>{format.number(failedLast7d)}</dd>
          </div>
        ) : null}
      </dl>

      {failedLast7d > 0 ? (
        <section className="order-import-health__failures" aria-label={copy.failures.title}>
          <h4 className="order-import-health__failures-title">{copy.failures.title}</h4>
          <ul className="order-import-health__failure-list">
            {failures.map((failure) => (
              <li key={failure.code} className="order-import-health__failure">
                <p className="order-import-health__failure-head">
                  {copy.failures.reasons[failure.code].title}
                </p>
                <p className="order-import-health__failure-text">
                  {copy.failures.reasons[failure.code].text}
                </p>
                <p className="order-import-health__failure-meta">
                  {interpolate(copy.failures.count, { n: format.number(failure.count) })}
                  {' · '}
                  {interpolate(copy.failures.latest, {
                    order: failure.sampleOrderId ?? '?',
                    when: format.relativeTime(failure.lastFailedAt),
                  })}
                </p>
                {failure.code === 'other' && failure.sampleMessage !== '' ? (
                  <p className="order-import-health__failure-original">
                    <span>{copy.failures.original}</span> {failure.sampleMessage}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="order-import-health__failure-link">
            <Link to="/jobs-logs" className="link">
              {copy.viewJobs}
            </Link>
          </p>
        </section>
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
