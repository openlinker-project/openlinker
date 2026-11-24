/**
 * Plan Panel (#4289)
 *
 * "What will happen", in numbers: how many orders stay, how many are hidden,
 * how many lose their personal data, the ones left alone because they are still
 * in progress, and what is never touched. The figures come from the trial-run
 * endpoint (the same rule the job applies), so this is the proof the rules were
 * looked at before they are turned on. While a new answer is on its way the old
 * one is dimmed and labelled, never shown as if it were current.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Infotip } from '../../../shared/ui/infotip';
import type { BuyerDataEraseMode } from '../api/buyer-data.types';
import type { BuyerDataPlan } from '../hooks/use-buyer-data-plan';
import { OdometerNumber } from './odometer-number';

export interface PlanPanelProps {
  plan: BuyerDataPlan;
  mode: BuyerDataEraseMode;
  /** The rules on screen cannot be sent (period out of range). */
  invalid: boolean;
  /** Whose orders these numbers are about, when that is not obvious. */
  note?: string;
  /** The rail pins the `glance` (title, figures, bar) and scrolls the `detail`; the sheet shows `all`. */
  part?: 'all' | 'glance' | 'detail';
}

export function PlanPanel({
  plan,
  mode,
  invalid,
  note,
  part = 'all',
}: PlanPanelProps): ReactElement {
  const copy = useMessages('buyer-data').plan;
  const format = useFormat();
  const data = plan.data;

  const erased = data?.toErase ?? 0;
  const hidden = data === undefined ? 0 : Math.max(0, data.total - data.toErase);
  const stays = data === undefined ? 0 : Math.max(0, data.totalOrders - data.total);
  const whole = Math.max(1, stays + hidden + erased);

  const reasons: { id: string; label: string; n: number }[] =
    data === undefined
      ? []
      : [
          { id: 'openReturn', label: copy.reasonOpenReturn, n: data.skippedByReason.openReturn },
          { id: 'hold', label: copy.reasonHold, n: data.skippedByReason.hold },
          {
            id: 'invoicePending',
            label: copy.reasonInvoicePending,
            n: data.skippedByReason.invoicePending,
          },
        ].filter((reason) => reason.n > 0);

  const busy = plan.calculating && data !== undefined;
  const number = (n: number): ReactElement | string =>
    data === undefined ? (
      <span className="plan-panel__skeleton" aria-label={copy.calculating} />
    ) : (
      <OdometerNumber value={n} format={format.number} delta />
    );

  const glance = (
    <>
      <header className="plan-panel__head">
        <h4 id="plan-panel-title">{copy.title}</h4>
        <span className="plan-panel__status" role="status" data-testid="plan-status">
          {invalid
            ? copy.invalid
            : plan.isError
              ? copy.error
              : plan.calculating
                ? copy.calculating
                : plan.computedAt !== undefined
                  ? interpolate(copy.computedAt, { time: format.time(plan.computedAt) })
                  : ''}
        </span>
      </header>

      {note !== undefined ? (
        <p className="plan-panel__note" data-testid="plan-note">
          {note}
        </p>
      ) : null}

      <div className={`plan-panel__body${busy ? ' plan-panel__body--busy' : ''}`}>
        <dl className="plan-panel__numbers">
          <div className="plan-panel__number plan-panel__number--stays">
            <dt>
              <i className="plan-panel__swatch" aria-hidden="true" />
              {copy.stays}
            </dt>
            <dd data-testid="plan-stays">{number(stays)}</dd>
          </div>
          <div className="plan-panel__number plan-panel__number--hidden">
            <dt>
              <i className="plan-panel__swatch" aria-hidden="true" />
              {copy.hidden}
            </dt>
            <dd data-testid="plan-hidden">{number(hidden)}</dd>
          </div>
          <div className="plan-panel__number plan-panel__number--erased">
            <dt>
              <i className="plan-panel__swatch" aria-hidden="true" />
              {copy.erased}
            </dt>
            <dd data-testid="plan-erased">{number(erased)}</dd>
          </div>
        </dl>

        <div className="plan-panel__bar" aria-hidden="true">
          <span
            className="plan-panel__seg plan-panel__seg--stays"
            style={{ width: `${(stays / whole) * 100}%` }}
          />
          <span
            className="plan-panel__seg plan-panel__seg--hidden"
            style={{ width: `${(hidden / whole) * 100}%` }}
          />
          <span
            className="plan-panel__seg plan-panel__seg--erased"
            style={{ width: `${(erased / whole) * 100}%` }}
          />
        </div>
      </div>
    </>
  );

  const detail = (
    <>
      <div className="plan-panel__body">
        {data !== undefined ? (
          <p
            key={`${stays}-${hidden}-${erased}-${mode}`}
            className="plan-panel__sentence"
            data-testid="plan-sentence"
          >
            {interpolate(mode === 'whole-order' ? copy.sentenceWhole : copy.sentence, {
              total: format.number(data.totalOrders),
              stays: format.number(stays),
              hidden: format.number(hidden),
              erased: format.number(erased),
            })}
          </p>
        ) : null}

        {data !== undefined && data.skippedProtected > 0 ? (
          <div className="plan-panel__skipped" data-testid="plan-skipped">
            <strong>
              <svg viewBox="0 0 16 16" className="plan-panel__shield" aria-hidden="true">
                <path
                  d="M8 1.5 13 3.5V8c0 3-2 5-5 6.5C5 13 3 11 3 8V3.5L8 1.5Zm-.7 9 3.6-3.6-1-1-2.6 2.6-1.2-1.2-1 1 2.2 2.2Z"
                  fill="currentColor"
                />
              </svg>
              {interpolate(copy.skipped, { n: format.number(data.skippedProtected) })}
            </strong>
            <p className="plan-panel__skipped-why">{copy.skippedWhy}</p>
            {reasons.length > 0 ? (
              <ul>
                {reasons.map((reason) => (
                  <li key={reason.id}>
                    {reason.label}: {format.number(reason.n)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="plan-panel__untouched">
        <span>
          <strong>{copy.untouchedTitle}</strong>{' '}
          <Infotip
            ariaLabel={copy.untouchedTitle}
            definitions={[
              { term: copy.untouchedInvoices, text: copy.untouchedInvoicesText },
              { term: copy.untouchedShops, text: copy.untouchedShopsText },
              { term: copy.untouchedBackups, text: copy.untouchedBackupsText },
            ]}
          />
        </span>
        <ul>
          <li>{copy.untouchedInvoices}</li>
          <li>{copy.untouchedShops}</li>
          <li>{copy.untouchedBackups}</li>
        </ul>
      </div>
    </>
  );

  if (part === 'detail') {
    return (
      <div className="plan-panel plan-panel--detail" data-testid="plan-detail">
        {detail}
      </div>
    );
  }

  return (
    <aside
      className={`plan-panel${plan.calculating ? ' plan-panel--busy' : ''}`}
      aria-labelledby="plan-panel-title"
      data-testid="plan-panel"
    >
      {glance}
      {part === 'all' ? detail : null}
    </aside>
  );
}
