/**
 * PromotionPeriodSection (#3935, mockups "Okres")
 *
 * From and to (optional). The date of the ORDER counts, never the date it is
 * processed, and a promotion never works backwards: that is the sentence under
 * the fields, because it is what an operator wants to know before changing one.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { Input } from '../../../shared/ui/input';
import { PromotionField } from './promotion-field';
import type { PromotionSectionProps } from './promotion-section.types';

export function PromotionPeriodSection({
  form,
  values,
  readOnly,
  invalid,
  riseIndex,
  step,
  bare = false,
}: PromotionSectionProps & { bare?: boolean }): ReactElement {
  const copy = useMessages('promotions').s.period;
  const fields = (
    <fieldset className="pm-fieldset" disabled={readOnly}>
      <div className="pm-row2">
        <PromotionField label={copy.from} htmlFor="promotion-from">
          <Input
            id="promotion-from"
            type="date"
            className="mono tabular"
            value={values.from}
            onChange={(event) => {
              form.setValue('from', event.target.value, { shouldDirty: true });
            }}
            data-testid="promotion-from"
          />
        </PromotionField>
        <PromotionField label={copy.to} htmlFor="promotion-to" invalid={invalid?.has('period') === true} error={copy.error}>
          <Input
            id="promotion-to"
            type="date"
            className="mono tabular"
            value={values.to}
            placeholder={copy.toPlaceholder}
            onChange={(event) => {
              form.setValue('to', event.target.value, { shouldDirty: true });
            }}
            data-testid="promotion-to"
          />
        </PromotionField>
      </div>
      {bare ? null : <p className="form-field__description">{copy.help}</p>}
    </fieldset>
  );
  if (bare) return fields;
  return (
    <ComposerSection
      step={step}
      title={copy.title}
      aside={values.from === '' ? undefined : interpolate(copy.asideFrom, { date: formatDate(values.from) })}
      riseIndex={riseIndex}
      data-testid="promotion-period-section"
    >
      {fields}
    </ComposerSection>
  );
}
