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

export function OrderImportHealth({ orderImport }: OrderImportHealthProps): ReactElement {
  const copy = useMessages('connections').orderSyncPanel.health;
  const format = useFormat();

  if (orderImport === null) {
    return <p className="order-sync-panel__note">{copy.unavailable}</p>;
  }

  const { importedLast24h, failedLast7d, waiting, lastImportedAt, activeImport } = orderImport;

  return (
    <div className="order-import-health">
      <dl className="order-import-health__stats">
        <div className="order-import-health__stat">
          <dt>{copy.imported}</dt>
          <dd>{format.number(importedLast24h)}</dd>
        </div>
        <div className="order-import-health__stat">
          <dt>{copy.lastOrder}</dt>
          <dd>{lastImportedAt === null ? copy.noneRecently : format.relativeTime(lastImportedAt)}</dd>
        </div>
        <div className="order-import-health__stat">
          <dt>{copy.waiting}</dt>
          <dd>{format.number(waiting)}</dd>
        </div>
        <div
          className={[
            'order-import-health__stat',
            failedLast7d > 0 ? 'order-import-health__stat--warn' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <dt>{copy.failed}</dt>
          <dd>{format.number(failedLast7d)}</dd>
        </div>
      </dl>

      {failedLast7d > 0 ? (
        <p className="order-import-health__failure">
          {copy.failedHint}{' '}
          <Link to="/jobs-logs" className="link">
            {copy.viewJobs}
          </Link>
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
                interpolate(copy.pagesRead, { n: format.number(activeImport.pagesDone) }),
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
