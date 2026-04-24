import type { ReactElement } from 'react';
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

function buildCustomerItems(customer: {
  internalCustomerId: string;
  emailHash: string;
  normalizedEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  lastSourceConnectionId: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}): KeyValueItem[] {
  const items: KeyValueItem[] = [
    { id: 'id', label: 'Customer ID', value: customer.internalCustomerId, mono: true },
    { id: 'emailHash', label: 'Email Hash', value: customer.emailHash, mono: true },
  ];

  if (customer.normalizedEmail) {
    items.push({
      id: 'normalizedEmail',
      label: 'Normalized Email',
      value: customer.normalizedEmail,
      mono: true,
    });
  }

  items.push(
    { id: 'firstName', label: 'First Name', value: customer.firstName ?? <EmptyValue /> },
    { id: 'lastName', label: 'Last Name', value: customer.lastName ?? <EmptyValue /> },
    {
      id: 'lastSource',
      label: 'Last Source Connection',
      value: customer.lastSourceConnectionId ? (
        <ConnectionEntityLabel connectionId={customer.lastSourceConnectionId} />
      ) : (
        <EmptyValue />
      ),
    },
    { id: 'lastSeen', label: 'Last Seen', value: <TimeDisplay iso={customer.lastSeenAt} /> },
    { id: 'createdAt', label: 'Created', value: <TimeDisplay iso={customer.createdAt} /> },
    { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={customer.updatedAt} /> },
  );

  return items;
}

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
};

const CUSTOMER_ORDER_COLUMNS: DataTableColumn<OrderRecord>[] = [
  {
    id: 'internalOrderId',
    header: 'Order ID',
    cell: (order) => <span className="mono-text">{order.internalOrderId}</span>,
  },
  {
    id: 'syncStatus',
    header: 'Status',
    cell: (order) => {
      const first = order.syncStatus[0];
      if (!first) return <EmptyValue />;
      return (
        <StatusBadge tone={SYNC_STATUS_TONES[first.status]} compact>
          {first.status}
        </StatusBadge>
      );
    },
  },
  {
    id: 'sourceConnection',
    header: 'Source',
    cell: (order) => (
      <ConnectionEntityLabel connectionId={order.sourceConnectionId} showId={false} />
    ),
    hideBelow: 768,
  },
  {
    id: 'createdAt',
    header: 'Created',
    cell: (order) => <TimeDisplay iso={order.createdAt} format="date" />,
    accessor: (order) => order.createdAt,
    sortable: true,
  },
];

const ADDRESS_COLUMNS: DataTableColumn<CustomerAddress>[] = [
  {
    id: 'addressType',
    header: 'Type',
    cell: (a) => <span className="mono-text">{a.addressType}</span>,
  },
  {
    id: 'address1',
    header: 'Address',
    cell: (a) => {
      const parts = [a.address1, a.address2].filter(Boolean).join(', ');
      return parts ? <span>{parts}</span> : <EmptyValue />;
    },
  },
  {
    id: 'city',
    header: 'City',
    cell: (a) => a.city ?? <EmptyValue />,
  },
  {
    id: 'postcode',
    header: 'Postcode',
    cell: (a) => a.postcode ?? <EmptyValue />,
  },
  {
    id: 'countryIso2',
    header: 'Country',
    cell: (a) => a.countryIso2 ?? <EmptyValue />,
  },
  {
    id: 'lastSeenAt',
    header: 'Last Seen',
    cell: (a) => <TimeDisplay iso={a.lastSeenAt} format="date" />,
  },
];

export function CustomerDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useCustomerQuery(id);
  const ordersQuery = useOrdersQuery(id ? { customerId: id } : undefined, { limit: 20 });

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Customers" title="Customer">
        <LoadingState liveRegion="off" title="Loading customer" message="Fetching customer details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Customers" title="Customer">
        <ErrorState
          title="Unable to load customer"
          message={query.error?.message ?? 'Customer not found'}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      </PageLayout>
    );
  }

  const customer = query.data;
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');

  return (
    <PageLayout
      backTo={{ to: '/customers', label: 'Customers' }}
      eyebrow="Customers"
      title={<EntityLabel id={customer.internalCustomerId} name={name || null} />}
    >
      <section className="detail-section">
        <KeyValueList items={buildCustomerItems(customer)} />
      </section>

      <section className="detail-section">
        <h2 className="detail-section__title">
          Orders{ordersQuery.data ? ` (${ordersQuery.data.total})` : ''}
        </h2>
        {ordersQuery.isLoading ? (
          <LoadingState
            liveRegion="off"
            title="Loading orders"
            message="Fetching orders placed by this customer…"
          />
        ) : ordersQuery.error ? (
          <ErrorState
            title="Unable to load customer orders"
            message={ordersQuery.error.message}
            action={<Button onClick={() => { void ordersQuery.refetch(); }}>Retry</Button>}
          />
        ) : (ordersQuery.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            liveRegion="off"
            title="No orders yet"
            message="This customer has no orders on record."
          />
        ) : (
          <DataTable
            caption="Customer orders"
            columns={CUSTOMER_ORDER_COLUMNS}
            rows={ordersQuery.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
            rowHref={(order) => `/orders/${order.internalOrderId}`}
          />
        )}
      </section>

      <section className="detail-section">
        <h2 className="detail-section__title">Addresses</h2>
        {customer.addresses.length === 0 ? (
          <EmptyState
            liveRegion="off"
            title="No addresses"
            message="No address projections have been recorded for this customer."
          />
        ) : (
          <DataTable
            caption="Customer addresses"
            columns={ADDRESS_COLUMNS}
            rows={customer.addresses}
            rowKey={(a) => a.addressHash}
          />
        )}
      </section>
    </PageLayout>
  );
}
