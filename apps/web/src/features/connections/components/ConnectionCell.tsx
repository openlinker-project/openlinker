/**
 * ConnectionCell — shared two-line connection identity cell (#1996, #2027).
 *
 * Line 1 composes `ConnectionEntityLabel` (name resolution, the link to
 * `/connections/:id` and its self-page suppression) beside the optional
 * adornment; line 2 pairs `CopyableId`'s shortened UUID with an
 * attention-only status note.
 *
 * `name` / `platformType` / `status` are page-supplied: a list page already
 * holds them from one batched `useConnectionsQuery()` read, and #1996 requires
 * the Connection column to cost one request per page rather than one per row.
 * The internal `useConnectionQuery` stays as the standalone fallback for a
 * caller that holds nothing but an id (#2027's own scope).
 */
import type { ReactElement, ReactNode } from 'react';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { shortenId } from '../../../shared/ui/entity-label';
import type { ConnectionStatus } from '../api/connections.types';
import { useConnectionQuery } from '../hooks/use-connection-query';
import { ConnectionEntityLabel } from './ConnectionEntityLabel';

/** What the cell resolved, handed back so an adornment needs no second lookup. */
export interface ConnectionCellFacts {
  connectionId: string;
  name: string | null;
  platformType: string | null;
  status: ConnectionStatus | null;
}

export interface ConnectionCellProps {
  connectionId: string;
  /** `undefined` = resolve internally; a value (including `null`) = page-supplied. */
  name?: string | null;
  platformType?: string | null;
  status?: ConnectionStatus | null;
  /**
   * Leading glyph on line 1 - a channel pill or `ConnectionDot`. The function
   * form receives the resolved connection so the consumer does not have to
   * re-resolve what this cell already knows.
   */
  adornment?: ReactNode | ((facts: ConnectionCellFacts) => ReactNode);
  className?: string;
}

const STATUS_NOTES: Record<Exclude<ConnectionStatus, 'active'>, string> = {
  disabled: 'Disabled',
  error: 'Error',
  needs_reauth: 'Reauth needed',
};

export function ConnectionCell({
  connectionId,
  name,
  platformType,
  status,
  adornment,
  className = '',
}: ConnectionCellProps): ReactElement {
  const nameSupplied = name !== undefined;
  const query = useConnectionQuery(connectionId, { enabled: !nameSupplied });

  if (!connectionId) return <EmptyValue />;

  const resolvedName = (nameSupplied ? name : query.data?.name) ?? null;
  const resolvedPlatformType = platformType ?? query.data?.platformType ?? null;
  const resolvedStatus = status ?? query.data?.status ?? null;
  const loading = !nameSupplied && query.isLoading;

  const adornmentNode =
    typeof adornment === 'function'
      ? adornment({
          connectionId,
          name: resolvedName,
          platformType: resolvedPlatformType,
          status: resolvedStatus,
        })
      : adornment;

  const statusNote =
    resolvedStatus && resolvedStatus !== 'active' ? STATUS_NOTES[resolvedStatus] : null;

  const copySubject = resolvedName ? `connection ID for ${resolvedName}` : 'connection ID';
  const classes = ['connection-cell', className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      <span className="connection-cell__body">
        <span className="connection-cell__line">
          {adornmentNode ? (
            <span className="connection-cell__adornment">{adornmentNode}</span>
          ) : null}
          <ConnectionEntityLabel
            connectionId={connectionId}
            name={resolvedName}
            loading={loading}
            showId={false}
            showCopy={false}
          />
        </span>
        <span className="connection-cell__meta">
          <CopyableId
            id={connectionId}
            label={shortenId(connectionId)}
            copyLabel={`Copy ${copySubject}`}
            copiedLabel={`Copied ${copySubject}`}
          />
          {statusNote ? (
            <span className={`connection-cell__status connection-cell__status--${resolvedStatus}`}>
              <span className="connection-cell__status-dot" aria-hidden="true" />
              {statusNote}
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}
