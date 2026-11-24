/**
 * Record Card (#4289)
 *
 * One made-up order that LIVES with the rules: it shows what the order looks
 * like at the age the operator is pointing at, whether that age comes from a
 * handle on the strip (while it is grabbed or hovered) or from the card's own
 * age slider. Before the hide cut it is an ordinary order; past it the order is
 * marked hidden; past the erase cut the personal fields are replaced by their
 * placeholder while the rows that must stay (items, amount, invoice, number)
 * are marked as kept for the books.
 *
 * Every value is synthetic: the card never touches a real order.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useShortPeriod } from '../hooks/use-short-period';
import type { BuyerDataEraseMode } from '../api/buyer-data.types';
import { DAYS_PER_MONTH, AXIS_MONTHS, type RetentionCuts } from '../lib/retention-scale';

type Sample = 'fresh' | 'old' | 'protected';

const SAMPLE_AGE_DAYS: Record<Exclude<Sample, 'protected'>, number> = { fresh: 0, old: 900 };
const MAX_SCRUB_MONTHS = AXIS_MONTHS;

export interface RecordCardProps extends RetentionCuts {
  mode: BuyerDataEraseMode;
  /** Age of the handle being grabbed, hovered or focused; wins over the slider. */
  handleAgeDays: number | null;
  /** Where the slider starts: the middle of the oldest month that still has orders. */
  defaultAgeDays: number;
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

function ShieldIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="record-card__icon" aria-hidden="true">
      <path
        d="M8 1.5 13 3.5V8c0 3-2 5-5 6.5C5 13 3 11 3 8V3.5L8 1.5Zm-.7 9 3.6-3.6-1-1-2.6 2.6-1.2-1.2-1 1 2.2 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RecordCard({
  hideAfterDays,
  eraseAfterDays,
  mode,
  handleAgeDays,
  defaultAgeDays,
}: RecordCardProps): ReactElement {
  const copy = useMessages('buyer-data').record;
  const shortPeriod = useShortPeriod();
  const [sample, setSample] = useState<Sample>('old');
  const [scrubDays, setScrubDays] = useState(defaultAgeDays);
  const [holding, setHolding] = useState(false);
  const touched = useRef(false);

  // The default arrives with the histogram; follow it until the operator picks an age.
  useEffect(() => {
    if (!touched.current) setScrubDays(defaultAgeDays);
  }, [defaultAgeDays]);

  const isProtected = sample === 'protected';
  const age = holding ? 0 : handleAgeDays ?? scrubDays;
  const erased = !isProtected && eraseAfterDays > 0 && age >= eraseAfterDays;
  const hidden =
    !isProtected &&
    ((hideAfterDays > 0 && age >= hideAfterDays) || (mode === 'whole-order' && erased));

  const state = isProtected
    ? 'protected'
    : erased
      ? hidden
        ? 'hidden-erased'
        : 'visible-erased'
      : hidden
        ? 'hidden'
        : 'visible';
  const ribbon: Record<typeof state, string> = {
    visible: copy.ribbonVisible,
    hidden: copy.ribbonHidden,
    'visible-erased': copy.ribbonVisibleErased,
    'hidden-erased': copy.ribbonHiddenErased,
    protected: copy.ribbonProtected,
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
        onChange={(next) => {
          setSample(next);
          if (next !== 'protected') {
            touched.current = true;
            setScrubDays(SAMPLE_AGE_DAYS[next]);
          }
        }}
        options={[
          { value: 'fresh', label: copy.sampleFresh },
          { value: 'old', label: copy.sampleOld },
          { value: 'protected', label: copy.sampleProtected },
        ]}
      />

      <p className="record-card__ribbon" data-testid="record-ribbon" role="status">
        {isProtected ? <ShieldIcon /> : null}
        {ribbon[state]}
      </p>

      <dl className="record-card__fields">
        {personal.map((field, index) => {
          const gone = erased;
          return (
            <div key={field.id} className="record-card__row">
              <dt>{field.label}</dt>
              <dd
                data-testid={`record-field-${field.id}`}
                className={
                  gone ? 'record-card__value record-card__value--redacted' : 'record-card__value'
                }
                style={{ '--i': index } as CSSProperties}
              >
                {gone ? field.redacted : field.value}
              </dd>
            </div>
          );
        })}
        {staying.map((field) => (
          <div key={field.id} className="record-card__row record-card__row--stays">
            <dt>{field.label}</dt>
            <dd data-testid={`record-field-${field.id}`} className="record-card__value">
              {field.value}
              {erased ? (
                <span className="record-card__stays">
                  <LockIcon />
                  {copy.stays}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      {isProtected ? (
        <p className="record-card__protected-note">{copy.protectedNote}</p>
      ) : (
        <div className="record-card__age">
          <label htmlFor="record-card-age">
            {handleAgeDays !== null && !holding
              ? interpolate(copy.ageFromHandle, { age: ageLabel })
              : interpolate(copy.ageLabel, { age: ageLabel })}
          </label>
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
              setScrubDays(Number(event.target.value) * DAYS_PER_MONTH);
            }}
          />
          <button
            type="button"
            className="button button--secondary button--sm record-card__hold"
            data-testid="record-hold"
            onPointerDown={() => setHolding(true)}
            onPointerUp={() => setHolding(false)}
            onPointerLeave={() => setHolding(false)}
            onBlur={() => setHolding(false)}
            onKeyDown={(event) => {
              if (event.key === ' ') {
                event.preventDefault();
                setHolding(true);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ') setHolding(false);
            }}
          >
            {copy.hold}
          </button>
        </div>
      )}
    </section>
  );
}
