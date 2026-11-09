/**
 * GiftRuleNameSection (#3935)
 *
 * The promotion's name. It follows what the operator picked until they type
 * their own, which is tracked by the composer (`onTyped`).
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { DetailSection } from '../../../shared/ui/detail-section';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import type { GiftRuleSectionProps } from './gift-rule-section.types';

export function GiftRuleNameSection({
  form,
  values,
  readOnly,
  onTyped,
}: GiftRuleSectionProps & { onTyped: () => void }): ReactElement {
  const copy = useMessages('gifts');
  return (
    <DetailSection title={copy.detail.name}>
      <fieldset className="gift-section" disabled={readOnly}>
        <FormField label={copy.composer.name} name="gift-name" description={copy.composer.nameHelp}>
          <Input
            value={values.name}
            onChange={(event) => {
              onTyped();
              form.setValue('name', event.target.value);
            }}
            data-testid="gift-composer-name"
          />
        </FormField>
      </fieldset>
    </DetailSection>
  );
}
