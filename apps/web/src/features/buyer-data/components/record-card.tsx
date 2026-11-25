/**
 * Record Card (#4289)
 *
 * One made-up order shown as a BEFORE / AFTER: the left column is the order as
 * it is today, the right one is the same order after the rules, at the age the
 * operator is pointing at (a handle on the strip, or the card's own slider).
 * Erased fields are struck through on the left and replaced by a placeholder on
 * the right; the rows that must stay (items, amount, invoice, number) carry a
 * lock. Three stage presets (today / after hiding / after erasure) and one
 * zone-coloured age slider pick the example's age; the presets are shortcuts
 * whose selection is derived from the age, never separate state.
 *
 * The values are synthetic: the card never touches a real order.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useShortPeriod } from '../hooks/use-short-period';
import type { BuyerDataPlan } from '../hooks/use-buyer-data-plan';
import type { BuyerDataEraseMode } from '../api/buyer-data.types';
import { daysToPeriod } from '../lib/buyer-data-config';
import {
  DAYS_PER_MONTH,
  AXIS_MONTHS,
  zoneForAge,
  type RetentionCuts,
  type RetentionZone,
} from '../lib/retention-scale';

type Stage = 'today' | 'afterHide' | 'afterErase';

const MAX_SCRUB_MONTHS = AXIS_MONTHS;
const MAX_SCRUB_DAYS = MAX_SCRUB_MONTHS * DAYS_PER_MONTH;
const STAGE_FOR_ZONE: Record<RetentionZone, Stage> = {
  kept: 'today',
  hidden: 'afterHide',
  erased: 'afterErase',
};

function toMonth(days: number): number {
  return Math.round(days / DAYS_PER_MONTH) * DAYS_PER_MONTH;
}

/** Hiding is reachable only when it is on and the erase cut leaves a gap after it. */
function hideStageOpen({ hideAfterDays, eraseAfterDays }: RetentionCuts): boolean {
  return hideAfterDays > 0 && (eraseAfterDays === 0 || eraseAfterDays > hideAfterDays);
}

/** A representative age inside a stage under the current cuts; null when the stage cannot happen. */
function stageAge(stage: Stage, cuts: RetentionCuts): number | null {
  if (stage === 'today') return 0;
  const { hideAfterDays: hide, eraseAfterDays: erase } = cuts;
  if (stage === 'afterHide') {
    if (!hideStageOpen(cuts)) return null;
    const middle = erase > 0 ? Math.round((hide + erase) / 2) : hide + DAYS_PER_MONTH;
    const month = toMonth(middle);
    return zoneForAge(month, cuts) === 'hidden' ? month : middle;
  }
  if (erase <= 0) return null;
  const beyond = Math.min(MAX_SCRUB_DAYS, erase + Math.max(DAYS_PER_MONTH, Math.round(erase / 4)));
  const month = toMonth(beyond);
  return month >= erase ? month : beyond;
}

export interface RecordCardProps extends RetentionCuts {
  mode: BuyerDataEraseMode;
  /** Age of the handle being grabbed, hovered or focused; wins over the slider. */
  handleAgeDays: number | null;
  /** Where the slider starts: the middle of the oldest month that still has orders. */
  defaultAgeDays: number;
  /** Kept for the studio's call site; the example is synthetic and no longer reads the samples. */
  plan?: BuyerDataPlan | null;
  /**
   * The example's age when the studio owns it (so the strip's marker and this card share one
   * value); absent, the card keeps its own.
   */
  ageDays?: number;
  onAgeChange?: (days: number) => void;
  /** A strip handle is being dragged: the values hide behind a skeleton and settle on release. */
  dragging?: boolean;
}

type RecordState = 'visible' | 'hidden' | 'visible-erased' | 'hidden-erased';

/** The previous value stays one beat, fading out under the new one. */
function useLeavingValue<T>(value: T): { id: number; value: T } | null {
  const [seen, setSeen] = useState<T>(value);
  const [leaving, setLeaving] = useState<{ id: number; value: T } | null>(null);
  if (seen !== value) {
    setSeen(value);
    setLeaving({ id: (leaving?.id ?? 0) + 1, value: seen });
  }
  return leaving;
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

/** Where an age sits on the slider, 0..1 (capped: it ends at ten years). */
function scrubPct(days: number): number {
  return Math.min(1, Math.max(0, days / MAX_SCRUB_DAYS));
}

interface RecordRowsProps {
  erased: boolean;
  hidden: boolean;
  loading: boolean;
  /** Bumped once per drag end: remounts the rows so they settle in. */
  revealKey: number;
}

/**
 * The rows only change when the shown state does, never per pointer move: while a handle is
 * dragged the card holds the state it had before the grab and covers it with a skeleton.
 */
const RecordRows = memo(function RecordRows({
  erased,
  hidden,
  loading,
  revealKey,
}: RecordRowsProps): ReactElement {
  const copy = useMessages('buyer-data').record;
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
  const reveal = (n: number): CSSProperties => ({ '--r': n }) as CSSProperties;

  return (
    <div
      key={revealKey}
      className={`record-card__rows${revealKey > 0 ? ' record-card__rows--reveal' : ''}`}
      role="list"
      aria-label={copy.tableLabel}
      aria-busy={loading}
      data-loading={loading ? 'true' : undefined}
      data-testid="record-rows"
    >
      <div
        className={`record-card__row${hidden ? ' is-changed' : ''}`}
        role="listitem"
        style={reveal(0)}
      >
        <span className="record-card__label">{copy.visibility}</span>
        <span className="record-card__values">
          <span data-testid="record-field-visibility" className="record-card__new">
            {hidden ? copy.valueHidden : copy.valueVisible}
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
          style={{ '--i': index, '--r': index + 1 } as CSSProperties}
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

      {staying.map((field, index) => (
        <div
          key={field.id}
          className="record-card__row"
          role="listitem"
          style={reveal(personal.length + 1 + index)}
        >
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
  );
});

export function RecordCard({
  hideAfterDays,
  eraseAfterDays,
  mode,
  handleAgeDays,
  defaultAgeDays,
  ageDays,
  onAgeChange,
  dragging = false,
}: RecordCardProps): ReactElement {
  const copy = useMessages('buyer-data').record;
  const shortPeriod = useShortPeriod();
  const [ownDays, setOwnDays] = useState(defaultAgeDays);
  const touched = useRef(false);
  const scrubDays = ageDays ?? ownDays;
  function setScrubDays(days: number): void {
    touched.current = true;
    setOwnDays(days);
    onAgeChange?.(days);
  }
  const cuts: RetentionCuts = { hideAfterDays, eraseAfterDays };

  // The default arrives with the histogram; follow it until the operator picks an age.
  useEffect(() => {
    if (touched.current) return;
    setOwnDays(defaultAgeDays);
  }, [defaultAgeDays]);

  const driven = handleAgeDays !== null;
  const age = handleAgeDays ?? scrubDays;
  const erased = eraseAfterDays > 0 && age >= eraseAfterDays;
  const hidden = (hideAfterDays > 0 && age >= hideAfterDays) || (mode === 'whole-order' && erased);

  const state: RecordState = erased
    ? hidden
      ? 'hidden-erased'
      : 'visible-erased'
    : hidden
      ? 'hidden'
      : 'visible';

  // While a handle is dragged the body keeps the state it had at the grab, behind a skeleton.
  const [frozen, setFrozen] = useState<RecordState>(state);
  if (!dragging && frozen !== state) setFrozen(state);
  const shown: RecordState = dragging ? frozen : state;
  const [wasDragging, setWasDragging] = useState(dragging);
  const [revealKey, setRevealKey] = useState(0);
  if (wasDragging !== dragging) {
    setWasDragging(dragging);
    if (!dragging) setRevealKey(revealKey + 1);
  }
  const pill: Record<RecordState, string> = {
    visible: copy.ribbonVisible,
    hidden: copy.ribbonHidden,
    'visible-erased': copy.ribbonVisibleErased,
    'hidden-erased': copy.ribbonHiddenErased,
  };
  const zoneName: Record<RecordState, string> = {
    visible: copy.zoneVisible,
    hidden: copy.zoneHidden,
    'visible-erased': copy.zoneErased,
    'hidden-erased': copy.zoneHiddenErased,
  };
  const zoneTone: Record<RecordState, 'keep' | 'hide' | 'erase'> = {
    visible: 'keep',
    hidden: 'hide',
    'visible-erased': 'erase',
    'hidden-erased': 'erase',
  };

  const sliderMonths = Math.min(MAX_SCRUB_MONTHS, Math.round(age / DAYS_PER_MONTH));
  const ageLabel = age <= 0 ? copy.today : shortPeriod(Math.max(age, 1));
  const ageText =
    daysToPeriod(Math.round(age)).unit === 'days' || age <= 0
      ? ageLabel
      : `${ageLabel} (${interpolate(copy.daysShort, { n: Math.round(age) })})`;

  // The stage presets are shortcuts for the slider: the selection is read off the age.
  const stage = STAGE_FOR_ZONE[zoneForAge(age, cuts)];
  const hideOpen = hideStageOpen(cuts);
  const eraseOpen = eraseAfterDays > 0;

  function pickStage(next: Stage): void {
    const days = stageAge(next, cuts);
    if (days === null) return;
    setScrubDays(days);
  }

  const hidePct = hideAfterDays > 0 ? scrubPct(hideAfterDays) * 100 : null;
  const erasePct = eraseAfterDays > 0 ? scrubPct(eraseAfterDays) * 100 : null;
  const keptEnd = hidePct ?? erasePct ?? 100;
  const hideSpan = hideOpen && hidePct !== null ? (erasePct ?? 100) - hidePct : 0;
  const eraseSpan = erasePct !== null ? 100 - erasePct : 0;

  const hideText =
    hideAfterDays > 0
      ? interpolate(copy.markHide, { age: shortPeriod(hideAfterDays) })
      : copy.markHideNever;
  const eraseText =
    eraseAfterDays > 0
      ? interpolate(copy.markErase, { age: shortPeriod(eraseAfterDays) })
      : copy.markEraseNever;

  const pillLeaving = useLeavingValue(shown);
  const zoneLeaving = useLeavingValue(state);

  const stageOptions: { value: Stage; label: string; off: string | null }[] = [
    { value: 'today', label: copy.stageToday, off: null },
    { value: 'afterHide', label: copy.stageHidden, off: hideOpen ? null : copy.stageHideOff },
    { value: 'afterErase', label: copy.stageErased, off: eraseOpen ? null : copy.stageEraseOff },
  ];

  return (
    <section
      className={`record-card record-card--${shown}`}
      aria-labelledby="record-card-title"
      data-testid="record-card"
      data-state={shown}
      aria-busy={dragging}
    >
      <header className="record-card__head">
        <h4 id="record-card-title">{copy.title}</h4>
        <span className="record-card__sample-tag">{copy.sampleTag}</span>
      </header>

      <SegmentedControl<Stage>
        aria-label={copy.stageLabel}
        value={stage}
        onChange={pickStage}
        options={stageOptions.map((option) => ({
          value: option.value,
          disabled: option.off !== null,
          'data-testid': `record-stage-${option.value}`,
          label:
            option.off === null ? (
              option.label
            ) : (
              <span title={option.off}>
                {option.label}
                <span className="sr-only"> ({option.off})</span>
              </span>
            ),
        }))}
      />

      <div className="record-card__pillbox" data-loading={dragging ? 'true' : undefined}>
        {pillLeaving !== null ? (
          <span
            key={pillLeaving.id}
            className={`record-card__pill record-card__pill--${pillLeaving.value} record-card__pill--out`}
            aria-hidden="true"
          >
            <StateIcon state={iconFor(pillLeaving.value)} />
            {pill[pillLeaving.value]}
          </span>
        ) : null}
        <p
          key={shown}
          className={`record-card__pill record-card__pill--${shown}`}
          data-testid="record-ribbon"
          role="status"
        >
          <StateIcon state={iconFor(shown)} />
          {pill[shown]}
        </p>
      </div>

      <RecordRows
        erased={shown === 'visible-erased' || shown === 'hidden-erased'}
        hidden={shown === 'hidden' || shown === 'hidden-erased'}
        loading={dragging}
        revealKey={revealKey}
      />

      <footer className="record-card__age">
        <div className="record-card__age-head">
          <label htmlFor="record-card-age">{driven ? copy.ageFromHandle : copy.ageTitle}</label>
          <span className="record-card__age-now">
            <span className="record-card__zone-box" data-testid="record-zone">
              {zoneLeaving !== null ? (
                <span
                  key={zoneLeaving.id}
                  className="record-card__zone-badge record-card__zone-badge--out"
                  aria-hidden="true"
                >
                  <i
                    className={`record-card__swatch record-card__swatch--${zoneTone[zoneLeaving.value]}`}
                  />
                  {zoneName[zoneLeaving.value]}
                </span>
              ) : null}
              <span key={state} className="record-card__zone-badge">
                <i className={`record-card__swatch record-card__swatch--${zoneTone[state]}`} />
                {zoneName[state]}
              </span>
            </span>
            <output htmlFor="record-card-age" className="record-card__age-value">
              {ageText}
            </output>
          </span>
        </div>
        <div className="record-card__scrub">
          <div className="record-card__rail" aria-hidden="true">
            <div className="record-card__track">
              <span
                className="record-card__seg record-card__seg--keep"
                style={{ '--l': 0, '--w': keptEnd } as CSSProperties}
              />
              <span
                className="record-card__seg record-card__seg--hide"
                style={{ '--l': hidePct ?? 0, '--w': hideSpan } as CSSProperties}
              />
              <span
                className="record-card__seg record-card__seg--erase"
                style={{ '--l': erasePct ?? 100, '--w': eraseSpan } as CSSProperties}
              />
            </div>
            {hidePct !== null ? (
              <i
                className="record-card__cut record-card__cut--hide"
                style={{ '--x': scrubPct(hideAfterDays) } as CSSProperties}
              />
            ) : null}
            {erasePct !== null ? (
              <i
                className="record-card__cut record-card__cut--erase"
                style={{ '--x': scrubPct(eraseAfterDays) } as CSSProperties}
              />
            ) : null}
          </div>
          <input
            id="record-card-age"
            type="range"
            min={0}
            max={MAX_SCRUB_MONTHS}
            step={1}
            value={sliderMonths}
            aria-valuetext={interpolate(copy.ageValueText, {
              age: ageLabel,
              zone: zoneName[state].toLocaleLowerCase(),
            })}
            data-testid="record-age"
            onChange={(event) => setScrubDays(Number(event.target.value) * DAYS_PER_MONTH)}
          />
        </div>
        <ul className="record-card__legend">
          <li className="record-card__legend-item" data-testid="record-legend-hide">
            <i
              className={`record-card__swatch record-card__swatch--${hideAfterDays > 0 ? 'hide' : 'never'}`}
              aria-hidden="true"
            />
            {hideText}
          </li>
          <li className="record-card__legend-item" data-testid="record-legend-erase">
            <i
              className={`record-card__swatch record-card__swatch--${eraseAfterDays > 0 ? 'erase' : 'never'}`}
              aria-hidden="true"
            />
            {eraseText}
          </li>
        </ul>
      </footer>
    </section>
  );
}
