import { useMemo, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { EmptyValue } from '../../shared/ui/empty-value';
import { EntityLabel } from '../../shared/ui/entity-label';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useCustomerQuery } from '../../features/customers/hooks/use-customer-query';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import type { CustomerAddress } from '../../features/customers/api/customers.types';
import type {
  OrderRecord,
  OrderSyncStatusValue,
} from '../../features/orders/api/orders.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { interpolate, labelFor, useFormat, useMessages } from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

type CustomerDetailCopy = ReturnType<typeof useMessages<'customers'>>['customerDetailPage'];

function buildCustomerItems(
  copy: CustomerDetailCopy['fields'],
  customer: {
  internalCustomerId: string;
  emailHash: string;
  normalizedEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  lastSourceConnectionId: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  },
): KeyValueItem[] {
  const items: KeyValueItem[] = [
    { id: 'id', label: copy.customerId, value: customer.internalCustomerId, mono: true },
    { id: 'emailHash', label: copy.emailHash, value: customer.emailHash, mono: true },
  ];

  if (customer.normalizedEmail) {
    items.push({
      id: 'normalizedEmail',
      label: copy.normalizedEmail,
      value: customer.normalizedEmail,
      mono: true,
    });
  }

  items.push(
    { id: 'firstName', label: copy.firstName, value: customer.firstName ?? <EmptyValue /> },
    { id: 'lastName', label: copy.lastName, value: customer.lastName ?? <EmptyValue /> },
    {
      id: 'lastSource',
      label: copy.lastSource,
      value: customer.lastSourceConnectionId ? (
        <ConnectionEntityLabel connectionId={customer.lastSourceConnectionId} />
      ) : (
        <EmptyValue />
      ),
    },
    { id: 'lastSeen', label: copy.lastSeen, value: <TimeDisplay iso={customer.lastSeenAt} /> },
    { id: 'createdAt', label: copy.created, value: <TimeDisplay iso={customer.createdAt} /> },
    { id: 'updatedAt', label: copy.updated, value: <TimeDisplay iso={customer.updatedAt} /> },
  );

  return items;
}

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
  // #2284 — provisioning withheld because the source cancelled; never an error.
  skipped_cancelled: 'neutral',
};

function buildOrderColumns(copy: CustomerDetailCopy['orders']): DataTableColumn<OrderRecord>[] {
  return [
  {
    id: 'internalOrderId',
    header: copy.columns.orderId,
    cell: (order) => <span className="mono-text">{order.internalOrderId}</span>,
  },
  {
    id: 'syncStatus',
    header: copy.columns.status,
    cell: (order): ReactElement => {
      const first = order.syncStatus[0];
      if (!first) return <EmptyValue />;
      return (
        <StatusBadge tone={SYNC_STATUS_TONES[first.status]} compact>
          {labelFor(copy.syncStatus, first.status)}
        </StatusBadge>
      );
    },
  },
  {
    id: 'sourceConnection',
    header: copy.columns.source,
    cell: (order) => (
      <ConnectionEntityLabel connectionId={order.sourceConnectionId} showId={false} />
    ),
    hideBelow: 768,
  },
  {
    id: 'createdAt',
    header: copy.columns.created,
    cell: (order) => <TimeDisplay iso={order.createdAt} format="date" />,
    accessor: (order) => order.createdAt,
    sortable: true,
  },
  ];
}

function buildAddressColumns(
  copy: CustomerDetailCopy['addresses']['columns'],
): DataTableColumn<CustomerAddress>[] {
  return [
  {
    id: 'addressType',
    header: copy.type,
    cell: (a) => <span className="mono-text">{a.addressType}</span>,
  },
  {
    id: 'address1',
    header: copy.address,
    cell: (a): ReactElement => {
      const parts = [a.address1, a.address2].filter(Boolean).join(', ');
      return parts ? <span>{parts}</span> : <EmptyValue />;
    },
  },
  {
    id: 'city',
    header: copy.city,
    cell: (a) => a.city ?? <EmptyValue />,
  },
  {
    id: 'postcode',
    header: copy.postcode,
    cell: (a) => a.postcode ?? <EmptyValue />,
  },
  {
    id: 'countryIso2',
    header: copy.country,
    cell: (a) => a.countryIso2 ?? <EmptyValue />,
  },
  {
    id: 'lastSeenAt',
    header: copy.lastSeen,
    cell: (a) => <TimeDisplay iso={a.lastSeenAt} format="date" />,
  },
  ];
}

export function CustomerDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useCustomerQuery(id);
  const ordersQuery = useOrdersQuery(id ? { customerId: id } : undefined, { limit: 20 });
  const copy = useMessages('customers').customerDetailPage;
  const format = useFormat();
  const orderColumns = useMemo(() => buildOrderColumns(copy.orders), [copy]);
  const addressColumns = useMemo(() => buildAddressColumns(copy.addresses.columns), [copy]);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <LoadingState
          liveRegion="off"
          title={copy.loading.title}
          message={copy.loading.message}
        />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <ErrorState
          title={copy.error.title}
          message={query.error ? describeApiError(query.error, 'customers') : copy.error.notFound}
          action={<Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>}
        />
      </PageLayout>
    );
  }

  const customer = query.data;
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');

  return (
    <PageLayout
      backTo={{ to: '/customers', label: copy.eyebrow }}
      eyebrow={copy.eyebrow}
      title={<EntityLabel id={customer.internalCustomerId} name={name || null} />}
    >
      <section className="detail-section">
        <KeyValueList items={buildCustomerItems(copy.fields, customer)} />
      </section>

      <section className="detail-section">
        <h2 className="detail-section__title">
          {ordersQuery.data
            ? interpolate(copy.orders.headingWithCount, {
                count: format.number(ordersQuery.data.total),
              })
            : copy.orders.heading}
        </h2>
        {ordersQuery.isLoading ? (
          <LoadingState
            liveRegion="off"
            title={copy.orders.loading.title}
            message={copy.orders.loading.message}
          />
        ) : ordersQuery.error ? (
          <ErrorState
            title={copy.orders.error.title}
            message={describeApiError(ordersQuery.error, 'customers')}
            action={<Button onClick={() => { void ordersQuery.refetch(); }}>{copy.retry}</Button>}
          />
        ) : (ordersQuery.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            liveRegion="off"
            title={copy.orders.empty.title}
            message={copy.orders.empty.message}
          />
        ) : (
          <DataTable
            caption={copy.orders.caption}
            columns={orderColumns}
            rows={ordersQuery.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
            rowHref={(order) => `/orders/${order.internalOrderId}`}
          />
        )}
      </section>

      <section className="detail-section">
        <h2 className="detail-section__title">{copy.addresses.heading}</h2>
        {customer.addresses.length === 0 ? (
          <EmptyState
            liveRegion="off"
            title={copy.addresses.empty.title}
            message={copy.addresses.empty.message}
          />
        ) : (
          <DataTable
            caption={copy.addresses.caption}
            columns={addressColumns}
            rows={customer.addresses}
            rowKey={(a) => a.addressHash}
          />
        )}
      </section>
    </PageLayout>
  );
}
