/**
 * Category-Parameter Restriction Checker
 *
 * Pure, side-effect-free function (#2243): given one parameter's declaration and
 * one value for it, report every declared bound the value breaks. No I/O, no
 * platform knowledge, no bound of its own — every limit is read off
 * `CategoryParameter.restrictions`, which is the whole point. A hardcoded bound
 * here would repeat the defect this exists to close: Allegro told us the limit,
 * and we published anyway.
 *
 * Sits beside `check-required-to-sell.ts` and follows the same contract: pure
 * input projection in, issues out, caller decides. Consumed by
 * `AttributeProjectionService` for values produced server-side by attribute
 * mapping rules (#1841), and mirrored in the browser
 * (`apps/web/src/features/listings/lib/parameter-restrictions.ts`) for values the
 * operator types — the two halves are kept aligned by
 * `scripts/check-parameter-restriction-mirror.mjs`.
 *
 * @module libs/core/src/listings/application/services
 */

import type { CategoryParameter } from '../../domain/types/category-parameter.types';
import type {
  ParameterRestrictionIssue,
  ParameterValueInput,
} from '../../domain/types/parameter-restriction.types';

/** Digits, optional single decimal point, optional leading sign. */
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

export function checkParameterRestrictions(
  parameter: CategoryParameter,
  value: ParameterValueInput,
): ParameterRestrictionIssue[] {
  const issues: ParameterRestrictionIssue[] = [];
  const push = (
    code: ParameterRestrictionIssue['code'],
    message: string,
  ): void => {
    issues.push({
      code,
      severity: 'block',
      parameterId: parameter.id,
      parameterName: parameter.name,
      message,
    });
  };

  const texts = (value.texts ?? []).map((t) => String(t));
  const dictionaryIds = value.values ?? [];
  const suppliedCount = texts.length + dictionaryIds.length;
  if (suppliedCount === 0) return issues;

  // How many values the parameter accepts. `allowedNumberOfValues` is the
  // platform-precise count; `multiValue`/`multipleChoices` only say "more than
  // one", so they can raise the ceiling but never lower it below what was
  // actually declared.
  const allowed = parameter.restrictions.allowedNumberOfValues;
  if (allowed !== undefined && allowed > 0 && suppliedCount > allowed) {
    push(
      'TOO_MANY_VALUES',
      `${parameter.name} accepts at most ${allowed} ${allowed === 1 ? 'value' : 'values'}, ${suppliedCount} supplied.`,
    );
  }

  if (parameter.type === 'dictionary') {
    // A dictionary the destination did not enumerate cannot be checked, and a
    // parameter that accepts free text has no closed set to check against.
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
      // A free-text value against a closed dictionary is the same violation —
      // this is the shape an attribute mapping rule produces, since a rule
      // writes what the source catalogue called the value, not an id.
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

    // integer | float
    if (!NUMERIC_PATTERN.test(text.trim())) {
      push('NOT_NUMERIC', `${parameter.name} must be a number, "${text}" is not.`);
      continue;
    }
    const numeric = Number(text.trim());
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
      const decimals = decimalPlaces(text.trim());
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

/** Decimal places in a numeric string, counted on the text so 1.50 reads as 2. */
function decimalPlaces(text: string): number {
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}
