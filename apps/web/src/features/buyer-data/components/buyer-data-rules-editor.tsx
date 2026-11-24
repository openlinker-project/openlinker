/**
 * Buyer Data Rules Editor (#4289)
 *
 * The guided body shared by the general settings page, the connection edit and
 * the new-connection wizard: two numbered questions (when to hide, when to
 * erase), what an erase does, an irreversibility warning, a one-line summary and
 * the example order. The caller owns the value and says whether impact counts
 * apply; the editor only asks.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { usePeriodLabel } from '../hooks/use-period-label';
import { isBuyerDataEraseMode, type BuyerDataRules } from '../api/buyer-data.types';
import {
  ERASE_PRESET_DAYS,
  HIDE_PRESET_DAYS,
  validateBuyerDataRules,
} from '../lib/buyer-data-config';
import { BuyerDataJourney } from './buyer-data-journey';
import { BuyerDataPeriodField } from './buyer-data-period-field';

export interface BuyerDataRulesEditorProps {
  rules: BuyerDataRules;
  onChange: (next: BuyerDataRules) => void;
  /** Id prefix keeping field names unique when two editors share a page. */
  name: string;
  disabled?: boolean;
  /** False shows only the summary and the example order (rules inherited, not editable here). */
  showQuestions?: boolean;
}

/** The one-line summary of what a set of rules does, also used outside the editor. */
export function useBuyerDataSummary(): (rules: BuyerDataRules) => string {
  const copy = useMessages('buyer-data').rules;
  const periodLabel = usePeriodLabel();
  return (rules) => {
    const hide =
      rules.hideAfterDays > 0
        ? interpolate(copy.summaryHideOn, { when: periodLabel(rules.hideAfterDays) })
        : copy.summaryHideNever;
    const erase =
      rules.eraseAfterDays <= 0
        ? copy.summaryEraseNever
        : interpolate(
            rules.mode === 'whole-order' ? copy.summaryEraseWhole : copy.summaryErasePersonal,
            { when: periodLabel(rules.eraseAfterDays) }
          );
    return `${hide} ${erase}`;
  };
}

export function BuyerDataRulesEditor({
  rules,
  onChange,
  name,
  disabled = false,
  showQuestions = true,
}: BuyerDataRulesEditorProps): ReactElement {
  const copy = useMessages('buyer-data').rules;
  const periodCopy = useMessages('buyer-data').period;
  const summarise = useBuyerDataSummary();
  const issues = validateBuyerDataRules(rules);

  const hideError = issues.includes('hide-range') ? periodCopy.errorRange : undefined;
  const eraseError = issues.includes('erase-range')
    ? periodCopy.errorRange
    : issues.includes('erase-before-hide')
      ? copy.eraseBeforeHide
      : undefined;

  return (
    <div data-testid="buyer-data-rules-editor">
      {showQuestions ? (
        <div className="form-field">
          <div>
            <BuyerDataPeriodField
              name={`${name}-hide`}
              label={`${copy.stepHide}. ${copy.hideLabel}`}
              description={copy.hideDescription}
              neverLabel={copy.hideNever}
              presets={HIDE_PRESET_DAYS}
              value={rules.hideAfterDays}
              onChange={(days) => onChange({ ...rules, hideAfterDays: days })}
              error={hideError}
              disabled={disabled}
            />
          </div>
          <div>
            <BuyerDataPeriodField
              name={`${name}-erase`}
              label={`${copy.stepErase}. ${copy.eraseLabel}`}
              description={copy.eraseDescription}
              neverLabel={copy.eraseNever}
              presets={ERASE_PRESET_DAYS}
              value={rules.eraseAfterDays}
              onChange={(days) => onChange({ ...rules, eraseAfterDays: days })}
              error={eraseError}
              disabled={disabled}
            />
            {rules.eraseAfterDays > 0 ? (
              <>
                <FormField
                  label={copy.modeLabel}
                  name={`${name}-mode`}
                  description={
                    rules.mode === 'whole-order'
                      ? copy.modeDescriptionWhole
                      : copy.modeDescriptionPersonal
                  }
                >
                  <Select
                    value={rules.mode}
                    disabled={disabled}
                    onChange={(event) => {
                      if (isBuyerDataEraseMode(event.target.value)) {
                        onChange({ ...rules, mode: event.target.value });
                      }
                    }}
                  >
                    <option value="personal-data">{copy.modePersonal}</option>
                    <option value="whole-order">{copy.modeWhole}</option>
                  </Select>
                </FormField>
                <Alert tone="warning" title={copy.irreversibleTitle}>
                  {copy.irreversibleBody}
                </Alert>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <Alert tone="info" title={copy.summaryTitle} data-testid="buyer-data-summary">
        {summarise(rules)}
      </Alert>
      <BuyerDataJourney rules={rules} />
    </div>
  );
}
