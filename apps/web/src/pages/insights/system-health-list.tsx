/**
 * System health list (#4016).
 *
 * The Insights "System health" panel body. Two groups: the core services
 * OpenLinker itself runs on, in a fixed order so an operator always finds
 * PostgreSQL in the same place, and the connected systems it probes (a
 * connected shop), problems first and shown with the shared `ConnectionChip`.
 *
 * Each row is a dot, the name and a status word on the right. A failure
 * message goes UNDER the name and wraps: the previous flex row squeezed it
 * beside a mid-row badge, so a timeout message broke into a narrow column
 * and the badge moved from row to row.
 *
 * @module pages/insights
 */
import type { ReactElement } from 'react';
import { ConnectionChip, type Connection } from '../../features/connections';
import { readConnectionEnvironment } from '../../features/connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import type {
  ConnectionHealthEntry,
  DevStackHealth,
  ServiceHealth,
  ServiceStatus,
} from '../../features/health/api/health.types';
import { usePlatforms } from '../../shared/plugins';

const STATUS_LABEL: Record<ServiceStatus, string> = {
  ok: 'OK',
  warning: 'Warning',
  error: 'Error',
};

const SEVERITY: Record<ServiceStatus, number> = { error: 0, warning: 1, ok: 2 };

/** Strip / legend bucket for a status - shared vocabulary with Connection health. */
const BUCKET: Record<ServiceStatus, 'error' | 'attention' | 'healthy'> = {
  error: 'error',
  warning: 'attention',
  ok: 'healthy',
};

interface CoreService {
  key: string;
  name: string;
  health: ServiceHealth;
}

function coreServices(data: DevStackHealth): CoreService[] {
  const services: CoreService[] = [
    { key: 'postgres', name: 'PostgreSQL', health: data.services.postgres },
    { key: 'redis', name: 'Redis', health: data.services.redis },
    { key: 'prestashop', name: 'PrestaShop', health: data.services.prestashop },
  ];
  if (data.services.worker) {
    services.push({ key: 'worker', name: 'Worker', health: data.services.worker });
  }
  return services;
}

/** Problems first, then by name. */
export function sortConnectedSystems(
  entries: readonly ConnectionHealthEntry[]
): ConnectionHealthEntry[] {
  return [...entries].sort(
    (a, b) => SEVERITY[a.status] - SEVERITY[b.status] || (a.name ?? '').localeCompare(b.name ?? '')
  );
}

export function describeSystemHealth(statuses: readonly ServiceStatus[]): string {
  const failing = statuses.filter((s) => s === 'error').length;
  const warning = statuses.filter((s) => s === 'warning').length;
  const total = statuses.length;
  const plural = total === 1 ? 'check' : 'checks';
  if (failing === 0 && warning === 0) return `All ${total} ${plural} passing.`;
  if (failing === 0) return `${warning} of ${total} ${plural} with a warning.`;
  const tail = warning > 0 ? `, ${warning} with a warning` : '';
  return `${failing} of ${total} ${plural} failing${tail}.`;
}

function HealthRow({
  name,
  health,
  chip,
}: {
  name: string;
  health: ServiceHealth;
  chip?: ReactElement;
}): ReactElement {
  return (
    <li className={`sys-health__row sys-health__row--${health.status}`}>
      <span className="sys-health__dot" aria-hidden="true" />
      <span className="sys-health__body">
        <span className="sys-health__name-line">
          <span className="sys-health__name">{name}</span>
          {chip}
        </span>
        {health.message && health.status !== 'ok' ? (
          <span className="sys-health__message">{health.message}</span>
        ) : null}
      </span>
      <span className="sys-health__status">{STATUS_LABEL[health.status] ?? health.status}</span>
    </li>
  );
}

export function SystemHealthList({
  data,
  connectionById,
}: {
  data: DevStackHealth;
  connectionById: ReadonlyMap<string, Connection>;
}): ReactElement {
  const platforms = usePlatforms();
  const core = coreServices(data);
  const connected = sortConnectedSystems(data.connections ?? []);
  const statuses: ServiceStatus[] = [
    ...core.map((s) => s.health.status),
    ...connected.map((c) => c.status),
  ];
  const counts = {
    error: statuses.filter((s) => s === 'error').length,
    attention: statuses.filter((s) => s === 'warning').length,
    healthy: statuses.filter((s) => s === 'ok').length,
  };
  const legend = [
    counts.error > 0 ? `${counts.error} failing` : null,
    counts.attention > 0 ? `${counts.attention} warning` : null,
    counts.healthy > 0 ? `${counts.healthy} OK` : null,
  ].filter((part): part is string => part !== null);
  const ordered = [...statuses].sort((a, b) => SEVERITY[a] - SEVERITY[b]);

  return (
    <div className="sys-health">
      <div className="conn-health__summary">
        <p className="conn-health__sentence" data-testid="system-health-summary">
          {describeSystemHealth(statuses)}
        </p>
        <div className="health-strip" role="img" aria-label={legend.join(', ')}>
          {ordered.map((status, i) => (
            <span
              key={i}
              className={`health-strip__segment health-strip__segment--${BUCKET[status]}`}
            />
          ))}
        </div>
        <ul className="health-legend" aria-hidden="true">
          {counts.error > 0 ? (
            <li className="health-legend__item health-legend__item--error">
              {counts.error} failing
            </li>
          ) : null}
          {counts.attention > 0 ? (
            <li className="health-legend__item health-legend__item--attention">
              {counts.attention} warning
            </li>
          ) : null}
          {counts.healthy > 0 ? (
            <li className="health-legend__item health-legend__item--healthy">
              {counts.healthy} OK
            </li>
          ) : null}
        </ul>
      </div>

      <section className="sys-health__group" aria-labelledby="sys-health-core">
        <h4 id="sys-health-core" className="sys-health__group-title">
          Core services
        </h4>
        <ul className="sys-health__list">
          {core.map((service) => (
            <HealthRow key={service.key} name={service.name} health={service.health} />
          ))}
        </ul>
      </section>

      {connected.length > 0 ? (
        <section className="sys-health__group" aria-labelledby="sys-health-connected">
          <h4 id="sys-health-connected" className="sys-health__group-title">
            Connected systems
          </h4>
          <ul className="sys-health__list">
            {connected.map((entry) => {
              const connection = connectionById.get(entry.connectionId);
              const platformLabel = resolvePlatformLabel(platforms, entry.platformType);
              return (
                <HealthRow
                  key={entry.connectionId}
                  name={entry.name ?? platformLabel}
                  health={{ status: entry.status, message: entry.message }}
                  chip={
                    <ConnectionChip
                      connectionId={entry.connectionId}
                      name={entry.name ?? connection?.name ?? null}
                      channel={{
                        platformType: entry.platformType,
                        label: platformLabel,
                        shortLabel: resolvePlatformShortLabel(platforms, entry.platformType),
                        environment: readConnectionEnvironment(connection?.config),
                      }}
                    />
                  }
                />
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
