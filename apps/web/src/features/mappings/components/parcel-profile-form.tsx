/**
 * Parcel profile form (#3958)
 *
 * The size, box and weight inputs of a parcel profile, lifted out of
 * `RoutingParcelDialog` so the OMS setup's label defaults
 * (`Connection.config.autoDispatch`) are edited with the very same fields,
 * units, size list and validation as a routing rule's default parcel. Both
 * write the same three facts the worker merges per field
 * (`mergeAutoDispatchParcelOptions`), so two forms for them would be two
 * answers to one question.
 *
 * Controlled: the host owns the draft and decides when to validate
 * (`validateDraft` with the same `customTemplate` flag this reports).
 *
 * @module apps/web/src/features/mappings/components
 */
import type { ReactElement, ReactNode } from 'react';

import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { PARCEL_TEMPLATE_OPTIONS, type ParcelProfileDraft } from '../lib/parcel-profile';
import { useMessages } from '../../../shared/i18n';

// Select value for the free-text escape hatch. It never reaches the draft: the
// draft's `template` holds the typed code, the select only tracks the mode.
const OTHER_TEMPLATE_OPTION = '__other__';

export interface ParcelProfileFormProps {
  readonly draft: ParcelProfileDraft;
  /** The operator chose to type a carrier code rather than pick a listed size. */
  readonly customTemplate: boolean;
  readonly onChange: (draft: ParcelProfileDraft, customTemplate: boolean) => void;
  /** Prefix for the field names, so two instances on one page do not share ids. */
  readonly namePrefix?: string;
  /** Overrides the weight field's description where the weight means something narrower. */
  readonly weightDescription?: ReactNode;
  readonly disabled?: boolean;
}

export function ParcelProfileForm({
  draft,
  customTemplate,
  onChange,
  namePrefix = 'parcel',
  weightDescription,
  disabled,
}: ParcelProfileFormProps): ReactElement {
  const copy = useMessages('mappings').parcelProfile;
  const set =
    (field: keyof ParcelProfileDraft) =>
    (value: string): void =>
      onChange({ ...draft, [field]: value }, customTemplate);

  function handleTemplateSelect(value: string): void {
    if (value === OTHER_TEMPLATE_OPTION) {
      onChange({ ...draft, template: '' }, true);
      return;
    }
    onChange({ ...draft, template: value }, false);
  }

  const numberInput = (field: 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg'): ReactElement => (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={draft[field]}
      disabled={disabled}
      onChange={(e) => set(field)(e.target.value)}
    />
  );

  return (
    <>
      <FormField label={copy.templateLabel} name={`${namePrefix}Template`}>
        <Select
          value={customTemplate ? OTHER_TEMPLATE_OPTION : draft.template}
          disabled={disabled}
          onChange={(e) => handleTemplateSelect(e.target.value)}
        >
          <option value="">{copy.templateNone}</option>
          {PARCEL_TEMPLATE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={OTHER_TEMPLATE_OPTION}>{copy.templateOther}</option>
        </Select>
      </FormField>

      {customTemplate && (
        <FormField label={copy.customTemplateLabel} name={`${namePrefix}TemplateCode`}>
          <Input value={draft.template} disabled={disabled} onChange={(e) => set('template')(e.target.value)} />
        </FormField>
      )}

      <div className="form-field-row form-field-row--cols-3">
        <FormField label={copy.lengthLabel} name={`${namePrefix}Length`}>
          {numberInput('lengthCm')}
        </FormField>
        <FormField label={copy.widthLabel} name={`${namePrefix}Width`}>
          {numberInput('widthCm')}
        </FormField>
        <FormField label={copy.heightLabel} name={`${namePrefix}Height`}>
          {numberInput('heightCm')}
        </FormField>
      </div>

      <FormField label={copy.weightLabel} name={`${namePrefix}Weight`} description={weightDescription}>
        {numberInput('weightKg')}
      </FormField>
    </>
  );
}
