/**
 * Record Card (#4289)
 *
 * One made-up order shown as a BEFORE / AFTER: the left column is the order as
 * it is today, the right one is the same order after the rules, at the age the
 * operator is pointing at (a handle on the strip, or the card's own slider).
 * Erased fields are struck through on the left and replaced by a placeholder on
 * the right; the rows that must stay (items, amount, invoice, number) carry a
 * lock. A mini timeline places the order's age against the two cut-offs.
 *
 * The values are synthetic: the card never touches a real order. When the trial
 * run returned real (masked) samples, only the order reference and the age in
 * the header come from them.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useShortPeriod } from '../hooks/use-short-period';
import type { BuyerDataPlan } from '../hooks/use-buyer-data-plan';
import type { BuyerDataEraseMode } from '../api/buyer-data.types';
import { daysToPeriod } from '../lib/buyer-data-config';
import { DAYS_PER_MONTH, AXIS_MONTHS, type RetentionCuts } from '../lib/retention-scale';

type Sample = 'fresh' | 'old';

const FALLBACK_AGE_DAYS: Record<Sample, number> = { fresh: 0, old: 900 };
const MAX_SCRUB_MONTHS = AXIS_MONTHS;
const DAY_MS = 86_400_000;

export interface RecordCardProps extends RetentionCuts {
  mode: BuyerDataEraseMode;
  /** Age of the handle being grabbed, hovered or focused; wins over the slider. */
  handleAgeDays: number | null;
  /** Where the slider starts: the middle of the oldest month that still has orders. */
  defaultAgeDays: number;
  /** The trial run: real masked samples and the protection counts, when there is one. */
  plan?: BuyerDataPlan | null;
}

function LockIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="record-card__icon" aria-hidden="true">
      <path
        d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7h1Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function iconFor(state: string): string {
  return state.endsWith('erased') ? 'erased' : state;
}

function StateIcon({ state }: { state: string }): ReactElement {
  const path =
    state === 'visible'
      ? 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Zm6.5 1.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z'
      : state === 'hidden'
        ? 'M2 2.5 13.5 14M1.5 8S4 3.5 8 3.5c1 0 1.9.3 2.7.8M14.5 8s-1 1.8-2.7 3.1'
        : 'M3.5 5h9M6 5V3.5h4V5m-5.5 0 .6 8h5.8l.6-8';
  const stroked = state !== 'visible';
  return (
    <svg viewBox="0 0 16 16" className="record-card__icon" aria-hidden="true">
      <path
        d={path}
        fill={stroked ? 'none' : 'currentColor'}
        stroke={stroked ? 'currentColor' : undefined}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fillRule="evenodd"
      />
    </svg>
  );
}

/** Where an age sits on the scrubber, 0..1 (capped: the scrubber ends at ten years). */
function scrubPct(days: number): number {
  return Math.min(1, days / (MAX_SCRUB_MONTHS * DAYS_PER_MONTH));
}

function pct(days: number, span: number): number {
  return Math.min(100, Math.max(0, (days / span) * 100));
}

export function RecordCard({
  hideAfterDays,
  eraseAfterDays,
  mode,
  handleAgeDays,
  defaultAgeDays,
  plan = null,
}: RecordCardProps): ReactElement {
  const copy = useMessages('buyer-data').record;
  const shortPeriod = useShortPeriod();
  const [sample, setSample] = useState<Sample>('old');
  const [scrubDays, setScrubDays] = useState(defaultAgeDays);
  const [anchored, setAnchored] = useState(false);
  const touched = useRef(false);

  const real = useMemo(() => {
    const now = Date.now();
    const dated = (plan?.data?.samples ?? [])
      .map((item) => ({
        ref: item.orderRef,
        ageDays: Math.max(0, Math.floor((now - Date.parse(item.placedAt)) / DAY_MS)),
      }))
      .filter((item) => Number.isFinite(item.ageDays))
      .sort((a, b) => a.ageDays - b.ageDays);
    return { fresh: dated[0], old: dated[dated.length - 1] };
  }, [plan?.data?.samples]);

  // The default arrives with the histogram; follow it until the operator picks an age.
  useEffect(() => {
    if (touched.current) return;
    setScrubDays(defaultAgeDays);
  }, [defaultAgeDays]);

  const driven = handleAgeDays !== null;
  const age = handleAgeDays ?? scrubDays;
  const erased = eraseAfterDays > 0 && age >= eraseAfterDays;
  const hidden = (hideAfterDays > 0 && age >= hideAfterDays) || (mode === 'whole-order' && erased);

  const state = erased
    ? hidden
      ? 'hidden-erased'
      : 'visible-erased'
    : hidden
      ? 'hidden'
      : 'visible';
  const pill: Record<typeof state, string> = {
    visible: copy.ribbonVisible,
    hidden: copy.ribbonHidden,
    'visible-erased': copy.ribbonVisibleErased,
    'hidden-erased': copy.ribbonHiddenErased,
  };

  const personal: { id: string; label: string; value: string; redacted: string }[] = [
    { id: 'buyer', label: copy.buyer, value: copy.valueBuyer, redacted: copy.valueBuyerErased },
    { id: 'email', label: copy.email, value: copy.valueEmail, redacted: copy.redacted },
    { id: 'phone', label: copy.phone, value: copy.valuePhone, redacted: copy.redacted },
    { id: 'address', label: copy.address, value: copy.valueAddress, redacted: copy.redacted },
    { id: 'note', label: copy.note, value: copy.valueNote, redacted: copy.redacted },
    { id: 'taxId', label: copy.taxId, value: copy.valueTaxId, redacted: copy.redacted },
  ];
  const staying: { id: string; label: string; value: string }[] = [
    { id: 'items', label: copy.items, value: copy.valueItems },
    { id: 'amount', label: copy.amount, value: copy.valueAmount },
    { id: 'invoice', label: copy.invoice, value: copy.valueInvoice },
    { id: 'orderRef', label: copy.orderRef, value: copy.valueOrderRef },
  ];

  const scrubMonths = Math.min(MAX_SCRUB_MONTHS, Math.round(scrubDays / DAYS_PER_MONTH));
  const ageLabel = age <= 0 ? copy.today : shortPeriod(Math.max(age, 1));

  // The timeline spans the two cuts with some room past the later one.
  const span = Math.max(hideAfterDays, eraseAfterDays, age, 365) * 1.15;
  const hidePct = hideAfterDays > 0 ? pct(hideAfterDays, span) : null;
  const erasePct = eraseAfterDays > 0 ? pct(eraseAfterDays, span) : null;
  const dotPct = pct(age, span);

  const source = real[sample];
  const showSource = anchored && !driven && source !== undefined && scrubDays === source.ageDays;

  function pick(next: Sample): void {
    setSample(next);
    touched.current = true;
    const found = real[next];
    setScrubDays(found?.ageDays ?? FALLBACK_AGE_DAYS[next]);
    setAnchored(found !== undefined);
  }

  const hideText = hideAfterDays > 0 ? shortPeriod(hideAfterDays) : null;
  const eraseText = eraseAfterDays > 0 ? shortPeriod(eraseAfterDays) : null;

  // The pill cross-fades: the previous label stays one beat, fading out under the new one.
  const [seenState, setSeenState] = useState<typeof state>(state);
  const [leaving, setLeaving] = useState<{ id: number; state: typeof state; label: string } | null>(
    null
  );
  if (seenState !== state) {
    setSeenState(state);
    setLeaving({ id: (leaving?.id ?? 0) + 1, state: seenState, label: pill[seenState] });
  }

  const afterVisibility = hidden ? copy.valueHidden : copy.valueVisible;

  return (
    <section
      className={`record-card record-card--${state}`}
      aria-labelledby="record-card-title"
      data-testid="record-card"
      data-state={state}
    >
      <header className="record-card__head">
        <h4 id="record-card-title">{copy.title}</h4>
        <span className="record-card__sample-tag">{copy.sampleTag}</span>
      </header>

      <SegmentedControl<Sample>
        aria-label={copy.sampleLabel}
        value={sample}
        onChange={pick}
        options={[
          { value: 'fresh', label: copy.sampleFresh },
          { value: 'old', label: copy.sampleOld },
        ]}
      />

      {showSource && source !== undefined ? (
        <p className="record-card__source" data-testid="record-source">
          {interpolate(copy.basedOn, {
            ref: source.ref,
            age: source.ageDays <= 0 ? copy.today : shortPeriod(source.ageDays),
          })}
        </p>
      ) : null}

      <div className="record-card__timeline" data-testid="record-timeline">
        <div className="record-card__track" aria-hidden="true">
          {hidePct !== null ? (
            <span
              className="record-card__zone record-card__zone--hide"
              style={{ left: `${hidePct}%`, right: erasePct !== null ? `${100 - erasePct}%` : 0 }}
            />
          ) : null}
          {erasePct !== null ? (
            <span
              className="record-card__zone record-card__zone--erase"
              style={{ left: `${erasePct}%`, right: 0 }}
            />
          ) : null}
          <span className="record-card__dot" style={{ left: `${dotPct}%` }} />
        </div>
        <ul className="record-card__legend">
          <li className="record-card__legend-item">
            <i className="record-card__swatch record-card__swatch--now" aria-hidden="true" />
            {copy.today}
          </li>
          {hideText !== null ? (
            <li className="record-card__legend-item">
              <i className="record-card__swatch record-card__swatch--hide" aria-hidden="true" />
              {interpolate(copy.markHide, { age: hideText })}
            </li>
          ) : null}
          {eraseText !== null ? (
            <li className="record-card__legend-item">
              <i className="record-card__swatch record-card__swatch--erase" aria-hidden="true" />
              {interpolate(copy.markErase, { age: eraseText })}
            </li>
          ) : null}
        </ul>
      </div>

      <div className="record-card__pillbox">
        {leaving !== null ? (
          <span
            key={leaving.id}
            className={`record-card__pill record-card__pill--${leaving.state} record-card__pill--out`}
            aria-hidden="true"
          >
            <StateIcon state={iconFor(leaving.state)} />
            {leaving.label}
          </span>
        ) : null}
        <p
          key={state}
          className={`record-card__pill record-card__pill--${state}`}
          data-testid="record-ribbon"
          role="status"
        >
          <StateIcon state={iconFor(state)} />
          {pill[state]}
        </p>
      </div>

      <div className="record-card__rows" role="list" aria-label={copy.tableLabel}>
        <div className={`record-card__row${hidden ? ' is-changed' : ''}`} role="listitem">
          <span className="record-card__label">{copy.visibility}</span>
          <span className="record-card__values">
            <span data-testid="record-field-visibility" className="record-card__new">
              {afterVisibility}
            </span>
            {hidden ? (
              <span className="record-card__old" title={copy.valueVisible}>
                {copy.valueVisible}
              </span>
            ) : null}
          </span>
        </div>

        {personal.map((field, index) => (
          <div
            key={field.id}
            className={`record-card__row${erased ? ' is-changed' : ''}`}
            role="listitem"
            style={{ '--i': index } as CSSProperties}
          >
            <span className="record-card__label">{field.label}</span>
            <span className="record-card__values">
              <span
                key={erased ? 'erased' : 'kept'}
                data-testid={`record-field-${field.id}`}
                className={`record-card__new${erased ? ' record-card__new--redacted' : ''}`}
              >
                {erased ? field.redacted : field.value}
              </span>
              {erased ? (
                <span
                  data-testid={`record-now-${field.id}`}
                  className="record-card__old"
                  title={field.value}
                >
                  {field.value}
                </span>
              ) : null}
            </span>
          </div>
        ))}

        {staying.map((field) => (
          <div key={field.id} className="record-card__row" role="listitem">
            <span className="record-card__label">{field.label}</span>
            <span className="record-card__values record-card__values--kept">
              <span data-testid={`record-field-${field.id}`} className="record-card__new">
                {field.value}
              </span>
              {erased ? (
                <span className="record-card__stays" title={copy.staysWhy}>
                  <LockIcon />
                  {copy.stays}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      <footer className="record-card__age">
        <div className="record-card__age-head">
          <label htmlFor="record-card-age">{driven ? copy.ageFromHandle : copy.ageTitle}</label>
          <output htmlFor="record-card-age" className="record-card__age-value">
            {ageLabel}
            {daysToPeriod(Math.round(age)).unit === 'days'
              ? ''
              : ` · ${interpolate(copy.daysShort, { n: Math.round(age) })}`}
          </output>
        </div>
        <div className="record-card__scrub">
          {hidePct !== null ? (
            <i
              className="record-card__cut record-card__cut--hide"
              style={{ '--x': scrubPct(hideAfterDays) } as CSSProperties}
              aria-hidden="true"
            />
          ) : null}
          {erasePct !== null ? (
            <i
              className="record-card__cut record-card__cut--erase"
              style={{ '--x': scrubPct(eraseAfterDays) } as CSSProperties}
              aria-hidden="true"
            />
          ) : null}
          <input
            id="record-card-age"
            type="range"
            min={0}
            max={MAX_SCRUB_MONTHS}
            step={1}
            value={scrubMonths}
            aria-valuetext={ageLabel}
            data-testid="record-age"
            onChange={(event) => {
              touched.current = true;
              setAnchored(false);
              setScrubDays(Number(event.target.value) * DAYS_PER_MONTH);
            }}
          />
        </div>
      </footer>
    </section>
  );
}
