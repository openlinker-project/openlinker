/**
 * PromotionNameSection (#3935, mockups `promotions-detail` "Nazwa" and
 * `promotions-new` "01 Nazwa")
 *
 * The promotion's name, with a suggestion built from the gift and the condition
 * until the operator types their own. The detail page also lets the title carry
 * the name, so this card keeps both in step.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { Input } from '../../../shared/ui/input';
import { PromotionField } from './promotion-field';
import type { PromotionSectionProps } from './promotion-section.types';

export interface PromotionNameSectionProps extends PromotionSectionProps {
  onTyped: () => void;
  /** The suggested name, shown with a "Use" link until the operator types their own. */
  suggestion?: string;
}

export function PromotionNameSection({
  form,
  values,
  readOnly,
  invalid,
  riseIndex,
  step,
  onTyped,
  suggestion,
}: PromotionNameSectionProps): ReactElement {
  const copy = useMessages('promotions').s.name;
  const showSuggestion = suggestion !== undefined && suggestion !== '' && values.name.trim() === '';
  return (
    <ComposerSection
      step={step}
      title={copy.title}
      aside={step === undefined ? copy.aside : <span className="pm-req">{copy.required}</span>}
      riseIndex={riseIndex}
      data-testid="promotion-name-section"
    >
      <PromotionField
        label={copy.label}
        htmlFor="promotion-name"
        required={step !== undefined}
        description={step === undefined ? copy.help : undefined}
        invalid={invalid?.has('name') === true}
        error={copy.error}
        id="promotion-name-field"
      >
        <Input
          id="promotion-name"
          value={values.name}
          maxLength={80}
          disabled={readOnly}
          autoComplete="off"
          placeholder={copy.placeholder}
          onChange={(event) => {
            onTyped();
            form.setValue('name', event.target.value, { shouldDirty: true });
          }}
          data-testid="promotion-name"
        />
        {showSuggestion ? (
          <div className="pm-sugg">
            <span>
              {copy.suggestion} <b>{suggestion}</b>
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                form.setValue('name', suggestion, { shouldDirty: true });
              }}
              data-testid="promotion-name-use-suggestion"
            >
              {copy.useSuggestion}
            </button>
          </div>
        ) : null}
      </PromotionField>
    </ComposerSection>
  );
}
