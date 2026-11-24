/**
 * Buyer Data Wizard Step (#4289)
 *
 * The new-connection wizard's answer to "which buyer data rules apply": the
 * general ones (the recommended default, so a connection created without
 * touching this is governed like every other) or its own. Controlled - the
 * wizard keeps the value in its form state and maps it to config at submit.
 * Own rules store the periods only and follow the general switch. A connection that does not exist yet has no
 * orders, so the compact studio (inputs and the example order) is shown without
 * the strip and the plan; those appear in the connection edit.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useOperationalSettingsQuery } from '../../settings';
import type { BuyerDataWizardChoice, BuyerDataWizardValue } from '../api/buyer-data.types';
import { useBuyerDataSummary } from '../hooks/use-buyer-data-summary';
import { globalRulesFromSettings } from '../lib/buyer-data-config';
import { RetentionStudio } from './retention-studio';

export interface BuyerDataWizardStepProps {
  value: BuyerDataWizardValue;
  onChange: (next: BuyerDataWizardValue) => void;
}

export function BuyerDataWizardStep({ value, onChange }: BuyerDataWizardStepProps): ReactElement {
  const copy = useMessages('buyer-data').wizard;
  const summarise = useBuyerDataSummary();
  const globalRules = globalRulesFromSettings(useOperationalSettingsQuery().data);
  const own = value.choice === 'own';
  const rules = value.rules ?? { ...globalRules, enabled: false };

  function choose(choice: BuyerDataWizardChoice): void {
    onChange({ choice, rules: choice === 'own' ? rules : value.rules });
  }

  return (
    <section className="rate-limit-section" data-testid="buyer-data-wizard-step">
      <h3 className="rate-limit-section__title">{copy.heading}</h3>
      <p className="rate-limit-section__help">{copy.help}</p>
      <SegmentedControl<BuyerDataWizardChoice>
        aria-label={copy.sourceLabel}
        value={value.choice}
        onChange={choose}
        options={[
          { value: 'inherit', label: copy.inheritOption },
          { value: 'own', label: copy.ownOption },
        ]}
      />
      {own ? (
        <>
          <p className="rate-limit-section__help">{copy.ownNote}</p>
          <RetentionStudio
            name="wizard"
            variant="compact"
            plan={null}
            rules={rules}
            onChange={(next) => onChange({ choice: 'own', rules: next })}
          />
        </>
      ) : (
        <>
          <p className="rate-limit-section__help">{copy.inheritNote}</p>
          <p className="rate-limit-section__help">
            {interpolate(copy.summary, { summary: summarise(globalRules) })}
          </p>
        </>
      )}
    </section>
  );
}

/** The review step's "Buyer data" row; a fragment so it sits directly inside the review `dl`. */
export function BuyerDataWizardReviewRows({
  value,
}: {
  value: BuyerDataWizardValue;
}): ReactElement {
  const copy = useMessages('buyer-data').wizard;
  const summarise = useBuyerDataSummary();
  return (
    <>
      <dt>{copy.reviewLabel}</dt>
      <dd>
        {value.choice === 'own' && value.rules !== null
          ? interpolate(copy.reviewOwn, { summary: summarise(value.rules) })
          : copy.reviewGeneral}
      </dd>
    </>
  );
}
