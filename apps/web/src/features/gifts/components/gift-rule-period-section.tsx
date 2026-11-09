/**
 * GiftRulePeriodSection (#3935, mockup `gifts-rule-detail` "Okres")
 *
 * Start and optional end date. An end date before the start is said next to the
 * field, not only in the list of what is still missing.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { DetailSection } from '../../../shared/ui/detail-section';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { GiftRuleSectionProps } from './gift-rule-section.types';

export function GiftRulePeriodSection({ form, values, readOnly }: GiftRuleSectionProps): ReactElement {
  const copy = useMessages('gifts');
  const invalid = values.to !== '' && values.to < values.from;
  return (
    <DetailSection title={copy.composer.period}>
      <fieldset className="gift-section" disabled={readOnly}>
        <div className="gift-section__row">
          <FormField label={copy.composer.from} name="gift-from">
            <Input
              type="date"
              value={values.from}
              onChange={(event) => form.setValue('from', event.target.value)}
              data-testid="gift-composer-period-from"
            />
          </FormField>
          <FormField
            label={copy.composer.to}
            name="gift-to"
            error={invalid ? copy.detail.periodInvalid : undefined}
          >
            <Input
              type="date"
              value={values.to}
              onChange={(event) => form.setValue('to', event.target.value)}
              data-testid="gift-composer-period-to"
            />
          </FormField>
        </div>
        <p className="text-muted gift-section__hint">{copy.composer.periodHelp}</p>
      </fieldset>
    </DetailSection>
  );
}
