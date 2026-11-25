import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { displayConnectionName } from '../../../shared/lib/display-connection-name';
import { EntityLabel } from '../../../shared/ui/entity-label';
import { useConnectionQuery } from '../hooks/use-connection-query';
import { isSystemConnectionId, resolveConnectionLinkTarget } from '../lib/connection-link-target';

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
  // The all-zero placeholder id is never a real connection - resolving it
  // would always 404 and render "Unknown", indistinguishable from a genuinely
  // deleted/inaccessible connection - so it is never fetched.
  const nameSupplied = name !== undefined || isSystemConnectionId(connectionId);
  const query = useConnectionQuery(connectionId, { enabled: !nameSupplied });

  if (!connectionId) return null;

  const target = resolveConnectionLinkTarget({
    connectionId,
    name: (nameSupplied ? name : query.data?.name) ?? null,
    loading: loading ?? (!nameSupplied && query.isLoading),
    pathname: location.pathname,
    linkToDetail,
  });

  const shortName = target.displayName === null ? null : displayConnectionName(target.displayName);
  const fullNameTitle =
    target.displayName !== null && target.displayName !== shortName ? target.displayName : undefined;

  return (
    <EntityLabel
      id={connectionId}
      name={shortName}
      nameTitle={target.title ?? fullNameTitle}
      loading={target.loading}
      // The caller's showId/showCopy are ignored for System: the all-zero id is
      // a placeholder, not a real connection id - nothing meaningful to show or copy.
      showId={target.system ? false : showId}
      showCopy={target.system ? false : showCopy}
      to={target.linked ? target.targetPath : undefined}
      className={className}
    />
  );
}
