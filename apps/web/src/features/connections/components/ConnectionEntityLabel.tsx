import type { ReactElement } from 'react';
import { EntityLabel } from '../../../shared/ui/entity-label';
import { useConnectionQuery } from '../hooks/use-connection-query';

interface ConnectionEntityLabelProps {
  className?: string;
  connectionId: string;
  linkToDetail?: boolean;
  showId?: boolean;
}

export function ConnectionEntityLabel({
  className,
  connectionId,
  linkToDetail = true,
  showId = true,
}: ConnectionEntityLabelProps): ReactElement {
  const query = useConnectionQuery(connectionId);

  return (
    <EntityLabel
      id={connectionId}
      name={query.data?.name}
      loading={query.isLoading}
      showId={showId}
      to={linkToDetail ? `/connections/${connectionId}` : undefined}
      className={className}
    />
  );
}
