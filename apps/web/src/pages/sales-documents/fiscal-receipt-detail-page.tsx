/**
 * Fiscal Receipt Detail Page (#3307)
 *
 * The fiscal-receipt half of the merged `/sales-documents/:kind/:recordId`
 * detail route — the invoice half reuses the existing `InvoiceDetailPage`
 * verbatim (both read one record by id). Deliberately minimal for this
 * first slice: identity + status + failure reason + artefacts + order
 * back-link, mirroring the facts `SalesDocumentListCell`'s popover already
 * surfaces rather than the fuller order-detail panel's reconcile/retry
 * actions, which stay on that panel.
 *
 * @module apps/web/src/pages/sales-documents
 */
import type { ReactElement } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Button } from '../../shared/ui/button';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { TimeDisplay } from '../../shared/ui/time-display';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { useConnectionsQuery } from '../../features/connections';
import {
  useFiscalRegistrationQuery,
  deriveFiscalReceiptDisplayStatus,
  FiscalReceiptStatusBadge,
  FiscalArtefactList,
} from '../../features/fiscalization';

export function FiscalReceiptDetailPage(): ReactElement {
  const { recordId } = useParams<{ recordId: string }>();
  const query = useFiscalRegistrationQuery(recordId ?? '');
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const connectionsById = new Map(connections.map((c) => [c.id, c.name]));

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Operations" title="Fiscal receipt">
        <p className="text-muted">Loading…</p>
      </PageLayout>
    );
  }

  if (query.error) {
    return (
      <PageLayout eyebrow="Operations" title="Fiscal receipt">
        <ErrorState
          title="Unable to load this fiscal receipt"
          message={query.error.message}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        />
      </PageLayout>
    );
  }

  const record = query.data;
  if (!record) {
    return (
      <PageLayout eyebrow="Operations" title="Fiscal receipt">
        <EmptyState
          title="Fiscal receipt not found"
          message="This record does not exist, or you don't have access to it."
          action={
            <Link className="button button--primary" to="/sales-documents">
              Back to sales documents
            </Link>
          }
        />
      </PageLayout>
    );
  }

  const displayStatus = deriveFiscalReceiptDisplayStatus(record);

  const fieldItems: KeyValueItem[] = [
    { id: 'provider', label: 'Provider', value: record.providerType },
    {
      id: 'connection',
      label: 'Connection',
      value: connectionsById.get(record.connectionId) ?? record.connectionId,
    },
    { id: 'documentReference', label: 'Document reference', value: record.documentReference ?? '—' },
    { id: 'providerReference', label: 'Provider reference', value: record.providerReference ?? '—' },
    {
      id: 'registeredAt',
      label: 'Registered',
      value: record.registeredAt ? <TimeDisplay iso={record.registeredAt} /> : '—',
    },
  ];

  return (
    <PageLayout
      eyebrow="Operations"
      title="Fiscal receipt"
      description={record.documentReference ?? record.id}
      actions={
        <Link className="orders-row-cta" to={`/orders/${record.orderId}#invoicing`}>
          Open order
        </Link>
      }
    >
      <div className="card">
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <FiscalReceiptStatusBadge status={displayStatus} />
        </div>
        {record.failureReason ? (
          <p className="text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            {record.failureReason}
          </p>
        ) : null}
        <KeyValueList items={fieldItems} />
      </div>

      {record.artefacts && record.artefacts.length > 0 ? (
        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <FiscalArtefactList artefacts={record.artefacts} />
        </div>
      ) : null}
    </PageLayout>
  );
}
