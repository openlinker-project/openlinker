import type { ReactElement } from 'react';
import { env } from '../config/env';

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
  className?: string;
}

export function EnvironmentBadge({
  appEnv = env.VITE_APP_ENV,
  compact = false,
  className = '',
}: EnvironmentBadgeProps): ReactElement {
  const environment = getEnvironmentMeta(appEnv);
  const classes = ['context-chip', `context-chip--${environment.tone}`, className].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-label={`Environment ${environment.label}`}>
      {compact ? environment.shortLabel : environment.label}
    </span>
  );
}
