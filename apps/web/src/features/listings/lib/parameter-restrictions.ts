/**
 * Category-parameter restrictions (FE mirror, #2243)
 *
 * Pure, side-effect-free client mirror of the CORE checker
 * (`libs/core/src/listings/application/services/check-parameter-restrictions.ts`).
 * No network calls: it reads the category schema the wizard already fetched and
 * the parameter values the operator already entered, so it can run in the Review
 * step before anything is submitted.
 *
 * Two halves, one rule. The browser can only check what the operator authored -
 * values injected server-side by attribute mapping rules (#1841) are assembled
 * in the worker and have no HTTP surface, so CORE checks those. Both halves must
 * agree on the vocabulary or an operator sees one wording in Review and another
 * in a failed record; `scripts/check-parameter-restriction-mirror.mjs` fails the
 * build if the code lists drift. The browser bundle cannot import
 * `@openlinker/core`, which is why this is a copy at all - same reason and same
 * shape as `allegro-title.ts` and `lib/required-to-sell.ts`.
 *
 * **Two divergences from core are intentional, and the guard cannot see either**
 * (it compares the issue-code arrays, not behaviour):
 *
 * - This half filters `''` out of `texts` / `values` before counting them, core
 *   does not. Harmless because core's only caller `continue`s on an empty
 *   `destinationValue` before it ever reaches the checker, so the empty string
 *   is unreachable there - but the browser really can hold one, from a field the
 *   operator cleared, and counting it would report `TOO_MANY_VALUES` for a value
 *   that will not be sent.
 * - The FE `ParameterRestrictionIssue` carries no `severity`. Advisory-versus-
 *   blocking is decided one level up here, by `ChipDescriptor.advisory`, so a
 *   second per-issue copy of that decision would be a place for the two to
 *   disagree. Core needs the field because it has no chip layer.
 *
 * Anything else that drifts is a bug, not a variant. Add to this list only with
 * the reason, never to record a difference that just happened.
 *
 * @module apps/web/src/features/listings/lib
 */

/**
 * Structural input shapes, declared here rather than imported, so BOTH the
 * feature's own `CategoryParameter` and the plugin contract's
 * `CategoryParameterLike` satisfy them. The plugin contract may not import
 * feature types (`shared` → `features` is banned), and this checker is consumed
 * from both sides.
 */
export interface RestrictedParameter {
  id: string;
  name: string;
  type: 'string' | 'integer' | 'float' | 'dictionary';
  dictionary?: readonly { id: string; value: string }[];
  restrictions: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    precision?: number;
    allowedNumberOfValues?: number;
    customValuesEnabled?: boolean;
  };
}

export interface SuppliedParameterValue {
  id: string;
  values?: readonly string[];
  valuesIds?: readonly string[];
  rangeValue?: { from: string; to: string };
}

/** Mirrors `ParameterRestrictionIssueCodeValues` in CORE, in order. */
export const ParameterRestrictionIssueCodeValues = [
  'VALUE_TOO_SHORT',
  'VALUE_TOO_LONG',
  'VALUE_BELOW_MIN',
  'VALUE_ABOVE_MAX',
  'PRECISION_EXCEEDED',
  'NOT_NUMERIC',
  'VALUE_NOT_IN_DICTIONARY',
  'TOO_MANY_VALUES',
] as const;
export type ParameterRestrictionIssueCode =
  (typeof ParameterRestrictionIssueCodeValues)[number];

export interface ParameterRestrictionIssue {
  code: ParameterRestrictionIssueCode;
  parameterId: string;
  parameterName: string;
  message: string;
}

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Check one parameter's supplied value against the bounds its own schema
 * declares. Nothing here carries a bound of its own - a hardcoded limit would
 * repeat the defect this closes (the marketplace told us the limit and we
 * published anyway).
 */
export function checkParameterRestrictions(
  parameter: RestrictedParameter,
  value: { values?: readonly string[]; texts?: readonly string[] },
): ParameterRestrictionIssue[] {
  const issues: ParameterRestrictionIssue[] = [];
  const push = (code: ParameterRestrictionIssueCode, message: string): void => {
    issues.push({ code, parameterId: parameter.id, parameterName: parameter.name, message });
  };

  const texts = (value.texts ?? []).map((t) => String(t)).filter((t) => t !== '');
  const dictionaryIds = (value.values ?? []).filter((v) => v !== '');
  const suppliedCount = texts.length + dictionaryIds.length;
  if (suppliedCount === 0) return issues;

  const allowed = parameter.restrictions.allowedNumberOfValues;
  if (allowed !== undefined && allowed > 0 && suppliedCount > allowed) {
    push(
      'TOO_MANY_VALUES',
      `${parameter.name} accepts at most ${allowed} ${allowed === 1 ? 'value' : 'values'}, ${suppliedCount} supplied.`,
    );
  }

  if (parameter.type === 'dictionary') {
    const entries = parameter.dictionary;
    if (entries && entries.length > 0 && !parameter.restrictions.customValuesEnabled) {
      const allowedIds = new Set(entries.map((e) => e.id));
      const allowedValues = new Set(entries.map((e) => e.value));
      for (const id of dictionaryIds) {
        if (!allowedIds.has(id)) {
          push(
            'VALUE_NOT_IN_DICTIONARY',
            `"${id}" is not one of the values ${parameter.name} allows in this category.`,
          );
        }
      }
      for (const text of texts) {
        if (!allowedValues.has(text) && !allowedIds.has(text)) {
          push(
            'VALUE_NOT_IN_DICTIONARY',
            `"${text}" is not one of the values ${parameter.name} allows in this category.`,
          );
        }
      }
    }
    return issues;
  }

  const { minLength, maxLength, min, max, precision } = parameter.restrictions;

  for (const text of texts) {
    if (parameter.type === 'string') {
      if (minLength !== undefined && text.length < minLength) {
        push(
          'VALUE_TOO_SHORT',
          `${parameter.name} needs at least ${minLength} characters, "${text}" has ${text.length}.`,
        );
      }
      if (maxLength !== undefined && text.length > maxLength) {
        push(
          'VALUE_TOO_LONG',
          `${parameter.name} allows at most ${maxLength} characters, this value has ${text.length}.`,
        );
      }
      continue;
    }

    const trimmed = text.trim();
    if (!NUMERIC_PATTERN.test(trimmed)) {
      push('NOT_NUMERIC', `${parameter.name} must be a number, "${text}" is not.`);
      continue;
    }
    const numeric = Number(trimmed);
    if (parameter.type === 'integer' && !Number.isInteger(numeric)) {
      push('NOT_NUMERIC', `${parameter.name} must be a whole number, "${text}" is not.`);
      continue;
    }
    if (min !== undefined && numeric < min) {
      push('VALUE_BELOW_MIN', `${parameter.name} must be at least ${min}, this value is ${numeric}.`);
    }
    if (max !== undefined && numeric > max) {
      push('VALUE_ABOVE_MAX', `${parameter.name} must be at most ${max}, this value is ${numeric}.`);
    }
    if (parameter.type === 'float' && precision !== undefined) {
      const dot = trimmed.indexOf('.');
      const decimals = dot === -1 ? 0 : trimmed.length - dot - 1;
      if (decimals > precision) {
        push(
          'PRECISION_EXCEEDED',
          `${parameter.name} allows ${precision} decimal ${precision === 1 ? 'place' : 'places'}, this value has ${decimals}.`,
        );
      }
    }
  }

  return issues;
}

/**
 * Run the check over every operator-supplied parameter of one row against the
 * category schema. Parameters the schema does not describe are skipped: an
 * unknown id is the adapter's problem, not a bound violation, and guessing a
 * rule for it is exactly what this module refuses to do.
 */
export function checkRowParameterRestrictions(
  schema: readonly RestrictedParameter[],
  supplied: readonly SuppliedParameterValue[],
): ParameterRestrictionIssue[] {
  if (schema.length === 0 || supplied.length === 0) return [];
  const byId = new Map(schema.map((p) => [p.id, p]));
  const issues: ParameterRestrictionIssue[] = [];
  for (const parameter of supplied) {
    const declared = byId.get(parameter.id);
    if (!declared) continue;
    // A range value is two numbers against the same bounds.
    const texts = parameter.rangeValue
      ? [parameter.rangeValue.from, parameter.rangeValue.to]
      : parameter.values;
    issues.push(
      ...checkParameterRestrictions(declared, { values: parameter.valuesIds, texts }),
    );
  }
  return issues;
}
