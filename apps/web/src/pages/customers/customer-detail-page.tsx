import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { useCustomerQuery } from '../../features/customers/hooks/use-customer-query';
import type { CustomerAddress } from '../../features/customers/api/customers.types';

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
      return parts ? <span>{parts}</span> : <span className="text-muted">—</span>;
    },
  },
  {
    id: 'city',
    header: 'City',
    cell: (a) => a.city ?? <span className="text-muted">—</span>,
  },
  {
    id: 'postcode',
    header: 'Postcode',
    cell: (a) => a.postcode ?? <span className="text-muted">—</span>,
  },
  {
    id: 'countryIso2',
    header: 'Country',
    cell: (a) => a.countryIso2 ?? <span className="text-muted">—</span>,
  },
  {
    id: 'lastSeenAt',
    header: 'Last Seen',
    cell: (a) => new Date(a.lastSeenAt).toLocaleDateString(),
  },
];

export function CustomerDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useCustomerQuery(id);

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
      eyebrow="Customers"
      title={name || customer.internalCustomerId}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to customers
        </Link>
      }
    >
      <section className="detail-section">
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Customer ID</dt>
            <dd><span className="mono-text">{customer.internalCustomerId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Email Hash</dt>
            <dd><span className="mono-text">{customer.emailHash}</span></dd>
          </div>
          {customer.normalizedEmail ? (
            <div className="detail-list__row">
              <dt>Normalized Email</dt>
              <dd><span className="mono-text">{customer.normalizedEmail}</span></dd>
            </div>
          ) : null}
          <div className="detail-list__row">
            <dt>First Name</dt>
            <dd>{customer.firstName ?? <span className="text-muted">—</span>}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Last Name</dt>
            <dd>{customer.lastName ?? <span className="text-muted">—</span>}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Last Source Connection</dt>
            <dd>
              {customer.lastSourceConnectionId ? (
                <span className="mono-text">{customer.lastSourceConnectionId}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Last Seen</dt>
            <dd>{new Date(customer.lastSeenAt).toLocaleString()}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Created</dt>
            <dd>{new Date(customer.createdAt).toLocaleString()}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Updated</dt>
            <dd>{new Date(customer.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
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
