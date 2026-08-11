/**
 * ConnectionCell — shared two-line connection identity cell (#1996, #2027).
 *
 * Line 1 reuses `EntityLabel` (name resolution, loading state, link to
 * `/connections/:id`) with `showId={false}`. Line 2 reuses `CopyableId` for
 * the shortened UUID plus the hover-reveal Copy affordance. `EntityLabel`
 * always renders its own (always-visible) Copy button regardless of
 * `showId` — left in place here rather than reimplementing the name/link
 * composition by hand, but suppressed visually via the `.connection-cell
 * .entity-label__copy` rule in index.css, since `CopyableId`'s hover-reveal
 * button on line 2 is the cell's single intended copy action (matches the
 * #1996 mockup, which shows exactly one Copy control per cell).
 *
 * Resolves its own `connectionId -> name` via `useConnectionQuery`, one
 * request per row — the same per-row fetch `ConnectionEntityLabel` uses.
 * A page-supplied name (from a single batched `useConnectionsQuery()` map)
 * is the eventual list-page optimization #1996 describes, but wiring that
 * through is deferred to the follow-up issue that consumes this component
 * on an actual page (#2027 is standalone-component scope only).
 */
import type { ReactElement, ReactNode } from 'react';
import { EntityLabel, shortenId } from '../../../shared/ui/entity-label';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { useConnectionQuery } from '../hooks/use-connection-query';

export interface ConnectionCellProps {
  connectionId: string;
  /** Optional leading glyph — e.g. a channel pill or connection dot. */
  adornment?: ReactNode;
  className?: string;
}

export function ConnectionCell({
  connectionId,
  adornment,
  className = '',
}: ConnectionCellProps): ReactElement | null {
  const query = useConnectionQuery(connectionId);

  if (!connectionId) return null;

  const classes = ['connection-cell', className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {adornment ? <span className="connection-cell__adornment">{adornment}</span> : null}
      <span className="connection-cell__body">
        <EntityLabel
          id={connectionId}
          name={query.data?.name}
          loading={query.isLoading}
          showId={false}
          to={`/connections/${connectionId}`}
        />
        <CopyableId id={connectionId} label={shortenId(connectionId)} />
      </span>
    </span>
  );
}
