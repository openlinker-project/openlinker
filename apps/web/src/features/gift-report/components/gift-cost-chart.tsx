/**
 * Gift cost chart
 *
 * One series of bars: what gifts cost in each day or week. A week still in
 * progress is hatched, and says so in its tooltip, so a short last bar is not
 * read as a drop. Every bar is focusable and carries its figure in its accessible
 * name; the tooltip is hover and focus, never the only way to read a value.
 *
 * @module features/gift-report/components
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { interpolate, useActiveLocale, useFormat, useMessages } from '../../../shared/i18n';
import { getBcp47Locale } from '../../../shared/i18n';
import type { GiftCostSeries } from '../api/gift-report.types';
import { niceAxis } from '../lib/gift-report-view';

export function GiftCostChart({ series }: { series: GiftCostSeries }): ReactElement {
  const copy = useMessages('gift-report').chart;
  const format = useFormat();
  const locale = useActiveLocale();
  const tag = getBcp47Locale(locale);
  const currency = series.currency ?? undefined;
  const { top, ticks } = niceAxis(Math.max(0, ...series.points.map((p) => p.costNet)));
  // Bars grow from zero on first paint; the height is set one frame after mount.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setGrown(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  const day = series.granularity === 'day';
  const label = (iso: string): string =>
    new Intl.DateTimeFormat(tag, day ? { weekday: 'short' } : { day: 'numeric', month: 'short' }).format(
      new Date(iso),
    );
  const total = series.points.reduce((sum, p) => sum + p.costNet, 0);

  return (
    <section className="gift-chart" aria-label={copy.aria}>
      <div className="gift-chart__h">
        <h2>{day ? copy.titleDay : copy.titleWeek}</h2>
        <span>{day ? copy.hintDay : copy.hintWeek}</span>
      </div>
      <div
        className="gift-plot"
        role="img"
        aria-label={interpolate(copy.plotAria, { total: format.money(total, currency) })}
        data-testid="gift-report-chart"
      >
        <div className="gift-y">
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{format.number(tick)}</span>
          ))}
        </div>
        <div className="gift-grid">
          <div className="gift-grid__lines" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="gift-bars">
            {series.points.map((point) => {
              const text = `${day ? label(point.start) : interpolate(copy.weekFrom, { date: label(point.start) })}: ${format.money(point.costNet, currency)}`;
              return (
                <div
                  key={point.start}
                  className={['gift-bar', point.partial && !day ? 'is-part' : ''].filter(Boolean).join(' ')}
                  tabIndex={0}
                  role="img"
                  aria-label={point.partial && !day ? `${text}, ${copy.inProgress}` : text}
                  style={{ '--h': `${grown ? (point.costNet / top) * 100 : 0}%` } as CSSProperties}
                >
                  <i />
                  <span className="gift-bar__tip">{text}</span>
                </div>
              );
            })}
          </div>
          <div className="gift-x">
            {series.points.map((point) => (
              <span key={point.start}>{label(point.start)}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
