/**
 * Buyer Data Journey (#4289)
 *
 * One made-up order shown at each step the rules would take it through: on the
 * list today, hidden, personal data erased. It is the "what will this do to a
 * real order" answer a number of days cannot give.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { usePeriodLabel } from '../hooks/use-period-label';
import type { BuyerDataRules } from '../api/buyer-data.types';

type Stage = 'today' | 'hidden' | 'erased';

export function BuyerDataJourney({
  rules,
  idPrefix = 'main',
}: {
  rules: BuyerDataRules;
  /** Keeps heading ids unique when two journeys share a page. */
  idPrefix?: string;
}): ReactElement {
  const copy = useMessages('buyer-data').journey;
  const periodLabel = usePeriodLabel();
  const whole = rules.mode === 'whole-order';

  const stages: { stage: Stage; when: string }[] = [{ stage: 'today', when: copy.today }];
  if (rules.hideAfterDays > 0) {
    stages.push({ stage: 'hidden', when: periodLabel(rules.hideAfterDays, { capitalize: true }) });
  }
  if (rules.eraseAfterDays > 0) {
    stages.push({ stage: 'erased', when: periodLabel(rules.eraseAfterDays, { capitalize: true }) });
  }

  const tones: Record<Stage, StatusBadgeTone> = {
    today: 'success',
    hidden: 'warning',
    erased: 'info',
  };

  return (
    <div className="buyer-data-journey" data-testid="buyer-data-journey">
      <p className="rate-limit-section__help">{copy.hint}</p>
      <ol className="buyer-data-journey__list" aria-label={copy.label}>
        {stages.map(({ stage, when }) => {
          const erased = stage === 'erased';
          const state =
            stage === 'today'
              ? copy.stateVisible
              : stage === 'hidden'
                ? copy.stateHidden
                : whole
                  ? copy.stateErasedOrder
                  : copy.stateErased;
          const note =
            stage === 'today'
              ? copy.noteToday
              : stage === 'hidden'
                ? copy.noteHidden
                : whole
                  ? copy.noteErasedOrder
                  : copy.noteErasedPersonal;
          const rows: { id: string; label: string; value: string }[] = [
            {
              id: 'buyer',
              label: copy.buyer,
              value: erased ? copy.erasedBuyer : copy.exampleBuyer,
            },
            { id: 'email', label: copy.email, value: erased ? copy.erased : copy.exampleEmail },
            {
              id: 'address',
              label: copy.address,
              value: erased ? copy.erased : copy.exampleAddress,
            },
            { id: 'amount', label: copy.amount, value: copy.exampleTotal },
          ];
          const headingId = `buyer-data-journey-${idPrefix}-${stage}`;
          return (
            <li
              key={stage}
              className="panel panel--dense buyer-data-journey__item"
              aria-labelledby={headingId}
              data-testid={`buyer-data-journey-${stage}`}
            >
              <div className="buyer-data-journey__head">
                <h4 id={headingId} className="eyebrow">
                  {when}
                </h4>
                <StatusBadge tone={tones[stage]}>{state}</StatusBadge>
              </div>
              <dl className="buyer-data-journey__facts">
                {rows.map((row) => (
                  <div key={row.id} className="buyer-data-journey__fact">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted-text">{note}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
