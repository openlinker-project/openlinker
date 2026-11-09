import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { EmptyValue } from '../../shared/ui/empty-value';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useWebhookDeliveryQuery } from '../../features/webhook-deliveries/hooks/use-webhook-delivery-query';
import type {
  WebhookDeliveryDetail,
  WebhookDeliveryStatus,
} from '../../features/webhook-deliveries/api/webhook-deliveries.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { useSyncJobLookupQuery } from '../../features/sync-jobs/hooks/use-sync-job-lookup-query';
import { jobTypeLabel } from '../../features/sync-jobs/lib/job-type-label';
import { webhookDeliveryStatusLabel } from '../../features/webhook-deliveries/lib/webhook-delivery-status-label';
import { useMessages, type Messages } from '../../shared/i18n';

type DeliveryDetailCopy = Messages['webhook-deliveries']['webhookDeliveryDetailPage'];

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

/**
 * Where the "Downstream job" link points. The persisted SyncJob UUID (exact
 * job detail) is preferred; until it resolves — or if the worker hasn't created
 * the row yet — we fall back to the Jobs & Logs list pre-filtered to this
 * delivery's connection + job type, so the link is never dead and never sends a
 * Redis Stream enqueue ID to the UUID-only `/jobs-logs/:id` route (#1366).
 */
function buildDownstreamJobHref(d: WebhookDeliveryDetail, exactJobId: string | null): string {
  if (exactJobId) {
    return `/jobs-logs/${exactJobId}`;
  }
  const params = new URLSearchParams({ connectionId: d.connectionId });
  if (d.downstreamJobType) {
    params.set('jobType', d.downstreamJobType);
  }
  return `/jobs-logs?${params.toString()}`;
}

function buildWebhookDeliveryItems(
  d: WebhookDeliveryDetail,
  exactJobId: string | null,
  copy: DeliveryDetailCopy['fields'],
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'status',
      label: copy.status,
      value: (
        <StatusBadge tone={statusTone(d.status)}>{webhookDeliveryStatusLabel(d.status)}</StatusBadge>
      ),
    },
    { id: 'eventId', label: copy.eventId, value: d.eventId, mono: true },
    { id: 'provider', label: copy.provider, value: d.provider, mono: true },
    {
      id: 'connection',
      label: copy.connection,
      value: <ConnectionEntityLabel connectionId={d.connectionId} />,
    },
  ];
  if (d.objectType) {
    items.push({ id: 'objectType', label: copy.objectType, value: d.objectType, mono: true });
  }
  if (d.externalId) {
    items.push({ id: 'externalId', label: copy.externalId, value: d.externalId, mono: true });
  }
  items.push({
    id: 'sigValid',
    label: copy.signatureValid,
    value:
      d.signatureValid === null ? <EmptyValue /> : d.signatureValid ? copy.yes : copy.no,
  });
  if (d.dedupResult) {
    items.push({ id: 'dedup', label: copy.dedup, value: d.dedupResult });
  }
  if (d.publishedMessageId) {
    items.push({
      id: 'publishedMessage',
      label: copy.publishedMessage,
      value: d.publishedMessageId,
      mono: true,
    });
  }
  if (d.downstreamJobId) {
    items.push({
      id: 'downstreamJob',
      label: copy.downstreamJob,
      value: (
        <>
          <Link to={buildDownstreamJobHref(d, exactJobId)} className="mono-text">
            {d.downstreamJobId}
          </Link>
          {d.downstreamJobType ? (
            <span className="text-muted" title={d.downstreamJobType}>
              {' - '}
              {jobTypeLabel(d.downstreamJobType)}
            </span>
          ) : null}
        </>
      ),
    });
  }
  items.push({ id: 'received', label: copy.received, value: <TimeDisplay iso={d.receivedAt} /> });
  return items;
}

export function WebhookDeliveryDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useWebhookDeliveryQuery(id);
  const copy = useMessages('webhook-deliveries').webhookDeliveryDetailPage;

  // Resolve the connection (for its platformType) and, from that, the exact
  // downstream SyncJob the webhook enqueued (#1366). The server builds the
  // idempotency key from these components — the platformType comes from the
  // resolved connection (the delivery's free-form `provider` is not a reliable
  // substitute). Both hooks self-disable on missing inputs, so they're safe to
  // call before the guards below and stay dormant when there's no downstream job.
  const delivery = query.data;
  const connectionQuery = useConnectionQuery(delivery?.connectionId ?? '');
  const platformType = connectionQuery.data?.platformType;
  const lookupInput =
    delivery?.downstreamJobId && platformType
      ? { platformType, connectionId: delivery.connectionId, eventId: delivery.eventId }
      : null;
  const downstreamJobQuery = useSyncJobLookupQuery(lookupInput);
  const exactJobId = downstreamJobQuery.data?.id ?? null;

  if (query.isLoading) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <ErrorState
          title={copy.error.title}
          message={query.error ? describeApiError(query.error, 'webhook-deliveries') : copy.error.notFound}
          action={<Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>}
        />
      </PageLayout>
    );
  }

  const d = query.data;

  return (
    <PageLayout
      backTo={{ to: '/webhook-deliveries', label: copy.backTo }}
      eyebrow={copy.eyebrow}
      title={<span className="mono-text">{d.eventType ?? d.eventId}</span>}
    >
      <section className="detail-section">
        <KeyValueList items={buildWebhookDeliveryItems(d, exactJobId, copy.fields)} />
      </section>

      {d.rejectionReason ? (
        <section className="detail-section">
          <RawPayloadPanel title={copy.panels.rejectionReason} payload={d.rejectionReason} defaultOpen />
        </section>
      ) : null}

      {d.dlqReason ? (
        <section className="detail-section">
          <RawPayloadPanel title={copy.panels.dlqReason} payload={d.dlqReason} defaultOpen />
        </section>
      ) : null}

      {d.payload ? (
        <section className="detail-section">
          <RawPayloadPanel title={copy.panels.payload} payload={d.payload} />
        </section>
      ) : null}
    </PageLayout>
  );
}
