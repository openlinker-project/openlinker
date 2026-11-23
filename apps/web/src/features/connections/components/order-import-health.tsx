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
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { SidePanel } from '../../../shared/ui/side-panel';
import { useCountUp } from '../hooks/use-count-up';
import type { OrderImportStatus } from '../api/connections.types';

type Failure = OrderImportStatus['failures'][number];

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
  const panelCopy = useMessages('connections').orderSyncPanel;
  const copy = panelCopy.health;
  const format = useFormat();
  const plural = usePlural();
  const [failuresOpen, setFailuresOpen] = useState(false);

  const shownImported = useCountUp(orderImport?.importedLast24h ?? 0);
  const shownWaiting = useCountUp(orderImport?.waiting ?? 0);

  if (orderImport === null) {
    return null;
  }

  const { lastPolledAt, failures, waiting, activeImport } = orderImport;

  return (
    <div className="order-import-health">
      <dl className="order-import-health__stats">
        <div className="order-import-health__stat">
          <dt>{copy.lastChecked}</dt>
          <dd>{lastPolledAt === null ? copy.neverChecked : format.relativeTime(lastPolledAt)}</dd>
        </div>
        <div className="order-import-health__stat">
          <dt>{copy.imported}</dt>
          <dd>{format.number(shownImported)}</dd>
        </div>
        {waiting > 0 ? (
          <div className="order-import-health__stat order-import-health__stat--attention">
            <dt>{copy.waiting}</dt>
            <dd>{format.number(shownWaiting)}</dd>
          </div>
        ) : null}
      </dl>

      {failures.length > 0 ? (
        <>
          <div className="order-import-health__alert">
            <span className="order-import-health__alert-dot" aria-hidden="true" />
            <p className="order-import-health__alert-text">
              {interpolate(copy.failures.banner, {
                count: plural(
                  failures.reduce((sum, failure) => sum + failure.count, 0),
                  copy.failures.count
                ),
              })}
            </p>
            <Button tone="secondary" onClick={() => setFailuresOpen(true)}>
              {copy.failures.view}
            </Button>
          </div>
          <SidePanel
            open={failuresOpen}
            onOpenChange={setFailuresOpen}
            title={copy.failures.title}
            description={copy.failures.panelDescription}
            kicker={panelCopy.title}
            meta={
              <span className="order-import-health__panel-meta">{copy.failures.panelMeta}</span>
            }
            footer={
              onRetry ? (
                <Button tone="primary" onClick={onRetry} disabled={retrying}>
                  {retrying ? copy.failures.retrying : copy.failures.retryAll}
                </Button>
              ) : null
            }
          >
            <ul className="order-import-health__failure-list" aria-label={copy.failures.title}>
              {failures.map((failure) => (
                <FailureCause
                  key={failure.code}
                  failure={failure}
                  onSyncProducts={onSyncProducts}
                />
              ))}
            </ul>
          </SidePanel>
        </>
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
                  : interpolate(copy.fromDay, {
                      date: format.date(`${activeImport.from}T12:00:00`),
                    }),
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

interface FailureCauseProps {
  failure: Failure;
  onSyncProducts?: () => void;
}

/**
 * One failure cause as an accordion row: the cause and its count stay visible, the
 * explanation, the latest order and the fix unfold on demand so the tab never
 * shows everything at once.
 */
function FailureCause({ failure, onSyncProducts }: FailureCauseProps): ReactElement {
  const copy = useMessages('connections').orderSyncPanel.health;
  const format = useFormat();
  const plural = usePlural();
  // A cause this build does not know is shown as the generic one, never as a crash.
  const reason = copy.failures.reasons[failure.code] ?? copy.failures.reasons.other;

  return (
    <li className="order-import-health__failure">
      <p className="order-import-health__failure-head">
        <span className="order-import-health__failure-dot" aria-hidden="true" />
        {plural(failure.count, copy.failures.count)} · {reason.title}
      </p>
      <div className="order-import-health__failure-inner">
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
          <strong>{copy.failures.fixLabel}</strong> {reason.fix}
        </p>
        <div className="order-import-health__failure-actions">
          {failure.code === 'missing-mapping' && onSyncProducts ? (
            <Button tone="secondary" onClick={onSyncProducts}>
              {copy.failures.syncProducts}
            </Button>
          ) : null}
          <Link to="/jobs-logs" className="link">
            {copy.viewJobs}
          </Link>
        </div>
      </div>
    </li>
  );
}
