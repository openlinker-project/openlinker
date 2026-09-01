/**
 * ConnectionCell — shared two-line connection identity cell (#1996, #2027).
 *
 * Line 1 composes `ConnectionEntityLabel` (name resolution, the link to
 * `/connections/:id` and its self-page suppression) beside the optional
 * adornment; line 2 pairs `CopyableId`'s shortened UUID with an
 * attention-only status note.
 *
 * The page-supplied facts arrive as ONE object because they are correlated: a
 * list page already holds the whole `Connection` from a batched
 * `useConnectionsQuery()` read (#1996 requires the Connection column to cost
 * one request per page, not one per row), and supplying only part of it used to
 * disable the internal query while leaving the status unresolved - silently
 * dropping the operator-facing status note on exactly the batched path the AC
 * demands. The internal `useConnectionQuery` stays as the standalone fallback
 * for a caller that holds nothing but an id (#2027's own scope).
 */
import type { ReactElement, ReactNode } from 'react';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { shortenId } from '../../../shared/ui/entity-label';
import { SYSTEM_CONNECTION_ID, type ConnectionStatus } from '../api/connections.types';
import { useConnectionQuery } from '../hooks/use-connection-query';
import { ConnectionEntityLabel } from './ConnectionEntityLabel';

/** The connection facts this cell renders. A whole `Connection` satisfies it. */
export interface ConnectionCellFacts {
  name: string;
  status: ConnectionStatus;
}

export interface ConnectionCellProps {
  connectionId: string;
  /**
   * `undefined` = resolve internally; a value = page-supplied, and `null`
   * specifically means "the page looked and this connection is unknown", which
   * renders the Unknown label without a per-row fetch.
   *
   * A list page MUST coalesce its lookup: `connectionsById.get(id)` and
   * `connections.find(...)` both return `undefined` on a miss, which this cell
   * reads as "resolve it yourself" and would silently reinstate the per-row
   * fetch #1996 rejected. Pass `connection={map.get(id) ?? null}` together with
   * `loading={connectionsQuery.isLoading}`, so an unresolved row renders Unknown
   * and a not-yet-loaded one renders the loading state instead.
   */
  connection?: ConnectionCellFacts | null;
  /**
   * Page-supplied loading state, for the window before the batched connections
   * query settles. Without it a page that coalesces to `null` (as it must)
   * would render a column of "Unknown" on every cold load - indistinguishable
   * from a genuinely deleted connection.
   */
  loading?: boolean;
  /**
   * Leading glyph on line 1 - a channel pill or `ConnectionDot`. The cell ships
   * no built-in channel signal, so pass one on any list where two connections
   * can share a `platformType`: otherwise the only disambiguators between two
   * same-platform shops are the operator-authored name and a shortened id.
   */
  adornment?: ReactNode;
  className?: string;
}

// "Re-auth" rather than the app's longer "Re-authentication required": line 2's
// fixed cost (shortened id + copy control) leaves ~58px inside the 220px cap, so
// a longer label truncates on every affected row.
const STATUS_NOTES: Record<Exclude<ConnectionStatus, 'active'>, string> = {
  disabled: 'Disabled',
  error: 'Error',
  needs_reauth: 'Re-auth',
};

export function ConnectionCell({
  connectionId,
  connection,
  loading: loadingProp = false,
  adornment,
  className = '',
}: ConnectionCellProps): ReactElement {
  // The all-zero placeholder id (#2745) is never a real connection - line 1
  // already renders "System" via ConnectionEntityLabel's own special case, so
  // line 2's copyable id + status note (which describe a real connection)
  // are suppressed rather than shown against a placeholder.
  const isSystem = connectionId === SYSTEM_CONNECTION_ID;
  const factsSupplied = connection !== undefined || isSystem;
  const query = useConnectionQuery(connectionId, { enabled: !factsSupplied });

  if (!connectionId) return <EmptyValue />;

  const facts: ConnectionCellFacts | null =
    connection !== undefined ? connection : (query.data ?? null);
  const resolvedName = facts?.name ?? null;
  const resolvedStatus = facts?.status ?? null;
  const loading = loadingProp || (!factsSupplied && query.isLoading);

  const statusNote =
    resolvedStatus && resolvedStatus !== 'active' ? STATUS_NOTES[resolvedStatus] : null;

  const copySubject = resolvedName ? `connection ID for ${resolvedName}` : 'connection ID';
  const classes = ['connection-cell', className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      <span className="connection-cell__body">
        <span className="connection-cell__line">
          {adornment ? <span className="connection-cell__adornment">{adornment}</span> : null}
          <ConnectionEntityLabel
            connectionId={connectionId}
            name={resolvedName}
            loading={loading}
            showId={false}
            showCopy={false}
          />
        </span>
        {isSystem ? null : (
          <span className="connection-cell__meta">
            <CopyableId
              id={connectionId}
              label={shortenId(connectionId)}
              copyLabel={`Copy ${copySubject}`}
              copiedLabel={`Copied ${copySubject}`}
            />
            {statusNote ? (
              <span
                className={`connection-cell__status connection-cell__status--${resolvedStatus}`}
              >
                <span className="connection-cell__status-dot" aria-hidden="true" />
                <span className="connection-cell__status-label" title={statusNote}>
                  {statusNote}
                </span>
              </span>
            ) : null}
          </span>
        )}
      </span>
    </span>
  );
}
