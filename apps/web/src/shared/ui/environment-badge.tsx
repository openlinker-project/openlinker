import type { ReactElement } from 'react';
import { env } from '../config/env';
import { APP_VERSION } from '../config/app-version';

type EnvironmentTone = 'info' | 'neutral' | 'review' | 'success' | 'warning';

export interface EnvironmentMeta {
  label: string;
  shortLabel: string;
  tone: EnvironmentTone;
}

function toReadableLabel(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getEnvironmentMeta(appEnv: string): EnvironmentMeta {
  const normalized = appEnv.trim().toLowerCase();

  switch (normalized) {
    case 'dev':
    case 'development':
    case 'local':
    case 'test':
      return {
        label: 'Development',
        shortLabel: 'Dev',
        tone: 'info',
      };
    case 'stage':
    case 'staging':
    case 'qa':
    case 'uat':
      return {
        label: 'Staging',
        shortLabel: 'Stg',
        tone: 'warning',
      };
    case 'preview':
      return {
        label: 'Preview',
        shortLabel: 'Prev',
        tone: 'review',
      };
    case 'prod':
    case 'production':
      return {
        label: 'Production',
        shortLabel: 'Prod',
        tone: 'success',
      };
    default: {
      const label = toReadableLabel(appEnv) || 'Custom';

      return {
        label,
        shortLabel: label.slice(0, 4),
        tone: 'neutral',
      };
    }
  }
}

interface EnvironmentBadgeProps {
  appEnv?: string;
  compact?: boolean;
  /** Release version, shown as a smaller line below the environment label, e.g. `"0.10.0"`. */
  version?: string;
  className?: string;
}

export function EnvironmentBadge({
  appEnv = env.VITE_APP_ENV,
  compact = false,
  version = APP_VERSION,
  className = '',
}: EnvironmentBadgeProps): ReactElement {
  const environment = getEnvironmentMeta(appEnv);
  const classes = [
    'context-chip',
    `context-chip--${environment.tone}`,
    version ? 'environment-badge--stacked' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const label = compact ? environment.shortLabel : environment.label;
  const ariaLabel = version
    ? `Environment ${environment.label}, version ${version}`
    : `Environment ${environment.label}`;

  return (
    <span className={classes} aria-label={ariaLabel}>
      <span className="environment-badge__env">{label}</span>
      {/* An empty APP_VERSION means the build-time inject never ran — omit
          the line rather than render a fake-looking "v0.0.0". */}
      {version ? <span className="environment-badge__version">v{version}</span> : null}
    </span>
  );
}
