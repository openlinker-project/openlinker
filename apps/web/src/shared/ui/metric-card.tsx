import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type MetricCardTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

interface MetricCardProps extends ComponentPropsWithoutRef<'div'> {
  description?: ReactNode;
  label: string;
  to?: string;
  tone?: MetricCardTone;
  trend?: ReactNode;
  value: ReactNode;
}

export const MetricCard = forwardRef<HTMLDivElement, MetricCardProps>(function MetricCard(
  {
    description,
    label,
    to,
    tone = 'neutral',
    trend,
    value,
    className = '',
    ...props
  },
  ref,
) {
  const classes = ['metric-card', `metric-card--${tone}`, className].filter(Boolean).join(' ');

  const body = (
    <>
      <span className="metric-card__label">{label}</span>
      <span className="metric-card__value">{value}</span>
      {trend ? <span className="metric-card__trend">{trend}</span> : null}
      {description ? <span className="metric-card__description">{description}</span> : null}
    </>
  );

  if (to) {
    return (
      <Link
        ref={ref as never}
        to={to}
        className={`${classes} metric-card--interactive`}
        {...(props as ComponentPropsWithoutRef<'a'>)}
      >
        {body}
      </Link>
    );
  }

  return (
    <div ref={ref} className={classes} {...props}>
      {body}
    </div>
  );
});
