import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useWebhookDeliveryQuery } from '../../features/webhook-deliveries/hooks/use-webhook-delivery-query';
import type { WebhookDeliveryStatus } from '../../features/webhook-deliveries/api/webhook-deliveries.types';

function statusTone(status: WebhookDeliveryStatus): StatusBadgeTone {
  switch (status) {
    case 'published':
    case 'job_enqueued':
      return 'success';
    case 'rejected':
    case 'failed':
    case 'deadlettered':
      return 'error';
    case 'received':
      return 'info';
    default:
      return 'neutral';
  }
}

export function WebhookDeliveryDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useWebhookDeliveryQuery(id);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Webhook Deliveries" title="Delivery detail">
        <LoadingState liveRegion="off" title="Loading delivery" message="Fetching delivery details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Webhook Deliveries" title="Delivery detail">
        <ErrorState
          title="Unable to load delivery"
          message={query.error?.message ?? 'Delivery not found'}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      </PageLayout>
    );
  }

  const d = query.data;

  return (
    <PageLayout
      eyebrow="Webhook Deliveries"
      title={<span className="mono-text">{d.eventType ?? d.eventId}</span>}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to deliveries
        </Link>
      }
    >
      <section className="detail-section">
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Status</dt>
            <dd><StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge></dd>
          </div>
          <div className="detail-list__row">
            <dt>Event ID</dt>
            <dd><span className="mono-text">{d.eventId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Provider</dt>
            <dd><span className="mono-text">{d.provider}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Connection</dt>
            <dd><span className="mono-text">{d.connectionId}</span></dd>
          </div>
          {d.objectType ? (
            <div className="detail-list__row">
              <dt>Object type</dt>
              <dd><span className="mono-text">{d.objectType}</span></dd>
            </div>
          ) : null}
          {d.externalId ? (
            <div className="detail-list__row">
              <dt>External ID</dt>
              <dd><span className="mono-text">{d.externalId}</span></dd>
            </div>
          ) : null}
          <div className="detail-list__row">
            <dt>Signature valid</dt>
            <dd>{d.signatureValid === null ? '—' : d.signatureValid ? 'yes' : 'no'}</dd>
          </div>
          {d.dedupResult ? (
            <div className="detail-list__row">
              <dt>Dedup</dt>
              <dd>{d.dedupResult}</dd>
            </div>
          ) : null}
          {d.publishedMessageId ? (
            <div className="detail-list__row">
              <dt>Published message</dt>
              <dd><span className="mono-text">{d.publishedMessageId}</span></dd>
            </div>
          ) : null}
          {d.downstreamJobId ? (
            <div className="detail-list__row">
              <dt>Downstream job</dt>
              <dd>
                <Link to={`/jobs-logs/${d.downstreamJobId}`} className="mono-text">
                  {d.downstreamJobId}
                </Link>
                {d.downstreamJobType ? (
                  <span className="text-muted"> — {d.downstreamJobType}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div className="detail-list__row">
            <dt>Received</dt>
            <dd><TimeDisplay iso={d.receivedAt} /></dd>
          </div>
        </dl>
      </section>

      {d.rejectionReason ? (
        <section className="detail-section">
          <h3 className="detail-section__title">Rejection reason</h3>
          <pre className="mono-text detail-section__pre">{d.rejectionReason}</pre>
        </section>
      ) : null}

      {d.dlqReason ? (
        <section className="detail-section">
          <h3 className="detail-section__title">DLQ reason</h3>
          <pre className="mono-text detail-section__pre">{d.dlqReason}</pre>
        </section>
      ) : null}

      {d.payload ? (
        <section className="detail-section">
          <h3 className="detail-section__title">Payload</h3>
          <pre className="mono-text detail-section__pre">
            {JSON.stringify(d.payload, null, 2)}
          </pre>
        </section>
      ) : null}
    </PageLayout>
  );
}
