/**
 * Category-Parameter Form Types
 *
 * Shared form-state shape for the create-offer wizard's Step 2 (#410).
 * Stored as a flat dict on React Hook Form: `parameters[paramId] = value`,
 * where the value type depends on the parameter's `(type, restrictions)`
 * combination:
 *
 *   - dictionary single (no multi)            → string (the entry's id)
 *   - dictionary multi                        → string[] (entry ids)
 *   - dictionary single + customValuesEnabled → string (raw text — submit-time
 *     serializer matches against the dictionary and emits valuesIds vs values)
 *   - string                                  → string (raw text)
 *   - integer / float, range=false            → string (numeric raw)
 *   - integer / float, range=true             → { from: string; to: string }
 *
 * Empty / missing values are represented by either an empty string or
 * `undefined` — the serializer treats both as "not submitted".
 *
 * @module apps/web/src/features/listings/components
 */
export type FormParameterValue =
  | string
  | string[]
  | { from: string; to: string }
  | undefined;

export type CategoryParameterFormValues = Record<string, FormParameterValue>;
