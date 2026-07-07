import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
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
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'status',
      label: 'Status',
      value: <StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge>,
    },
    { id: 'eventId', label: 'Event ID', value: d.eventId, mono: true },
    { id: 'provider', label: 'Provider', value: d.provider, mono: true },
    {
      id: 'connection',
      label: 'Connection',
      value: <ConnectionEntityLabel connectionId={d.connectionId} />,
    },
  ];
  if (d.objectType) {
    items.push({ id: 'objectType', label: 'Object type', value: d.objectType, mono: true });
  }
  if (d.externalId) {
    items.push({ id: 'externalId', label: 'External ID', value: d.externalId, mono: true });
  }
  items.push({
    id: 'sigValid',
    label: 'Signature valid',
    value:
      d.signatureValid === null ? <EmptyValue /> : d.signatureValid ? 'yes' : 'no',
  });
  if (d.dedupResult) {
    items.push({ id: 'dedup', label: 'Dedup', value: d.dedupResult });
  }
  if (d.publishedMessageId) {
    items.push({
      id: 'publishedMessage',
      label: 'Published message',
      value: d.publishedMessageId,
      mono: true,
    });
  }
  if (d.downstreamJobId) {
    items.push({
      id: 'downstreamJob',
      label: 'Downstream job',
      value: (
        <>
          <Link to={buildDownstreamJobHref(d, exactJobId)} className="mono-text">
            {d.downstreamJobId}
          </Link>
          {d.downstreamJobType ? (
            <span className="text-muted"> — {d.downstreamJobType}</span>
          ) : null}
        </>
      ),
    });
  }
  items.push({ id: 'received', label: 'Received', value: <TimeDisplay iso={d.receivedAt} /> });
  return items;
}

export function WebhookDeliveryDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useWebhookDeliveryQuery(id);

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
      backTo={{ to: '/webhook-deliveries', label: 'Webhooks' }}
      eyebrow="Webhook Deliveries"
      title={<span className="mono-text">{d.eventType ?? d.eventId}</span>}
    >
      <section className="detail-section">
        <KeyValueList items={buildWebhookDeliveryItems(d, exactJobId)} />
      </section>

      {d.rejectionReason ? (
        <section className="detail-section">
          <RawPayloadPanel title="Rejection reason" payload={d.rejectionReason} defaultOpen />
        </section>
      ) : null}

      {d.dlqReason ? (
        <section className="detail-section">
          <RawPayloadPanel title="DLQ reason" payload={d.dlqReason} defaultOpen />
        </section>
      ) : null}

      {d.payload ? (
        <section className="detail-section">
          <RawPayloadPanel title="Payload" payload={d.payload} />
        </section>
      ) : null}
    </PageLayout>
  );
}
