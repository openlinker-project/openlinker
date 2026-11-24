/**
 * Age Strip (#4289)
 *
 * Orders by month of age with two handles on the axis: where they start to be
 * HIDDEN (reversible) and where their personal data is ERASED (not). Dragging a
 * handle is how an operator sets the rule, and the bars, zone counts and the
 * example order answer at once, so the consequence is seen while it is chosen.
 *
 * Built from plain elements and CSS (no chart library): the bars are a flex row,
 * the handles are absolutely placed `role="slider"` buttons. Pointer capture
 * makes touch work; the keyboard steps through detents; a table disclosure and
 * a debounced polite live region carry the same facts for a screen reader.
 * Colour is never the only signal: zones differ by hatching and by label.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { BUYER_DATA_MIN_DAYS } from '../lib/buyer-data-config';
import { useShortPeriod } from '../hooks/use-short-period';
import type { BuyerDataAgeHistogram } from '../api/buyer-data.types';
import {
  AXIS_MONTHS,
  AXIS_PCT,
  DAYS_PER_MONTH,
  NEVER_VALUE,
  RECOMMENDED_DETENTS,
  RETENTION_DETENTS,
  clampDays,
  daysToPct,
  monthToAgeDays,
  moveErase,
  moveHide,
  nextDetent,
  pctToDays,
  prevDetent,
  zoneForAge,
  type RetentionCuts,
  type RetentionZone,
} from '../lib/retention-scale';

export type HandleKind = 'hide' | 'erase';

export interface StripCounts {
  kept: number;
  hidden: number;
  erased: number;
  /** Of `hidden` / `erased`: orders the retention job already processed. */
  alreadyHidden?: number;
  alreadyErased?: number;
  /** Computed from the histogram, not yet confirmed by the server. */
  estimated: boolean;
  /** The server is still working on the rules on screen. */
  calculating: boolean;
}

export interface AgeStripProps extends RetentionCuts {
  histogram: BuyerDataAgeHistogram | undefined;
  histogramState: 'loading' | 'error' | 'ready';
  /** `null` while there is nothing to show yet (never a zero). */
  counts: StripCounts | null;
  onChange: (cuts: RetentionCuts) => void;
  /** The age a handle is at while grabbed, hovered or focused; `null` when none is. */
  onActive: (days: number | null) => void;
  disabled?: boolean;
  /** Ghosted: the values are inherited and a grab turns them into own values. */
  ghost?: boolean;
}

const COLUMNS = AXIS_MONTHS;

function columnsOf(histogram: BuyerDataAgeHistogram | undefined): number[] {
  const columns = new Array<number>(COLUMNS).fill(0);
  for (const bucket of histogram?.buckets ?? []) {
    const index = Math.min(Math.max(0, bucket.ageMonths), COLUMNS - 1);
    columns[index] = (columns[index] ?? 0) + bucket.visible + bucket.hidden + bucket.erased;
  }
  return columns;
}

interface HandleProps {
  kind: HandleKind;
  days: number;
  trackRef: RefObject<HTMLDivElement | null>;
  label: string;
  valueText: string;
  flagText: string;
  disabled: boolean;
  onMove: (days: number) => void;
  onActive: (days: number | null) => void;
}

function Handle({
  kind,
  days,
  trackRef,
  label,
  valueText,
  flagText,
  disabled,
  onMove,
  onActive,
}: HandleProps): ReactElement {
  const [dragging, setDragging] = useState(false);
  // Synchronous twin of `dragging`: a move right behind the press must not be dropped
  // for want of a render, and a stray move after the press ended must not count.
  const dragRef = useRef(false);
  const pct = daysToPct(days);
  const never = days <= 0;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = nextDetent(days);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = prevDetent(days);
        break;
      case 'PageUp':
        next = nextDetent(days, 2);
        break;
      case 'PageDown':
        next = prevDetent(days, 2);
        break;
      case 'Home':
        next = BUYER_DATA_MIN_DAYS;
        break;
      case 'End':
        next = 0;
        break;
      default:
        return;
    }
    event.preventDefault();
    onMove(next);
    onActive(next);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>): void {
    dragRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId) === true) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setDragging(false);
    onActive(null);
  }

  function moveTo(event: PointerEvent<HTMLButtonElement>): void {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    // A lost pointerup leaves the drag "on" with no button pressed: end it, never follow it.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      endDrag(event);
      return;
    }
    const next = pctToDays(((event.clientX - rect.left) / rect.width) * 100, event.shiftKey);
    onMove(next);
    onActive(next);
  }

  return (
    <div
      className={`age-strip__handle age-strip__handle--${kind}${dragging ? ' age-strip__handle--dragging' : ''}${pct > 70 ? ' age-strip__handle--flip' : ''}`}
      style={{ left: `${pct}%` }}
    >
      <span className="age-strip__line" aria-hidden="true" />
      <button
        type="button"
        role="slider"
        className="age-strip__flag"
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={BUYER_DATA_MIN_DAYS}
        aria-valuemax={NEVER_VALUE}
        aria-valuenow={never ? NEVER_VALUE : clampDays(days)}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        data-testid={`age-strip-handle-${kind}`}
        onKeyDown={onKeyDown}
        onFocus={() => onActive(never ? null : days)}
        onBlur={() => onActive(null)}
        onPointerEnter={() => {
          if (!dragRef.current) onActive(never ? null : days);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) onActive(null);
        }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragRef.current = true;
          setDragging(true);
          onActive(never ? null : days);
        }}
        onPointerMove={(event) => {
          if (dragRef.current) moveTo(event);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={(event) => {
          if (dragRef.current) endDrag(event);
        }}
      >
        {kind === 'erase' ? (
          <svg viewBox="0 0 16 16" className="age-strip__lock" aria-hidden="true">
            <path
              d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7h1Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z"
              fill="currentColor"
            />
          </svg>
        ) : null}
        <span>{flagText}</span>
      </button>
    </div>
  );
}

export function AgeStrip({
  hideAfterDays,
  eraseAfterDays,
  histogram,
  histogramState,
  counts,
  onChange,
  onActive,
  disabled = false,
  ghost = false,
}: AgeStripProps): ReactElement {
  const copy = useMessages('buyer-data').strip;
  const format = useFormat();
  const shortPeriod = useShortPeriod();
  const trackRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const cuts: RetentionCuts = { hideAfterDays, eraseAfterDays };
  const columns = useMemo(() => columnsOf(histogram), [histogram]);
  const max = Math.max(1, ...columns);

  function apply(kind: HandleKind, days: number): void {
    const change = kind === 'hide' ? moveHide(cuts, days) : moveErase(cuts, days);
    if (change.hideAfterDays === hideAfterDays && change.eraseAfterDays === eraseAfterDays) {
      return;
    }
    setNote(change.moved ? (kind === 'hide' ? copy.pushed : copy.clamped) : null);
    onChange({ hideAfterDays: change.hideAfterDays, eraseAfterDays: change.eraseAfterDays });
  }

  const hideText =
    hideAfterDays > 0
      ? interpolate(copy.handleHide, { when: shortPeriod(hideAfterDays) })
      : copy.handleHideNever;
  const eraseText =
    eraseAfterDays > 0
      ? interpolate(copy.handleErase, { when: shortPeriod(eraseAfterDays) })
      : copy.handleEraseNever;

  const approx = (n: number | undefined): string => (n === undefined ? '' : format.number(n));
  const hideValueText =
    hideAfterDays > 0
      ? interpolate(copy.valueHide, {
          when: shortPeriod(hideAfterDays),
          n: approx(counts === null ? undefined : counts.hidden + counts.erased),
        })
      : copy.valueHideNever;
  const eraseValueText =
    eraseAfterDays > 0
      ? interpolate(copy.valueErase, {
          when: shortPeriod(eraseAfterDays),
          n: approx(counts?.erased),
        })
      : copy.valueEraseNever;

  const announcement = useDebouncedValue(
    counts === null
      ? `${hideText}. ${eraseText}.`
      : interpolate(copy.announce, {
          hide: hideText,
          erase: eraseText,
          kept: format.number(counts.kept),
          hidden: format.number(counts.hidden),
          erased: format.number(counts.erased),
        }),
    600
  );

  const bands = useMemo(() => {
    const edges = [0, ...RETENTION_DETENTS];
    return edges.map((from, index) => {
      const to = edges[index + 1] ?? Infinity;
      let orders = 0;
      for (const bucket of histogram?.buckets ?? []) {
        const age = monthToAgeDays(bucket.ageMonths);
        if (age >= from && age < to) orders += bucket.visible + bucket.hidden + bucket.erased;
      }
      return { from, to, orders, zone: zoneForAge(from, cuts) };
    });
  }, [histogram, hideAfterDays, eraseAfterDays]);

  const zoneLabel: Record<RetentionZone, string> = {
    kept: copy.fateKept,
    hidden: copy.fateHidden,
    erased: copy.fateErased,
  };

  const hidePct = hideAfterDays > 0 ? daysToPct(hideAfterDays) : null;
  const erasePct = eraseAfterDays > 0 ? daysToPct(eraseAfterDays) : null;
  const hiddenFrom = hidePct ?? AXIS_PCT;
  const hiddenTo = erasePct ?? AXIS_PCT;

  const stat = (n: number | undefined, already?: number): ReactElement =>
    counts === null || n === undefined ? (
      <span className="age-strip__skeleton" aria-label={copy.calculating} />
    ) : (
      <>
        <strong className={counts.calculating ? 'age-strip__stat--busy' : undefined}>
          {counts.estimated || counts.calculating ? '≈ ' : ''}
          {format.number(n)}
        </strong>
        {already !== undefined && already > 0 ? (
          <small className="age-strip__already">
            {interpolate(copy.zoneAlready, { n: format.number(already) })}
          </small>
        ) : null}
      </>
    );

  return (
    <div className={`age-strip${ghost ? ' age-strip--ghost' : ''}`} data-testid="age-strip">
      <div className="age-strip__zones">
        <div className="age-strip__zone age-strip__zone--kept">
          <span className="age-strip__zone-label">{copy.zoneKept}</span>
          {stat(counts?.kept)}
        </div>
        <div className="age-strip__zone age-strip__zone--hidden">
          <span className="age-strip__zone-label">
            {copy.zoneHidden} <small>{copy.zoneHiddenNote}</small>
          </span>
          {stat(counts?.hidden, counts?.alreadyHidden)}
        </div>
        <div className="age-strip__zone age-strip__zone--erased">
          <span className="age-strip__zone-label">
            {copy.zoneErased} <small>{copy.zoneErasedNote}</small>
          </span>
          {stat(counts?.erased, counts?.alreadyErased)}
        </div>
      </div>

      {histogramState === 'error' ? (
        <p
          className="age-strip__message age-strip__message--error"
          role="alert"
          data-testid="age-strip-error"
        >
          {copy.error}
        </p>
      ) : histogramState === 'loading' ? (
        <div className="age-strip__placeholder" aria-busy="true" data-testid="age-strip-loading">
          {copy.loading}
        </div>
      ) : histogram !== undefined && histogram.totalOrders === 0 ? (
        <div className="age-strip__placeholder" data-testid="age-strip-empty">
          <strong>{copy.emptyTitle}</strong>
          <span>{copy.emptyBody}</span>
        </div>
      ) : (
        <>
          <div className="age-strip__canvas">
            <div className="age-strip__track" ref={trackRef} data-testid="age-strip-track">
              <div className="age-strip__plot" style={{ width: `${AXIS_PCT}%` }}>
                <div
                  className="age-strip__band age-strip__band--hidden"
                  style={{
                    left: `${(hiddenFrom / AXIS_PCT) * 100}%`,
                    width: `${((hiddenTo - hiddenFrom) / AXIS_PCT) * 100}%`,
                  }}
                />
                {erasePct !== null ? (
                  <div
                    className="age-strip__band age-strip__band--erased"
                    style={{ left: `${(erasePct / AXIS_PCT) * 100}%`, right: 0 }}
                  />
                ) : null}
                <div className="age-strip__bars">
                  {columns.map((n, month) => {
                    const zone = zoneForAge(monthToAgeDays(month), cuts);
                    return (
                      <span
                        key={month}
                        className="age-strip__col"
                        title={interpolate(copy.barTitle, {
                          age: shortPeriod(Math.max(month, 1) * DAYS_PER_MONTH),
                          n: format.number(n),
                        })}
                      >
                        <span
                          className={`age-strip__bar age-strip__bar--${zone}`}
                          data-zone={zone}
                          style={{ height: `${n === 0 ? 0 : Math.max(4, (n / max) * 100)}%` }}
                        />
                      </span>
                    );
                  })}
                </div>
                {RECOMMENDED_DETENTS.map((d) => (
                  <span
                    key={d}
                    className="age-strip__tick"
                    style={{ left: `${(daysToPct(d) / AXIS_PCT) * 100}%` }}
                    aria-hidden="true"
                  />
                ))}
              </div>
              <div className="age-strip__never" style={{ left: `${AXIS_PCT}%` }} aria-hidden="true">
                <span>{copy.neverSlot}</span>
              </div>
              <span className="age-strip__today" aria-hidden="true" />
              <Handle
                kind="hide"
                days={hideAfterDays}
                trackRef={trackRef}
                label={copy.sliderHide}
                valueText={hideValueText}
                flagText={hideText}
                disabled={disabled}
                onMove={(d) => apply('hide', d)}
                onActive={onActive}
              />
              <Handle
                kind="erase"
                days={eraseAfterDays}
                trackRef={trackRef}
                label={copy.sliderErase}
                valueText={eraseValueText}
                flagText={eraseText}
                disabled={disabled}
                onMove={(d) => apply('erase', d)}
                onActive={onActive}
              />
            </div>
            <div className="age-strip__axis" aria-hidden="true">
              <span style={{ left: 0 }}>{copy.today}</span>
              {[730, 1825].map((d) => (
                <span key={d} style={{ left: `${daysToPct(d)}%` }}>
                  {shortPeriod(d)}
                </span>
              ))}
              <span style={{ left: `${AXIS_PCT}%` }} className="age-strip__axis-end">
                {copy.axisMax}
              </span>
            </div>
          </div>

          <div className="age-strip__steppers">
            {(['hide', 'erase'] as const).map((kind) => {
              const days = kind === 'hide' ? hideAfterDays : eraseAfterDays;
              return (
                <div key={kind} className="age-strip__stepper">
                  <span>{kind === 'hide' ? copy.sliderHide : copy.sliderErase}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${kind === 'hide' ? copy.sliderHide : copy.sliderErase}: ${copy.shorter}`}
                    onClick={() => apply(kind, prevDetent(days))}
                  >
                    {copy.stepLess}
                  </button>
                  <output>{days > 0 ? shortPeriod(days) : copy.never}</output>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${kind === 'hide' ? copy.sliderHide : copy.sliderErase}: ${copy.longer}`}
                    onClick={() => apply(kind, nextDetent(days))}
                  >
                    {copy.stepMore}
                  </button>
                </div>
              );
            })}
          </div>

          {note !== null ? (
            <p className="age-strip__note" data-testid="age-strip-note">
              {note}
            </p>
          ) : null}

          <details className="age-strip__table">
            <summary>{copy.showTable}</summary>
            <table>
              <caption className="sr-only">{copy.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.tableAge}</th>
                  <th scope="col">{copy.tableOrders}</th>
                  <th scope="col">{copy.tableFate}</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((band) => (
                  <tr key={band.from}>
                    <td>
                      {band.from === 0
                        ? copy.today
                        : band.to === Infinity
                          ? `${shortPeriod(band.from)}+`
                          : `${shortPeriod(band.from)} – ${shortPeriod(band.to)}`}
                    </td>
                    <td>{format.number(band.orders)}</td>
                    <td>{zoneLabel[band.zone]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite" data-testid="age-strip-live">
        {announcement}
      </p>
    </div>
  );
}
