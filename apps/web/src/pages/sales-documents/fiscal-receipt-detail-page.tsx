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
import { useMessages } from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

export function FiscalReceiptDetailPage(): ReactElement {
  const copy = useMessages('sales-documents').fiscalReceiptDetailPage;
  const { recordId } = useParams<{ recordId: string }>();
  const query = useFiscalRegistrationQuery(recordId ?? '');
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const connectionsById = new Map(connections.map((c) => [c.id, c.name]));

  if (query.isLoading) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title}>
        <p className="text-muted">{copy.loading}</p>
      </PageLayout>
    );
  }

  if (query.error) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title}>
        <ErrorState
          title={copy.loadError}
          message={describeApiError(query.error, 'sales-documents')}
          action={<Button onClick={() => void query.refetch()}>{copy.retry}</Button>}
        />
      </PageLayout>
    );
  }

  const record = query.data;
  if (!record) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title}>
        <EmptyState
          title={copy.notFound.title}
          message={copy.notFound.message}
          action={
            <Link className="button button--primary" to="/sales-documents">
              {copy.notFound.back}
            </Link>
          }
        />
      </PageLayout>
    );
  }

  const displayStatus = deriveFiscalReceiptDisplayStatus(record);

  const fieldItems: KeyValueItem[] = [
    { id: 'provider', label: copy.fields.provider, value: record.providerType },
    {
      id: 'connection',
      label: copy.fields.connection,
      value: connectionsById.get(record.connectionId) ?? record.connectionId,
    },
    { id: 'documentReference', label: copy.fields.documentReference, value: record.documentReference ?? copy.empty },
    { id: 'providerReference', label: copy.fields.providerReference, value: record.providerReference ?? copy.empty },
    {
      id: 'registeredAt',
      label: copy.fields.registered,
      value: record.registeredAt ? <TimeDisplay iso={record.registeredAt} /> : copy.empty,
    },
  ];

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={record.documentReference ?? record.id}
      actions={
        <Link className="orders-row-cta" to={`/orders/${record.orderId}#invoicing`}>
          {copy.openOrder}
        </Link>
      }
    >
      <div className="card">
        <div className="fiscal-receipt-detail__status">
          <FiscalReceiptStatusBadge status={displayStatus} />
        </div>
        {record.failureReason ? (
          <p className="text-muted fiscal-receipt-detail__failure-reason">{record.failureReason}</p>
        ) : null}
        <KeyValueList items={fieldItems} />
      </div>

      {record.artefacts && record.artefacts.length > 0 ? (
        <div className="card fiscal-receipt-detail__artefacts">
          <FiscalArtefactList artefacts={record.artefacts} />
        </div>
      ) : null}
    </PageLayout>
  );
}
