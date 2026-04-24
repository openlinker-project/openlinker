/**
 * Order Customer Card
 *
 * Third column of the order detail primary grid. Renders a quick customer
 * summary for the current order — name, email (or email-hash chip under
 * PII hash-only mode), last-seen, previous-order count, and a link out
 * to the customer detail page. When the order has no linked customer,
 * shows a muted inline explanation rather than an empty card; when a
 * `sourceConnectionId` is supplied, the empty state offers a jump to the
 * connection's failed-orders view so the operator has somewhere to go.
 *
 * Handles the full four-state pattern (`fe-pages.md`) — loading, error,
 * empty/null, data — without blocking the rest of the order page when
 * the customer query fails.
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useCustomerQuery } from '../../customers/hooks/use-customer-query';
import { useOrdersQuery } from '../hooks/use-orders-query';

interface OrderCustomerCardProps {
  customerId: string | null;
  /**
   * When provided on the null-customer path, the empty-state offers a link
   * to the failed-orders view filtered to this connection — matching the
   * wayfinding surface described in #382 §1.
   */
  sourceConnectionId?: string | null;
}

const ORDERS_COUNT_STALE_MS = 30_000;
const EMAIL_HASH_CHIP_LENGTH = 10;

export function OrderCustomerCard({
  customerId,
  sourceConnectionId,
}: OrderCustomerCardProps): ReactElement {
  if (customerId === null) {
    return (
      <section className="order-customer-card order-customer-card--empty" aria-label="Customer">
        <p className="order-customer-card__empty-body text-muted">
          No customer linked — order may be a guest checkout or customer resolution failed.
        </p>
        {sourceConnectionId ? (
          <Link
            to={`/orders/failed?connectionId=${encodeURIComponent(sourceConnectionId)}`}
            className="order-customer-card__empty-link"
          >
            View failed orders →
          </Link>
        ) : null}
      </section>
    );
  }
  return <OrderCustomerCardLinked customerId={customerId} />;
}

function OrderCustomerCardLinked({ customerId }: { customerId: string }): ReactElement {
  const customerQuery = useCustomerQuery(customerId);
  // Staletime pinned so sibling-order nav within the same customer doesn't
  // refetch this count on every mount — see #382 tech review.
  const ordersCountQuery = useOrdersQuery(
    { customerId },
    { limit: 1, offset: 0 },
    { staleTime: ORDERS_COUNT_STALE_MS },
  );

  if (customerQuery.isLoading) {
    return (
      <section className="order-customer-card" aria-label="Customer" aria-busy="true">
        <header className="order-customer-card__header">
          <span className="order-customer-card__label">Customer</span>
        </header>
        <p className="order-customer-card__name order-customer-card__name--loading">…</p>
        <p className="order-customer-card__email order-customer-card__email--loading">…</p>
      </section>
    );
  }

  if (customerQuery.error) {
    return (
      <section className="order-customer-card" aria-label="Customer">
        <header className="order-customer-card__header">
          <span className="order-customer-card__label">Customer</span>
        </header>
        <p className="order-customer-card__error text-muted">
          Couldn&rsquo;t load customer details.
        </p>
        <Button
          tone="secondary"
          onClick={() => {
            void customerQuery.refetch();
          }}
        >
          Retry
        </Button>
      </section>
    );
  }

  const customer = customerQuery.data;
  // The API returns 200 + null body when a customer isn't found (see api
  // client). Treat that as a not-found state, same as the mock client's
  // default `null` resolution.
  if (!customer) {
    return (
      <section className="order-customer-card" aria-label="Customer">
        <header className="order-customer-card__header">
          <span className="order-customer-card__label">Customer</span>
        </header>
        <p className="order-customer-card__error text-muted">Customer record not found.</p>
      </section>
    );
  }

  const displayName =
    [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || null;
  // Only subtract the current order from the count once the list has actually
  // been fetched, otherwise the "Previous orders" row can briefly flash -1→0
  // during the eventual-consistency window right after order creation.
  const previousOrdersCount =
    ordersCountQuery.isFetched && ordersCountQuery.data
      ? Math.max(ordersCountQuery.data.total - 1, 0)
      : 0;

  return (
    <section className="order-customer-card" aria-label="Customer">
      <header className="order-customer-card__header">
        <span className="order-customer-card__label">Customer</span>
        <Link
          to={`/customers/${customerId}`}
          className="order-customer-card__view"
          aria-label="View customer"
        >
          View customer →
        </Link>
      </header>

      <p className="order-customer-card__name">
        {displayName ?? <span className="text-muted">Unknown name</span>}
      </p>

      <p className="order-customer-card__email">
        {customer.normalizedEmail ? (
          <span>{customer.normalizedEmail}</span>
        ) : (
          <code className="order-customer-card__hash mono-text" title={customer.emailHash}>
            {customer.emailHash.slice(0, EMAIL_HASH_CHIP_LENGTH)}…
          </code>
        )}
      </p>

      <dl className="order-customer-card__meta">
        <div className="order-customer-card__meta-row">
          <dt>Last seen</dt>
          <dd>
            <TimeDisplay iso={customer.lastSeenAt} />
          </dd>
        </div>
        {previousOrdersCount > 0 ? (
          <div className="order-customer-card__meta-row">
            <dt>Previous orders</dt>
            <dd>
              <Link to={`/customers/${customerId}`} className="order-customer-card__meta-link">
                {previousOrdersCount}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
