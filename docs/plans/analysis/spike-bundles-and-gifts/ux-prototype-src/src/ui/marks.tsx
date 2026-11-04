/**
 * New visual primitives proposed for the design system: how a gift and a bundle
 * announce themselves, who pays for a gift, and where a line's stock goes.
 * Only tokens from apps/web/src/index.css.
 */
import type { ReactElement, ReactNode } from 'react';
import type { GiftSource } from '../model/catalog';
import { useMoney, type Currency } from '../proto';

const GIFT_SOURCE_LABEL: Record<GiftSource, string> = {
  'channel-flag': 'oznaczony przez kanał',
  'cart-rule': 'z reguły koszyka sklepu',
  inferred: 'rozpoznany po cenie',
  'ol-rule': 'z promocji w OpenLinkerze',
  operator: 'dodany przez operatora',
};

export function GiftGlyph(): ReactElement {
  return (
    <svg className="gift-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 6.5h11v2.5h-11zM3.5 9h9v5h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.5V14M8 6.5C6.6 4.4 4.6 3.9 4.6 5.3c0 1 1.6 1.2 3.4 1.2M8 6.5c1.4-2.1 3.4-2.6 3.4-1.2 0 1-1.6 1.2-3.4 1.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function BundleGlyph(): ReactElement {
  return (
    <svg className="gift-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2" y="7" width="5.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="7" width="5.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5.2" y="2" width="5.6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** "Gratis" tag: neutral pill, violet tag dot, ribbon glyph, optional source caption. */
export function GiftMark({ source, compact }: { source?: GiftSource; compact?: boolean }): ReactElement {
  return (
    <span className={`role-mark role-mark--gift${compact ? ' role-mark--compact' : ''}`}>
      <GiftGlyph />
      <span>Gratis</span>
      {source && !compact ? <span className="role-mark__src">{GIFT_SOURCE_LABEL[source]}</span> : null}
    </span>
  );
}

export function BundleMark({ compact, label = 'Zestaw' }: { compact?: boolean; label?: string }): ReactElement {
  return (
    <span className={`role-mark role-mark--bundle${compact ? ' role-mark--compact' : ''}`}>
      <BundleGlyph />
      <span>{label}</span>
    </span>
  );
}

export function PartOf({ bundle }: { bundle: string }): ReactElement {
  return <span className="part-of">część zestawu: {bundle}</span>;
}

export interface WhoPaysProps {
  qty: number;
  /** Net purchase cost per unit in grosze, null when not recorded. */
  unitCost: number | null;
  /** Who funds it. */
  funder?: 'seller' | 'channel' | 'unknown';
  /** What the buyer pays for this line in grosze (0 for a pure gift, 1 for a grosz line). */
  buyerPays?: number;
  currency?: Currency;
  fx?: number;
  compact?: boolean;
}

/** The one memorable element: the buyer pays nothing, it costs you X. */
export function WhoPaysStrip({ qty, unitCost, funder = 'seller', buyerPays = 0, currency, fx, compact }: WhoPaysProps): ReactElement {
  const money = useMoney();
  const cost = unitCost === null ? null : unitCost * qty;
  return (
    <div className={`who-pays${compact ? ' who-pays--compact' : ''}`} role="note" aria-label="Kto płaci za gratis">
      <span className="who-pays__cell">
        <span className="who-pays__label">Klient płaci</span>
        <span className="who-pays__value tabular">{money(buyerPays, currency)}</span>
      </span>
      <span className="who-pays__arrow" aria-hidden="true" />
      <span className={`who-pays__cell who-pays__cell--cost${cost === null ? ' who-pays__cell--unknown' : ''}`}>
        <span className="who-pays__label">{funder === 'channel' ? 'Kosztuje kanał' : 'Kosztuje Cię'}</span>
        <span className="who-pays__value tabular">
          {cost === null ? 'koszt nieznany' : money(cost, 'PLN')}
        </span>
      </span>
      {!compact ? (
        <span className="who-pays__meta">
          {cost === null
            ? 'Uzupełnij koszt zakupu wariantu, żeby liczyć koszt gratisów.'
            : `${qty} szt. x ${money(unitCost, 'PLN')} netto, koszt zakupu`}
          {fx && currency === 'EUR' ? ` · kurs 1 EUR = ${fx.toFixed(4).replace('.', ',')} PLN` : ''}
          {funder === 'unknown' ? ' · finansowanie nieznane' : funder === 'channel' ? ' · finansuje kanał' : ' · finansujesz Ty'}
        </span>
      ) : null}
    </div>
  );
}

export type TrailState = 'done' | 'active' | 'todo' | 'blocked' | 'skipped';
export interface TrailStep {
  label: string;
  state: TrailState;
  detail?: string;
}

/** Where a line's stock goes. Ink by default, colour only for an exception. */
export function StockPathTrail({ steps, label = 'Ścieżka stanu' }: { steps: TrailStep[]; label?: string }): ReactElement {
  return (
    <ol className="stock-trail" aria-label={label}>
      {steps.map((s, i) => (
        <li key={i} className={`stock-trail__step stock-trail__step--${s.state}`}>
          <span className="stock-trail__dot" aria-hidden="true" />
          <span className="stock-trail__text">
            <span className="stock-trail__label">{s.label}</span>
            {s.detail ? <span className="stock-trail__detail">{s.detail}</span> : null}
          </span>
          <span className="spike-sr">
            {s.state === 'done' ? 'zrobione' : s.state === 'active' ? 'w toku' : s.state === 'blocked' ? 'zablokowane' : s.state === 'skipped' ? 'pominięte' : 'czeka'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What the channel actually sent, as a code block with highlighted lines. */
export function ChannelPayload({ title, lines }: { title: string; lines: { text: string; tone?: 'warn' | 'muted' | 'key' }[] }): ReactElement {
  return (
    <figure className="payload">
      <figcaption className="payload__title">{title}</figcaption>
      <pre className="payload__body">
        {lines.map((l, i) => (
          <span key={i} className={l.tone ? `payload__line--${l.tone}` : undefined}>
            {l.text}
            {'\n'}
          </span>
        ))}
      </pre>
    </figure>
  );
}

/** Styled switch built on a native checkbox (the kit has none). */
export function Switch({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: string }): ReactElement {
  return (
    <label className={`proto-switch${disabled ? ' proto-switch--disabled' : ''}`} title={hint}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="proto-switch__track" aria-hidden="true">
        <span className="proto-switch__thumb" />
      </span>
      <span className="proto-switch__label">{label}</span>
    </label>
  );
}
