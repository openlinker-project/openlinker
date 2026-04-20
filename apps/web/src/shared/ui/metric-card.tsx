import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type MetricCardTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

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

function renderBody({ description, label, trend, value }: MetricCardBody): ReactNode {
  return (
    <>
      <span className="metric-card__label">{label}</span>
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
      {renderBody({ description, label, trend, value })}
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
        {renderBody({ description, label, trend, value })}
      </Link>
    );
  },
);
