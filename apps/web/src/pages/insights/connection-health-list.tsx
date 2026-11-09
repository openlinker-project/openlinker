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
import { renderRich, useMessages, usePlural } from '../../shared/i18n';
import {
  CONNECTION_STATUS_LABEL_KEY,
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
  const pageCopy = useMessages('analytics').insightsPage;
  const copy = pageCopy.connectionHealth;
  const plural = usePlural();
  const sorted = useMemo(() => sortConnectionHealthRows(rows), [rows]);
  const summary = useMemo(() => summarizeConnectionHealth(rows), [rows]);

  if (rows.length === 0) {
    return (
      <p className="muted-text">
        {renderRich(pageCopy.noConnections, {
          link: (text: string) => <Link to="/connections/new">{text}</Link>,
        })}
      </p>
    );
  }

  const attentionText = plural(summary.attention, copy.legend.attention);
  const healthyText = plural(summary.healthy, copy.legend.healthy);
  const offText = plural(summary.off, copy.legend.disabled);
  const legend = [
    summary.attention > 0 ? attentionText : null,
    summary.healthy > 0 ? healthyText : null,
    summary.off > 0 ? offText : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="conn-health">
      <div className="conn-health__summary">
        <p className="conn-health__sentence" data-testid="connection-health-summary">
          {describeConnectionHealth(summary, copy, plural)}
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
            <li className="health-legend__item health-legend__item--attention">{attentionText}</li>
          ) : null}
          {summary.healthy > 0 ? (
            <li className="health-legend__item health-legend__item--healthy">{healthyText}</li>
          ) : null}
          {summary.off > 0 ? (
            <li className="health-legend__item health-legend__item--off">{offText}</li>
          ) : null}
        </ul>
      </div>

      <table className="conn-health__table">
        <caption className="sr-only">{copy.caption}</caption>
        <colgroup>
          <col />
          <col className="conn-health__col-platform" />
          <col className="conn-health__col-status" />
          <col className="conn-health__col-failed" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{copy.columns.connection}</th>
            <th scope="col">{copy.columns.platform}</th>
            <th scope="col">{copy.columns.status}</th>
            <th scope="col" className="conn-health__num">
              {copy.columns.failedJobs}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const { connection, deadJobCount } = row;
            const bucket = bucketOf(row);
            const failedText = plural(deadJobCount, copy.failedJobs);
            const statusLabel =
              copy.status[CONNECTION_STATUS_LABEL_KEY[connection.status]] ?? connection.status;
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
                  {statusLabel}
                </td>
                <td className="conn-health__num">
                  {deadJobCount > 0 ? (
                    <Link
                      className="conn-health__failed"
                      to={`/jobs-logs?status=dead&connectionId=${encodeURIComponent(connection.id)}`}
                      aria-label={plural(deadJobCount, copy.failedJobsOn, {
                        name: connection.name,
                      })}
                    >
                      {failedText}
                      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                        <path d="M4.5 2.5 8 6l-3.5 3.5" />
                      </svg>
                    </Link>
                  ) : (
                    <span className="conn-health__none">{copy.none}</span>
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
