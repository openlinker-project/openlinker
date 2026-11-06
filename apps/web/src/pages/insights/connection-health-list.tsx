/**
 * Connection health list (#4016).
 *
 * One row per connection, laid out as a fixed-column table so the platform,
 * status and failed-jobs columns line up from row to row whatever the name's
 * length. The previous flex row put the status badge at the far right when a
 * row had no failed jobs and in the middle when it had some.
 *
 * The platform is the shared `ConnectionChip` (#3670), the same chip the
 * Orders and Products lists use, so a connection reads the same everywhere.
 *
 * @module pages/insights
 */
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ConnectionChip, readConnectionEnvironment } from '../../features/connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import { usePlatforms } from '../../shared/plugins';
import {
  CONNECTION_STATUS_LABEL,
  bucketOf,
  describeConnectionHealth,
  sortConnectionHealthRows,
  summarizeConnectionHealth,
  type ConnectionHealthRow,
} from './connection-health';

export function ConnectionHealthList({
  rows,
}: {
  rows: readonly ConnectionHealthRow[];
}): ReactElement {
  const platforms = usePlatforms();
  const sorted = useMemo(() => sortConnectionHealthRows(rows), [rows]);
  const summary = useMemo(() => summarizeConnectionHealth(rows), [rows]);

  if (rows.length === 0) {
    return (
      <p className="muted-text">
        No connections configured. <Link to="/connections/new">Add the first connection.</Link>
      </p>
    );
  }

  const legend = [
    summary.attention > 0 ? `${summary.attention} need attention` : null,
    summary.healthy > 0 ? `${summary.healthy} healthy` : null,
    summary.off > 0 ? `${summary.off} disabled` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="conn-health">
      <div className="conn-health__summary">
        <p className="conn-health__sentence" data-testid="connection-health-summary">
          {describeConnectionHealth(summary)}
        </p>
        <div className="health-strip" role="img" aria-label={legend.join(', ')}>
          {sorted.map((row) => (
            <span
              key={row.connection.id}
              className={`health-strip__segment health-strip__segment--${bucketOf(row)}`}
            />
          ))}
        </div>
        <ul className="health-legend" aria-hidden="true">
          {summary.attention > 0 ? (
            <li className="health-legend__item health-legend__item--attention">
              {summary.attention} need attention
            </li>
          ) : null}
          {summary.healthy > 0 ? (
            <li className="health-legend__item health-legend__item--healthy">
              {summary.healthy} healthy
            </li>
          ) : null}
          {summary.off > 0 ? (
            <li className="health-legend__item health-legend__item--off">{summary.off} disabled</li>
          ) : null}
        </ul>
      </div>

      <table className="conn-health__table">
        <caption className="sr-only">Connection health</caption>
        <colgroup>
          <col />
          <col className="conn-health__col-platform" />
          <col className="conn-health__col-status" />
          <col className="conn-health__col-failed" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Connection</th>
            <th scope="col">Platform</th>
            <th scope="col">Status</th>
            <th scope="col" className="conn-health__num">
              Failed jobs
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const { connection, deadJobCount } = row;
            const bucket = bucketOf(row);
            const failedText = `${deadJobCount} failed job${deadJobCount === 1 ? '' : 's'}`;
            return (
              <tr key={connection.id} className={`conn-health__row conn-health__row--${bucket}`}>
                <td className="conn-health__cell-name">
                  <span className="conn-health__name">
                    <span className="conn-health__dot" aria-hidden="true" />
                    <span className="conn-health__name-text" title={connection.name}>
                      {connection.name}
                    </span>
                  </span>
                </td>
                <td className="conn-health__platform">
                  <ConnectionChip
                    connectionId={connection.id}
                    name={connection.name}
                    channel={{
                      platformType: connection.platformType,
                      label: resolvePlatformLabel(platforms, connection.platformType),
                      shortLabel: resolvePlatformShortLabel(platforms, connection.platformType),
                      environment: readConnectionEnvironment(connection.config),
                    }}
                  />
                </td>
                <td className={`conn-health__status conn-health__status--${connection.status}`}>
                  {CONNECTION_STATUS_LABEL[connection.status] ?? connection.status}
                </td>
                <td className="conn-health__num">
                  {deadJobCount > 0 ? (
                    <Link
                      className="conn-health__failed"
                      to={`/jobs-logs?status=dead&connectionId=${encodeURIComponent(connection.id)}`}
                      aria-label={`${failedText} on ${connection.name}`}
                    >
                      {failedText}
                      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                        <path d="M4.5 2.5 8 6l-3.5 3.5" />
                      </svg>
                    </Link>
                  ) : (
                    <span className="conn-health__none">None</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
