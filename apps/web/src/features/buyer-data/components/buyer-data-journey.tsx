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
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { usePeriodLabel } from '../hooks/use-period-label';
import type { BuyerDataRules } from '../api/buyer-data.types';

type Stage = 'today' | 'hidden' | 'erased';

export function BuyerDataJourney({ rules }: { rules: BuyerDataRules }): ReactElement {
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
      <div className="buyer-data-journey__grid" role="list" aria-label={copy.label}>
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
          return (
            <article
              key={stage}
              className="panel panel--dense"
              role="listitem"
              data-testid={`buyer-data-journey-${stage}`}
            >
              <p className="eyebrow">{when}</p>
              <StatusBadge tone={tones[stage]}>{state}</StatusBadge>
              <KeyValueList
                items={[
                  {
                    id: 'buyer',
                    label: copy.buyer,
                    value: erased ? copy.erasedBuyer : copy.exampleBuyer,
                    mono: erased,
                  },
                  {
                    id: 'email',
                    label: copy.email,
                    value: erased ? copy.erased : copy.exampleEmail,
                  },
                  {
                    id: 'address',
                    label: copy.address,
                    value: erased ? copy.erased : copy.exampleAddress,
                  },
                  { id: 'amount', label: copy.amount, value: copy.exampleTotal },
                ]}
              />
              <p className="muted-text">{note}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
