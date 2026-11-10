/**
 * Shared pieces of the analytics screen: amount display in the active currency,
 * the panel shell and toolbar mirroring the real /analytics page, an aggregate
 * who-pays strip and a weekly bar chart mirroring MarginTrendChart.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@web/shared/ui/button';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { useFormat } from '@web/shared/i18n/use-format';
import { EUR_RATE, useMoney, useProto } from '../proto';

/** Grosze in the active currency. Costs are PLN; in EUR they are converted at EUR_RATE. */
export function useAmount(): (grosze: number | null) => string {
  const money = useMoney();
  const { currency } = useProto();
  return (g) => (g === null ? '-' : currency === 'EUR' ? money(Math.round(g / EUR_RATE), 'EUR') : money(g, 'PLN'));
}

/** Small muted PLN amount under an EUR figure; nothing in PLN mode. */
export function PlnHint({ grosze }: { grosze: number | null }): ReactElement | null {
  const money = useMoney();
  const { currency } = useProto();
  if (currency !== 'EUR' || grosze === null) return null;
  return <div className="muted-text ana-pln-hint tabular">{money(grosze, 'PLN')}</div>;
}

export function Amount({ grosze, strong }: { grosze: number | null; strong?: boolean }): ReactElement {
  const amt = useAmount();
  return (
    <>
      <span className={`tabular mono-text${strong ? ' ana-strong' : ''}`}>{amt(grosze)}</span>
      <PlnHint grosze={grosze} />
    </>
  );
}

/** The real page's article panel: eyebrow + section title + optional actions. */
export function AnaPanel({ eyebrow, title, actions, children, testId }: { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode; testId?: string }): ReactElement {
  return (
    <article className="panel panel--dense analytics-margin ana-panel" data-testid={testId}>
      <div className="panel__header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h3 className="section-title">{title}</h3>
        </div>
        {actions}
      </div>
      {children}
    </article>
  );
}

/** Mirrors AnalyticsDateRangeToolbar markup with Polish copy, plus the currency switch. */
export function AnaToolbar({ from, to }: { from: string; to: string }): ReactElement {
  const { currency, set } = useProto();
  const [preset, setPreset] = useState<'7d' | '30d' | '90d' | 'custom'>('custom');
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  return (
    <div className="toolbar analytics-toolbar">
      <div className="toolbar__group">
        <SegmentedControl
          aria-label="Zakres dat"
          options={[
            { value: '7d', label: '7 dni' },
            { value: '30d', label: '30 dni' },
            { value: '90d', label: '90 dni' },
            { value: 'custom', label: 'Własny' },
          ]}
          value={preset}
          onChange={setPreset}
        />
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">Od</span>
          <input type="date" className="control" aria-label="Data zamówienia od" value={draftFrom} onChange={(e) => { setDraftFrom(e.target.value); setPreset('custom'); }} />
        </label>
        <label className="analytics-toolbar__field">
          <span className="analytics-toolbar__label">Do</span>
          <input type="date" className="control" aria-label="Data zamówienia do" value={draftTo} onChange={(e) => { setDraftTo(e.target.value); setPreset('custom'); }} />
        </label>
        <Button tone="secondary">Zastosuj</Button>
      </div>
      <div className="toolbar__group">
        <SegmentedControl
          aria-label="Waluta raportu"
          options={[
            { value: 'PLN', label: 'PLN' },
            { value: 'EUR', label: 'EUR' },
          ]}
          value={currency}
          onChange={(v) => set({ currency: v })}
        />
      </div>
    </div>
  );
}

/** Line under the toolbar stating the basis; mentions the rate in EUR mode. */
export function BasisNote({ children }: { children: ReactNode }): ReactElement {
  const { currency } = useProto();
  return (
    <p className="analytics-margin__basis">
      <span className="chip chip--info">Netto, bez VAT</span>
      {children}
      {currency === 'EUR'
        ? ` Koszty zakupu są w PLN; pokazano je w EUR po kursie 1 EUR = ${EUR_RATE.toFixed(4).replace('.', ',')} PLN (NBP, tabela A), a pod kwotą kwotę w PLN.`
        : ' Kwoty w PLN, walucie raportu.'}
    </p>
  );
}

/** Aggregate who-pays strip: buyers paid 0 for N gifts, they cost you X. Reuses the mark's classes. */
export function AggregateWhoPays({ units, cost, unknownUnits }: { units: number; cost: number; unknownUnits: number }): ReactElement {
  const amt = useAmount();
  const money = useMoney();
  const fmt = useFormat();
  const { currency } = useProto();
  return (
    <div className="who-pays ana-who-pays" role="note" aria-label="Kto zapłacił za gratisy">
      <span className="who-pays__cell">
        <span className="who-pays__label">Klienci zapłacili</span>
        <span className="who-pays__value tabular">{amt(0)}</span>
      </span>
      <span className="who-pays__arrow" aria-hidden="true" />
      <span className="who-pays__cell who-pays__cell--cost">
        <span className="who-pays__label">Kosztowały Cię</span>
        <span className="who-pays__value tabular">{amt(cost)}</span>
      </span>
      <span className="who-pays__meta">
        Klienci zapłacili {amt(0)} za {fmt.number(units)} gratisów. Kosztowały Cię {amt(cost)} netto, po koszcie zakupu z dnia wydania.
        {unknownUnits > 0 ? ` ${fmt.number(unknownUnits)} szt. bez kosztu zakupu nie są w tej kwocie.` : ''}
        {currency === 'EUR' ? ` W PLN: ${money(cost, 'PLN')}.` : ''} Finansujesz Ty.
      </span>
    </div>
  );
}

const SHORT_MONTH = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${SHORT_MONTH[d.getUTCMonth()]}`;
}

/**
 * Weekly bars, same anatomy and classes as MarginTrendChart (plain SVG, one bar per
 * bucket, a label above). Polish week labels; the label above is caller-formatted.
 */
export function WeeklyBars({ weeks, values, labels, ariaLabel }: { weeks: string[]; values: number[]; labels: string[]; ariaLabel: string }): ReactElement {
  const WIDTH = 560;
  const BASELINE = 150;
  const PLOT = 120;
  const LEFT = 40;
  const max = Math.max(...values, 0);
  const slot = (WIDTH - LEFT) / weeks.length;
  const barWidth = Math.min(56, slot * 0.6);
  return (
    <div className="analytics-margin__trend">
      <svg viewBox={`0 0 ${WIDTH} 196`} role="img" aria-label={ariaLabel}>
        <line className="analytics-margin__grid" x1={LEFT} x2={WIDTH - 8} y1={BASELINE} y2={BASELINE} />
        {weeks.map((w, i) => {
          const h = max > 0 ? (Math.max(values[i], 0) / max) * PLOT : 0;
          const x = LEFT + i * slot + (slot - barWidth) / 2;
          const y = BASELINE - h;
          return (
            <g key={w}>
              <rect className="analytics-margin__bar" x={x} y={y} width={barWidth} height={h} rx={2} />
              <text className="analytics-margin__bar-value" x={x + barWidth / 2} y={y - 6} textAnchor="middle">
                {labels[i]}
              </text>
              <text x={x + barWidth / 2} y={168} textAnchor="middle">
                {weekLabel(w)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Proportion bar for a share column (0..1). Decorative; the number is printed beside it. */
export function ShareBar({ value, tone = 'neutral' }: { value: number; tone?: 'neutral' | 'bundle' | 'gift' }): ReactElement {
  return (
    <span className={`ana-share ana-share--${tone}`} aria-hidden="true">
      <span className="ana-share__fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}
