import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { EntityLabel } from '../../../shared/ui/entity-label';
import { useConnectionQuery } from '../hooks/use-connection-query';
import { SYSTEM_CONNECTION_ID } from '../api/connections.types';

interface ConnectionEntityLabelProps {
  className?: string;
  connectionId: string;
  linkToDetail?: boolean;
  /**
   * Caller-resolved name. `undefined` means "resolve it yourself" (the
   * detail-page convention); passing a value - including `null` for a
   * connection that could not be resolved - suppresses the per-row fetch so a
   * list page can serve every row from one batched read (#1996).
   */
  name?: string | null;
  loading?: boolean;
  showId?: boolean;
  showCopy?: boolean;
}

export function ConnectionEntityLabel({
  className,
  connectionId,
  linkToDetail = true,
  name,
  loading,
  showId = true,
  showCopy = true,
}: ConnectionEntityLabelProps): ReactElement | null {
  const location = useLocation();
  const isSystem = connectionId === SYSTEM_CONNECTION_ID;
  const nameSupplied = name !== undefined || isSystem;
  const query = useConnectionQuery(connectionId, { enabled: !nameSupplied });

  if (!connectionId) return null;

  // The all-zero placeholder id is never a real connection - resolving it
  // would always 404 and render "Unknown", indistinguishable from a genuinely
  // deleted/inaccessible connection. Render it as a system job instead.
  if (isSystem) {
    // Deliberately ignores the caller's showId/showCopy props: the all-zero
    // id is a placeholder, not a real connection id - there is nothing
    // meaningful to show or copy.
    return (
      <EntityLabel
        id={connectionId}
        name="System"
        nameTitle="Not tied to a specific connection"
        showId={false}
        showCopy={false}
        className={className}
      />
    );
  }

  const targetPath = `/connections/${connectionId}`;
  const isSelfPage = location.pathname === targetPath;
  const shouldLink = linkToDetail && !isSelfPage;

  return (
    <EntityLabel
      id={connectionId}
      name={nameSupplied ? name : query.data?.name}
      loading={loading ?? (!nameSupplied && query.isLoading)}
      showId={showId}
      showCopy={showCopy}
      to={shouldLink ? targetPath : undefined}
      className={className}
    />
  );
}
