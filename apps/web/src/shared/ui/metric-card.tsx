import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export const MetricCardToneValues = ['neutral', 'success', 'warning', 'error', 'info'] as const;
export type MetricCardTone = (typeof MetricCardToneValues)[number];

function ToneIcon({ tone }: { tone: MetricCardTone }): ReactNode {
  if (tone === 'warning') {
    return (
      <span className="metric-card__icon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 1.5 L14.5 13 H1.5 Z" />
          <line x1="8" y1="6" x2="8" y2="9.5" />
          <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  if (tone === 'error') {
    return (
      <span className="metric-card__icon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.5" />
          <line x1="8" y1="4.5" x2="8" y2="8.5" />
          <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  return null;
}

interface MetricCardBody {
  description?: ReactNode;
  label: string;
  tone?: MetricCardTone;
  trend?: ReactNode;
  value: ReactNode;
}

interface MetricCardProps extends MetricCardBody, Omit<ComponentPropsWithoutRef<'div'>, 'children'> {}

interface MetricCardLinkProps
  extends MetricCardBody,
    Omit<LinkProps, 'children' | 'className' | 'to'> {
  className?: string;
  to: LinkProps['to'];
}

function renderBody(
  { description, label, trend, value }: MetricCardBody,
  tone: MetricCardTone,
): ReactNode {
  return (
    <>
      <span className="metric-card__label">
        <ToneIcon tone={tone} />
        {label}
      </span>
      <span className="metric-card__value">{value}</span>
      {trend ? <span className="metric-card__trend">{trend}</span> : null}
      {description ? <span className="metric-card__description">{description}</span> : null}
    </>
  );
}

function buildClasses(tone: MetricCardTone, extra: string, interactive: boolean): string {
  return [
    'metric-card',
    `metric-card--${tone}`,
    interactive ? 'metric-card--interactive' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export const MetricCard = forwardRef<HTMLDivElement, MetricCardProps>(function MetricCard(
  { description, label, tone = 'neutral', trend, value, className = '', ...props },
  ref,
) {
  return (
    <div ref={ref} className={buildClasses(tone, className, false)} {...props}>
      {renderBody({ description, label, trend, value }, tone)}
    </div>
  );
});

export const MetricCardLink = forwardRef<HTMLAnchorElement, MetricCardLinkProps>(
  function MetricCardLink(
    { description, label, to, tone = 'neutral', trend, value, className = '', ...props },
    ref,
  ) {
    return (
      <Link ref={ref} to={to} className={buildClasses(tone, className, true)} {...props}>
        {renderBody({ description, label, trend, value }, tone)}
      </Link>
    );
  },
);
