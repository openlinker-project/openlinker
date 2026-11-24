/**
 * applyFieldErrors (#3862)
 *
 * Puts a validation refusal's per-field errors (#3861) onto a React Hook Form,
 * each in the operator's language: the copy for the field's constraint code
 * (`errors.fields.<code>`), with its params, or the generic `errors.fields.invalid`.
 *
 * The backend names a field by its dotted path into the request body
 * (`items.0.quantity`), which is React Hook Form's own path syntax, so a form
 * whose shape matches the body needs no map. A form shaped differently passes
 * `pathMap`: an object or a function from the body path to its form field, or
 * `undefined` to leave that field unmapped.
 *
 * Returns the fields it could not place, so the caller can still show them
 * (e.g. in the form's error summary) instead of losing them.
 *
 * @module shared/api
 */
import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';
import { getMessages, interpolate } from '../i18n';
import { ApiError } from './api-error';
import type { ApiErrorField } from './api-error.types';

export type FieldPathMap<T extends FieldValues> =
  | Readonly<Record<string, FieldPath<T>>>
  | ((path: string) => FieldPath<T> | undefined);

export interface ApplyFieldErrorsResult {
  /** How many fields were set on the form. */
  readonly applied: number;
  /** Fields with no form field to show them on. */
  readonly unmapped: readonly ApiErrorField[];
}

const UNFILLED_PLACEHOLDER = /\{\w+\}/;

export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  pathMap?: FieldPathMap<T>
): ApplyFieldErrorsResult {
  if (!(error instanceof ApiError) || error.fields.length === 0) {
    return { applied: 0, unmapped: [] };
  }
  const placed = new Set<string>();
  const unmapped: ApiErrorField[] = [];
  for (const field of error.fields) {
    const target = resolvePath(field.path, pathMap);
    if (target === undefined) {
      unmapped.push(field);
      continue;
    }
    // One message per form field: the first constraint that failed is the one to fix first.
    if (placed.has(target)) continue;
    placed.add(target);
    setError(target, { type: 'server', message: describeFieldError(field) });
  }
  return { applied: placed.size, unmapped };
}

/** The operator's sentence for one invalid field. */
export function describeFieldError(field: ApiErrorField): string {
  const copy = getMessages('errors').fields;
  const template = (copy as Record<string, string | undefined>)[field.code];
  if (template !== undefined) {
    const values = Object.fromEntries(
      Object.entries(field.params ?? {}).map(([name, value]) => [
        name,
        typeof value === 'boolean' ? String(value) : value,
      ])
    );
    const text = interpolate(template, values);
    if (!UNFILLED_PLACEHOLDER.test(text)) return text;
  }
  return copy.invalid;
}

function resolvePath<T extends FieldValues>(
  path: string,
  pathMap: FieldPathMap<T> | undefined
): FieldPath<T> | undefined {
  if (pathMap === undefined) return path as FieldPath<T>;
  if (typeof pathMap === 'function') return pathMap(path);
  return pathMap[path];
}
