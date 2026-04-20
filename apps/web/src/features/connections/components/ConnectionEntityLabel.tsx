import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
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
}: ConnectionEntityLabelProps): ReactElement | null {
  const location = useLocation();
  const query = useConnectionQuery(connectionId);

  if (!connectionId) return null;

  const targetPath = `/connections/${connectionId}`;
  const isSelfPage = location.pathname === targetPath;
  const shouldLink = linkToDetail && !isSelfPage;

  return (
    <EntityLabel
      id={connectionId}
      name={query.data?.name}
      loading={query.isLoading}
      showId={showId}
      to={shouldLink ? targetPath : undefined}
      className={className}
    />
  );
}
