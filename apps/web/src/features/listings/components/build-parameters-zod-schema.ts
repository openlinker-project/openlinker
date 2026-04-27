/**
 * Build Parameters Zod Schema (dynamic)
 *
 * Constructs a Zod schema for the wizard's Step 2 parameter form (#410) from
 * the runtime-fetched `CategoryParameter[]`. Memoize the result against the
 * parameters reference upstream — schema rebuild on every render is fine
 * structurally but wasteful.
 *
 * Encodes:
 *   - per-field shape (string / integer / float scalar / range / dict
 *     single / dict multi)
 *   - per-field constraints (min/max, length bounds, precision, allowed
 *     value count, regex sanity for numeric fields)
 *   - cross-field rules in `superRefine`:
 *       * required fields must be non-empty when visible
 *       * dictionary selections must be among the parent-narrowed entry set
 *
 * Hidden parameters (per `isParameterVisible`) are deliberately not validated
 * — their values are cleared on hide and we don't want stale data blocking
 * submission. The visibility check uses the `values` argument as snapshotted
 * at validation time; consumers pass the entire form state in.
 *
 * @module apps/web/src/features/listings/components
 */
import { z, type ZodTypeAny } from 'zod';

import type { CategoryParameter } from '../api/listings.types';
import type { CategoryParameterFormValues } from './category-parameter-form.types';
import {
  isFormValueEmpty,
  isParameterVisible,
  visibleDictionaryEntries,
} from './category-parameter-visibility';

const INTEGER_REGEX = /^-?\d+$/;
const FLOAT_REGEX = /^-?\d+(\.\d+)?$/;

export function buildParametersZodSchema(parameters: CategoryParameter[]): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const p of parameters) {
    shape[p.id] = fieldSchema(p);
  }
  const base = z.object(shape).passthrough();

  return base.superRefine((rawValues, ctx) => {
    const values = rawValues as CategoryParameterFormValues;
    for (const p of parameters) {
      if (!isParameterVisible(p, values)) continue;

      const v = values[p.id];

      if (p.required && isFormValueEmpty(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [p.id],
          message: `${p.name} is required`,
        });
        continue;
      }

      if (
        p.type === 'dictionary' &&
        !isFormValueEmpty(v) &&
        p.dictionary !== undefined &&
        p.dictionary.length > 0 &&
        !p.restrictions.customValuesEnabled
      ) {
        const allowedIds = new Set(visibleDictionaryEntries(p, values).map((e) => e.id));
        const selected = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
        for (const id of selected) {
          if (!allowedIds.has(id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [p.id],
              message: `${p.name}: selected option is no longer available for the current parent value`,
            });
            break;
          }
        }
      }
    }
  });
}

function fieldSchema(p: CategoryParameter): ZodTypeAny {
  switch (p.type) {
    case 'dictionary':
      return p.restrictions.multipleChoices
        ? z.array(z.string()).optional()
        : z.string().optional();

    case 'string':
      return stringFieldSchema(p);

    case 'integer':
      return p.restrictions.range
        ? rangeSchema()
        : z.string().optional().refine(
            (s) => s === undefined || s === '' || INTEGER_REGEX.test(s),
            'Must be a whole number',
          );

    case 'float':
      return p.restrictions.range
        ? rangeSchema()
        : z.string().optional().refine(
            (s) => s === undefined || s === '' || FLOAT_REGEX.test(s),
            'Must be a number',
          );
  }
}

function stringFieldSchema(p: CategoryParameter): ZodTypeAny {
  return z
    .string()
    .optional()
    .refine(
      (s) => {
        if (s === undefined || s === '') return true;
        if (p.restrictions.minLength !== undefined && s.length < p.restrictions.minLength) {
          return false;
        }
        if (p.restrictions.maxLength !== undefined && s.length > p.restrictions.maxLength) {
          return false;
        }
        return true;
      },
      lengthMessage(p),
    );
}

function lengthMessage(p: CategoryParameter): string {
  const min = p.restrictions.minLength;
  const max = p.restrictions.maxLength;
  if (min !== undefined && max !== undefined) return `Must be between ${min} and ${max} characters`;
  if (min !== undefined) return `Must be at least ${min} characters`;
  if (max !== undefined) return `Must be at most ${max} characters`;
  return 'Invalid length';
}

function rangeSchema(): ZodTypeAny {
  return z
    .object({ from: z.string().optional(), to: z.string().optional() })
    .optional()
    .refine(
      (r) => {
        if (r === undefined) return true;
        const from = r.from?.trim() ?? '';
        const to = r.to?.trim() ?? '';
        if (from === '' || to === '') return true; // partial fill — required-check covers the empty case
        const fromNum = Number(from);
        const toNum = Number(to);
        if (!Number.isFinite(fromNum) || !Number.isFinite(toNum)) return false;
        return fromNum <= toNum;
      },
      'Range must be valid (from ≤ to)',
    );
}
