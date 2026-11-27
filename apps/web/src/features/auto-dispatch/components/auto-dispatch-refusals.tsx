/**
 * Recent refusals (#2729)
 *
 * The orders where an automatic label was NOT bought, split the way the backend
 * splits them: "needs your input" (nothing changes until someone acts) and
 * "retrying automatically" (still on the retry ladder, may clear on its own).
 *
 * States: loading, a failed read, an unreadable response, empty (both buckets
 * empty), and data. An unreadable response is reported as such - never rendered
 * as "no refusals", which would tell the operator their labels are fine.
 *
 * @module apps/web/src/features/auto-dispatch/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { formatRelativeTime } from '../../../shared/format/format-relative-time';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { AutoDispatchRefusal } from '../api/auto-dispatch.types';
import { useAutoDispatchRefusalsQuery } from '../hooks/use-auto-dispatch-refusals-query';
import { autoDispatchCopy } from '../lib/auto-dispatch.copy';

const COPY = autoDispatchCopy.refusals;

function RefusalRow({ refusal }: { readonly refusal: AutoDispatchRefusal }): ReactElement {
  return (
    <li className="auto-dispatch__row" data-testid="auto-dispatch-refusal">
      <div className="auto-dispatch__row-main">
        <p className="auto-dispatch__row-reason">{COPY.codes[refusal.code]}</p>
        <p className="auto-dispatch__row-meta">
          {refusal.bucket === 'retrying'
            ? `${COPY.attempts(refusal.attempts, refusal.maxAttempts)} · `
            : ''}
          {formatRelativeTime(refusal.since)}
        </p>
      </div>
      {refusal.orderId !== null ? (
        <Link
          className="button button--ghost button--sm"
          to={`/orders/${encodeURIComponent(refusal.orderId)}`}
        >
          {COPY.openOrder}
        </Link>
      ) : null}
    </li>
  );
}

function Bucket(props: {
  readonly title: string;
  readonly help: string;
  readonly tone: 'warning' | 'info';
  readonly items: readonly AutoDispatchRefusal[];
  readonly testId: string;
}): ReactElement {
  return (
    <div className="auto-dispatch__bucket" data-testid={props.testId}>
      <p className="auto-dispatch__bucket-title">
        <StatusBadge tone={props.tone} compact>
          {String(props.items.length)}
        </StatusBadge>{' '}
        {props.title}
      </p>
      <p className="auto-dispatch__help">{props.help}</p>
      {props.items.length === 0 ? (
        <p className="auto-dispatch__help">{COPY.emptyBucket}</p>
      ) : (
        <ul className="auto-dispatch__list">
          {props.items.map((refusal) => (
            <RefusalRow key={refusal.jobId} refusal={refusal} />
          ))}
        </ul>
      )}
    </div>
  );
}

export interface AutoDispatchRefusalsProps {
  readonly connectionId: string;
}

export function AutoDispatchRefusals({ connectionId }: AutoDispatchRefusalsProps): ReactElement {
  const query = useAutoDispatchRefusalsQuery(connectionId);

  let body: ReactElement;
  if (query.isLoading) {
    body = (
      <p className="auto-dispatch__help" aria-live="polite">
        {autoDispatchCopy.section.loading}
      </p>
    );
  } else if (query.error) {
    body = (
      <Alert
        tone="error"
        title={COPY.loadFailedTitle}
        action={
          <Button tone="secondary" onClick={() => void query.refetch()}>
            {autoDispatchCopy.section.retry}
          </Button>
        }
      >
        {query.error.message}
      </Alert>
    );
  } else if (query.data === null || query.data === undefined) {
    body = (
      <Alert tone="warning" title={COPY.loadFailedTitle}>
        {COPY.unreadable}
      </Alert>
    );
  } else if (query.data.needsInput.length === 0 && query.data.retrying.length === 0) {
    body = (
      <div data-testid="auto-dispatch-refusals-empty">
        <p className="auto-dispatch__bucket-title">{COPY.emptyTitle}</p>
        <p className="auto-dispatch__help">{COPY.emptyBody}</p>
      </div>
    );
  } else {
    body = (
      <div className="auto-dispatch__buckets">
        <Bucket
          title={COPY.needsInput}
          help={COPY.needsInputHelp}
          tone="warning"
          items={query.data.needsInput}
          testId="auto-dispatch-needs-input"
        />
        <Bucket
          title={COPY.retrying}
          help={COPY.retryingHelp}
          tone="info"
          items={query.data.retrying}
          testId="auto-dispatch-retrying"
        />
      </div>
    );
  }

  return (
    <section className="auto-dispatch__block" data-testid="auto-dispatch-refusals">
      <h3 className="auto-dispatch__block-title">{COPY.title}</h3>
      <p className="auto-dispatch__help">{COPY.help}</p>
      {body}
    </section>
  );
}
