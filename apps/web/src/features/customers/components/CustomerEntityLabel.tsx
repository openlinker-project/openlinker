import type { ReactElement } from 'react';
import { EntityLabel } from '../../../shared/ui/entity-label';
import { useCustomerQuery } from '../hooks/use-customer-query';

interface CustomerEntityLabelProps {
  className?: string;
  customerId: string;
  showId?: boolean;
}

export function CustomerEntityLabel({
  className,
  customerId,
  showId = true,
}: CustomerEntityLabelProps): ReactElement | null {
  const query = useCustomerQuery(customerId);

  if (!customerId) return null;

  const name =
    query.data?.firstName || query.data?.lastName
      ? [query.data.firstName, query.data.lastName].filter(Boolean).join(' ')
      : null;

  return (
    <EntityLabel
      id={customerId}
      name={name}
      loading={query.isLoading}
      showId={showId}
      to={`/customers/${customerId}`}
      className={className}
    />
  );
}
