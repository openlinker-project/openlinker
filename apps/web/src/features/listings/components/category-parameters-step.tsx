/**
 * Category Parameters Step (#410)
 *
 * Step 2 of the create-offer wizard. Renders the marketplace's per-category
 * parameter schema as RHF-bound fields, grouped required-first / optional in
 * a collapsible expander.
 *
 * Field renderer dispatches on `(type, restrictions)`:
 *   - dictionary < 50 entries, single, no customValues → native <Select>
 *   - dictionary ≥ 50 entries OR customValuesEnabled OR multipleChoices → <Combobox>
 *   - string                                              → <Input>
 *   - integer / float, range=false                        → <Input type="number">
 *   - integer / float, range=true                         → from/to inline pair
 *
 * Honors both dependency mechanisms:
 *   - parameter-level visibility — the field is skipped when `dependsOn`
 *     unsatisfied; on transition-to-hidden, the value is cleared via
 *     `form.setValue(p.id, undefined)` (effect on visibility change).
 *   - dictionary-entry filtering — the option list narrows based on the
 *     parent's current value; a small "Filtered by …" hint above the field
 *     surfaces the narrowing so operators don't think the dictionary shrank
 *     mysteriously.
 *
 * Auto-fill prefill (EAN + Stan) is driven from the parent wizard via
 * `form.reset()` when parameters first load — this component just renders.
 *
 * @module apps/web/src/features/listings/components
 */
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';

import { Combobox, type ComboboxOption, type ComboboxValue } from '../../../shared/ui/combobox';
import { FormField } from '../../../shared/ui/form-field';

import type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
} from '../api/listings.types';
import type { CategoryParameterFormValues, FormParameterValue } from './category-parameter-form.types';
import {
  isParameterVisible,
  visibleDictionaryEntries,
} from './category-parameter-visibility';

const NATIVE_SELECT_THRESHOLD = 50;

interface CategoryParametersStepProps {
  parameters: CategoryParameter[];
  /**
   * RHF dot-prefix the renderer prepends to every parameter id. The wizard
   * stores the per-parameter form state under this key, e.g. `'parameters'`
   * → fields become `parameters.{paramId}`.
   */
  formNamespace: string;
  /**
   * Map of parameter id → "auto-filled" hint visibility. A field shows the
   * subtitle until the user dirties it (RHF dirty state). The wizard owns
   * the dirty tracking because RHF's `formState.dirtyFields` is scoped to
   * the form root.
   */
  prefilledIds?: ReadonlySet<string>;
  /**
   * Map of parameter id → soft hint message rendered next to the field.
   * Generic by design — appended to the field's description channel,
   * dirty-stripped per-field with the same lifecycle as `prefilledIds`.
   *
   * Today the sole producer is `collectUnmatchedBrandHints` (#412),
   * surfacing the variant's brand value when no exact dictionary match
   * was found. Extension point for future fill-attempt diagnostics — the
   * intent-agnostic shape lets new hint producers plug in without a
   * prop-rename PR.
   */
  extraHints?: Record<string, string>;
}

export function CategoryParametersStep({
  parameters,
  formNamespace,
  prefilledIds,
  extraHints,
}: CategoryParametersStepProps): ReactElement {
  const { control, setValue, getValues, formState } = useFormContext();
  // Watching the entire `parameters` slice keeps visibility / option-narrowing
  // in sync with the form state on every keystroke. Acceptable cost — the
  // wizard form is small and per-render evaluation is O(parameters × constant).
  const formValuesRaw = useWatch({ control, name: formNamespace }) as unknown;
  const formValues: CategoryParameterFormValues = useMemo(
    () => (formValuesRaw && typeof formValuesRaw === 'object' ? (formValuesRaw as CategoryParameterFormValues) : {}),
    [formValuesRaw],
  );

  // Strip the "Auto-filled" hint from any field the operator has already
  // edited. RHF tracks dirty state per-field — auto-prefill writes with
  // `shouldDirty: false`, so a dirty entry here is operator-authored.
  const dirtyParameters =
    (formState.dirtyFields as Record<string, Record<string, unknown> | undefined>)[formNamespace] ?? {};
  const liveprefilledIds = useMemo(() => {
    if (!prefilledIds || prefilledIds.size === 0) return prefilledIds ?? new Set<string>();
    const next = new Set<string>();
    for (const id of prefilledIds) {
      if (!dirtyParameters[id]) next.add(id);
    }
    return next;
  }, [prefilledIds, dirtyParameters]);

  // Mirror the prefilled-id dirty-strip for `extraHints` (#412). Hints
  // disappear the moment the operator edits the field, same lifecycle as
  // the "Auto-filled from variant data" subtitle.
  const liveExtraHints = useMemo(() => {
    if (!extraHints || Object.keys(extraHints).length === 0) return extraHints ?? {};
    const next: Record<string, string> = {};
    for (const [paramId, message] of Object.entries(extraHints)) {
      if (!dirtyParameters[paramId]) next[paramId] = message;
    }
    return next;
  }, [extraHints, dirtyParameters]);

  // Visibility filter: when a parent parameter's value changes such that a
  // dependent parameter becomes hidden, clear the dependent's form value so
  // it doesn't get accidentally submitted.
  useEffect(() => {
    for (const p of parameters) {
      if (!p.dependsOn) continue;
      if (!isParameterVisible(p, formValues)) {
        const current = getValues(`${formNamespace}.${p.id}`);
        if (current !== undefined && current !== '' && (!Array.isArray(current) || current.length > 0)) {
          setValue(`${formNamespace}.${p.id}`, undefined, { shouldDirty: false });
        }
      }
    }
  }, [parameters, formValues, formNamespace, getValues, setValue]);

  const visibleParameters = useMemo(
    () => parameters.filter((p) => isParameterVisible(p, formValues)),
    [parameters, formValues],
  );

  const required = visibleParameters.filter((p) => p.required);
  const optional = visibleParameters.filter((p) => !p.required);

  return (
    <div className="category-parameters-step">
      {required.length > 0 && (
        <fieldset className="category-parameters-step__group">
          <legend className="category-parameters-step__group-legend">Required</legend>
          {required.map((param) => (
            <ParameterField
              key={param.id}
              parameter={param}
              formNamespace={formNamespace}
              parentValues={formValues}
              prefilled={liveprefilledIds.has(param.id)}
              extraHint={liveExtraHints[param.id]}
            />
          ))}
        </fieldset>
      )}

      {optional.length > 0 && (
        <details className="category-parameters-step__expander">
          <summary className="category-parameters-step__expander-summary">
            Show optional fields ({optional.length})
          </summary>
          <fieldset className="category-parameters-step__group category-parameters-step__group--optional">
            <legend className="sr-only">Optional</legend>
            {optional.map((param) => (
              <ParameterField
                key={param.id}
                parameter={param}
                formNamespace={formNamespace}
                parentValues={formValues}
                prefilled={liveprefilledIds.has(param.id)}
              extraHint={liveExtraHints[param.id]}
              />
            ))}
          </fieldset>
        </details>
      )}
    </div>
  );
}

interface ParameterFieldProps {
  parameter: CategoryParameter;
  formNamespace: string;
  parentValues: CategoryParameterFormValues;
  prefilled: boolean;
  /** Soft hint message appended to the field description (#412). */
  extraHint?: string;
}

function ParameterField({
  parameter,
  formNamespace,
  parentValues,
  prefilled,
  extraHint,
}: ParameterFieldProps): ReactElement {
  const { control, formState } = useFormContext();
  const fieldName = `${formNamespace}.${parameter.id}`;
  // RHF stores errors set via dotted paths (`form.setError('parameters.p_x',
  // …)`) at `formState.errors.parameters.p_x`, not as a flat key. Walk the
  // nested object — the field name's parts are statically known.
  const namespaceErrors = (formState.errors as Record<string, unknown>)[formNamespace];
  const fieldError =
    namespaceErrors && typeof namespaceErrors === 'object'
      ? (namespaceErrors as Record<string, { message?: string } | undefined>)[parameter.id]
      : undefined;
  const error = fieldError?.message;

  const description = describeFilter(parameter, parentValues);
  const autoFillHint = prefilled ? 'Auto-filled from variant data' : undefined;

  const label = (
    <span>
      {parameter.name}
      {parameter.unit ? <span className="category-parameters-step__unit"> ({parameter.unit})</span> : null}
    </span>
  );

  return (
    <FormField
      label={label}
      name={fieldName}
      description={[description, autoFillHint, extraHint].filter(Boolean).join(' · ') || undefined}
      error={error}
    >
      <Controller
        control={control}
        name={fieldName}
        render={({ field }): ReactElement => renderControl(parameter, parentValues, field)}
      />
    </FormField>
  );
}

interface ControllerField {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  ref: (instance: unknown) => void;
}

function renderControl(
  parameter: CategoryParameter,
  parentValues: CategoryParameterFormValues,
  field: ControllerField,
): ReactElement {
  if (parameter.type === 'dictionary') {
    return renderDictionary(parameter, parentValues, field);
  }
  if (parameter.restrictions.range) {
    return renderRange(parameter, field);
  }
  return renderScalar(parameter, field);
}

function renderDictionary(
  parameter: CategoryParameter,
  parentValues: CategoryParameterFormValues,
  field: ControllerField,
): ReactElement {
  const entries = visibleDictionaryEntries(parameter, parentValues);
  const useCombobox =
    parameter.restrictions.multipleChoices ||
    parameter.restrictions.customValuesEnabled ||
    entries.length >= NATIVE_SELECT_THRESHOLD;

  if (useCombobox) {
    return (
      <Combobox
        ariaLabel={parameter.name}
        options={entries.map((e) => toComboboxOption(e))}
        mode={parameter.restrictions.multipleChoices ? 'multi' : 'single'}
        allowCustomValues={parameter.restrictions.customValuesEnabled}
        value={toComboboxValue(parameter, field.value as FormParameterValue)}
        onChange={(next): void => field.onChange(fromComboboxValue(parameter, next))}
        placeholder={`Pick ${parameter.name.toLowerCase()}`}
        invalid={false}
      />
    );
  }

  // Native select — small dictionaries, single-select, no custom values
  const selected = typeof field.value === 'string' ? field.value : '';
  return (
    <select
      className="control"
      value={selected}
      onChange={(e): void => field.onChange(e.target.value === '' ? undefined : e.target.value)}
      onBlur={field.onBlur}
      aria-label={parameter.name}
    >
      <option value="">Select…</option>
      {entries.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.value}
        </option>
      ))}
    </select>
  );
}

function renderScalar(parameter: CategoryParameter, field: ControllerField): ReactElement {
  const isNumeric = parameter.type === 'integer' || parameter.type === 'float';
  return (
    <input
      type={isNumeric ? 'number' : 'text'}
      className="control"
      value={typeof field.value === 'string' ? field.value : ''}
      onChange={(e): void => field.onChange(e.target.value)}
      onBlur={field.onBlur}
      aria-label={parameter.name}
      step={parameter.type === 'float' ? scaleStep(parameter.restrictions.precision) : undefined}
      min={parameter.restrictions.min}
      max={parameter.restrictions.max}
      minLength={parameter.restrictions.minLength}
      maxLength={parameter.restrictions.maxLength}
    />
  );
}

function renderRange(parameter: CategoryParameter, field: ControllerField): ReactElement {
  const v = (field.value && typeof field.value === 'object' && !Array.isArray(field.value)
    ? field.value
    : { from: '', to: '' }) as { from?: string; to?: string };

  const update = (next: { from?: string; to?: string }): void => {
    field.onChange({ from: next.from ?? '', to: next.to ?? '' });
  };

  const step = parameter.type === 'float' ? scaleStep(parameter.restrictions.precision) : undefined;

  return (
    <span className="category-parameters-step__range">
      <input
        type="number"
        className="control"
        value={v.from ?? ''}
        onChange={(e): void => update({ ...v, from: e.target.value })}
        onBlur={field.onBlur}
        aria-label={`${parameter.name} from`}
        step={step}
        min={parameter.restrictions.min}
        max={parameter.restrictions.max}
      />
      <span className="category-parameters-step__range-sep" aria-hidden>
        –
      </span>
      <input
        type="number"
        className="control"
        value={v.to ?? ''}
        onChange={(e): void => update({ ...v, to: e.target.value })}
        onBlur={field.onBlur}
        aria-label={`${parameter.name} to`}
        step={step}
        min={parameter.restrictions.min}
        max={parameter.restrictions.max}
      />
      {parameter.unit ? (
        <span className="category-parameters-step__range-unit">{parameter.unit}</span>
      ) : null}
    </span>
  );
}

function toComboboxOption(entry: CategoryParameterDictionaryEntry): ComboboxOption {
  return { id: entry.id, label: entry.value, hint: entry.id };
}

function toComboboxValue(
  parameter: CategoryParameter,
  raw: FormParameterValue,
): ComboboxValue | null {
  if (parameter.restrictions.multipleChoices) {
    if (Array.isArray(raw)) return raw.length === 0 ? null : { kind: 'dictionary', ids: raw };
    return null;
  }
  if (typeof raw !== 'string' || raw === '') return null;

  if (parameter.restrictions.customValuesEnabled) {
    const matched = parameter.dictionary?.find(
      (e) => e.value.trim().toLowerCase() === raw.trim().toLowerCase(),
    );
    return matched ? { kind: 'dictionary', ids: [matched.id] } : { kind: 'custom', text: raw };
  }
  // Plain dict single — RHF stores the entry id
  return { kind: 'dictionary', ids: [raw] };
}

function fromComboboxValue(
  parameter: CategoryParameter,
  value: ComboboxValue | null,
): FormParameterValue {
  if (value === null) {
    return parameter.restrictions.multipleChoices ? [] : undefined;
  }
  if (value.kind === 'dictionary') {
    if (parameter.restrictions.multipleChoices) return value.ids;
    return value.ids[0];
  }
  // custom-text — only meaningful when customValuesEnabled
  return value.text;
}

function describeFilter(
  parameter: CategoryParameter,
  parentValues: CategoryParameterFormValues,
): ReactNode {
  if (!parameter.dependsOn || parameter.type !== 'dictionary' || !parameter.dictionary) {
    return null;
  }
  const visible = visibleDictionaryEntries(parameter, parentValues);
  if (visible.length === parameter.dictionary.length) return null;
  return `Filtered by parent: ${visible.length} of ${parameter.dictionary.length} options available`;
}

function scaleStep(precision: number | undefined): string | undefined {
  if (precision === undefined || precision <= 0) return undefined;
  return `0.${'0'.repeat(precision - 1)}1`;
}
