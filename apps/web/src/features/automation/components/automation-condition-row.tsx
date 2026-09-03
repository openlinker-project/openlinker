/**
 * One condition (#2365, spec §5.5 divergence 2)
 *
 * The offered fields come from the API — `vocabulary.triggers[].legalConditionFields`
 * for the selected trigger — never from a frontend list. `holdReason`'s values
 * likewise come from `vocabulary.holdReasons`: there is no `HoldReason` mirror
 * anywhere in `apps/web` and there must not be one, because the composer cannot
 * add a reason (§5.3b) and a hand-listed copy would be another cross-tree mirror
 * needing its own gate.
 *
 * ## Inputs are REGISTERED, never written through `useFieldArray.update()`
 *
 * `update()` regenerates the row's `field.id`, and the rows are keyed by it — so
 * a call per keystroke remounts the subtree and the character is lost. That is
 * not a theory: a probe typing `PL` into this very input produced `''`. Leaf
 * inputs therefore bind with `register`, and only the discriminant select does
 * extra work (a `setValue` to clear the sibling slot it invalidates).
 *
 * The amount condition carries an INLINE amount + currency rather than a
 * `thresholdRef` — the declared divergence from the sales-document composer.
 * Nothing is ever converted, so the currency hint says so.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import type { UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import {
  AUTOMATION_COMPOSER_COPY,
  AUTOMATION_CONDITION_FIELD_LABELS,
} from '../lib/automation.copy';
import { AUTOMATION_AMOUNT_OP_VALUES } from '../api/automation.types';
import type {
  AutomationComposerValues,
  AutomationConditionDraft,
} from '../lib/automation-composer.schema';
import type { Connection } from '../../connections';

interface AutomationConditionRowProps {
  index: number;
  draft: AutomationConditionDraft;
  /** Condition fields legal for the selected trigger, from the API. */
  legalFields: string[];
  /** Hold reasons from the API — never a frontend list. */
  holdReasons: string[];
  connections: Connection[];
  errors: Partial<Record<keyof AutomationConditionDraft, string>>;
  register: UseFormRegister<AutomationComposerValues>;
  setValue: UseFormSetValue<AutomationComposerValues>;
  onRemove: () => void;
}

export function AutomationConditionRow({
  index,
  draft,
  legalFields,
  holdReasons,
  connections,
  errors,
  register,
  setValue,
  onRemove,
}: AutomationConditionRowProps): ReactElement {
  const fieldSelect = register(`conditions.${index}.field`);

  return (
    <div className="automation-composer__row">
      {/*
        The discriminant, and the one control ALWAYS rendered on this row — which
        is why a server refusal naming this condition is surfaced here rather
        than on a slot the selected field may not render.
      */}
      <FormField
        label={AUTOMATION_COMPOSER_COPY.conditionFieldLabel}
        name={`condition-${index}-field`}
        error={errors.field}
      >
        <Select
          {...fieldSelect}
          onChange={(event) => {
            void fieldSelect.onChange(event);
            // The previous field's value slot no longer applies; leaving it
            // would submit a stale value under a different comparison.
            setValue(`conditions.${index}.value`, '', { shouldDirty: true });
          }}
        >
          {legalFields.map((field) => (
            <option key={field} value={field}>
              {AUTOMATION_CONDITION_FIELD_LABELS[field] ?? field}
            </option>
          ))}
        </Select>
      </FormField>

      {draft.field === 'sourceConnection' ? (
        <FormField
          label={AUTOMATION_COMPOSER_COPY.conditionValueLabel}
          name={`condition-${index}-value`}
          error={errors.value}
        >
          <Select {...register(`conditions.${index}.value`)}>
            <option value="">Select a connection…</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      {draft.field === 'orderCountry' ? (
        <FormField
          label={AUTOMATION_COMPOSER_COPY.conditionValueLabel}
          name={`condition-${index}-value`}
          error={errors.value}
        >
          <Input placeholder="e.g. PL" maxLength={2} {...register(`conditions.${index}.value`)} />
        </FormField>
      ) : null}

      {draft.field === 'holdReason' ? (
        <FormField
          label={AUTOMATION_COMPOSER_COPY.conditionValueLabel}
          name={`condition-${index}-value`}
          error={errors.value}
        >
          <Select {...register(`conditions.${index}.value`)}>
            <option value="">Select a reason…</option>
            {holdReasons.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      {draft.field === 'orderTotalGross' ? (
        <>
          <FormField label={AUTOMATION_COMPOSER_COPY.amountOpLabel} name={`condition-${index}-op`}>
            <Select {...register(`conditions.${index}.op`)}>
              {AUTOMATION_AMOUNT_OP_VALUES.map((op) => (
                <option key={op} value={op}>
                  {op === 'gte' ? 'is at least' : 'is less than'}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label={AUTOMATION_COMPOSER_COPY.amountLabel}
            name={`condition-${index}-amount`}
            error={errors.amount}
          >
            <Input inputMode="decimal" placeholder="2000" {...register(`conditions.${index}.amount`)} />
          </FormField>
          <FormField
            label={AUTOMATION_COMPOSER_COPY.currencyLabel}
            name={`condition-${index}-currency`}
            error={errors.currency}
            description={AUTOMATION_COMPOSER_COPY.currencyHint}
          >
            <Input maxLength={3} {...register(`conditions.${index}.currency`)} />
          </FormField>
        </>
      ) : null}

      <Button
        type="button"
        tone="ghost"
        className="button--sm automation-composer__remove"
        onClick={onRemove}
        aria-label={`${AUTOMATION_COMPOSER_COPY.removeCondition} ${index + 1}`}
      >
        {AUTOMATION_COMPOSER_COPY.removeCondition}
      </Button>
    </div>
  );
}
