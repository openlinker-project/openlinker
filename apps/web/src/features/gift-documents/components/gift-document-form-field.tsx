/**
 * GiftDocumentFormField (#3940)
 *
 * The per-gift field "On the document" (gifts spec 8.4): the gift's own answer,
 * the most specific of the three levels. An empty value means "as in settings",
 * so the connection or the OpenLinker default decides. "Shown at 0.00" is listed
 * disabled, with its reason, where no document provider accepts a zero line.
 *
 * One select serves the rule composer, the manual add-gift dialog and the
 * bundle's gift-slot menu, so the three cannot word the choice differently.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Select } from '../../../shared/ui/select';
import { useDocumentProvidersQuery } from '../hooks/use-gift-documents-queries';
import { GiftFormPickerValues, type GiftDocumentFormChoice } from '../lib/gift-lines';
import { useGiftFormLabels } from '../lib/use-gift-form-labels';
import { zeroAvailability } from '../lib/zero-availability';

export interface GiftDocumentFormFieldProps {
  value: GiftDocumentFormChoice | '';
  onChange: (value: GiftDocumentFormChoice | '') => void;
  disabled?: boolean;
  id?: string;
  'data-testid'?: string;
}

export function GiftDocumentFormField({
  value,
  onChange,
  disabled = false,
  id,
  'data-testid': testId,
}: GiftDocumentFormFieldProps): ReactElement {
  const copy = useMessages('gift-documents');
  const labels = useGiftFormLabels();
  const providers = useDocumentProvidersQuery();
  const zero = zeroAvailability(providers.data?.providers);

  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={copy.perGift.label}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value as GiftDocumentFormChoice)}
    >
      <option value="">{copy.perGift.asInSettings}</option>
      {GiftFormPickerValues.map((form) => (
        <option key={form} value={form} disabled={form === 'show-zero' && !zero.available}>
          {labels.label(form)}
        </option>
      ))}
    </Select>
  );
}
