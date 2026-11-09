/**
 * Operational Settings — server error routing
 *
 * Puts a rejected value's message next to the control that produced it,
 * rather than in one banner above the form. A banner reading "value out of
 * range" over five controls asks the operator to find the offending one, and
 * they are the person least equipped to.
 *
 * A validation refusal names each invalid field by its path into the request
 * body (#3861), and the domain refusal (`OPERATIONAL_SETTING_INVALID`) names
 * its field in `params.field`, so routing a message to its control is a match
 * on a name rather than a guess. The sentence itself comes from the shared
 * error copy in the operator's language. Anything that names no known field is
 * returned as a form-level message instead of being dropped: an unattributed
 * error is still an error, and swallowing it is worse than showing it once at
 * the top.
 *
 * @module apps/web/src/features/settings/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { describeFieldError } from '../../../shared/api/apply-field-errors';
import { describeApiError } from '../../../shared/api/describe-api-error';
import type { OperationalSettingField } from '../api/operational-settings.types';

const FIELDS: readonly OperationalSettingField[] = [
  'catalogueSweepBudget',
  'inventorySweepBudget',
  'sweepPageSize',
  'deletionAuditBudget',
  'syncJobRetentionDays',
  'syncJobDeadRetentionDays',
  'inventoryMovementRetentionDays',
  'stockStaleSyncThresholdHours',
  'deletionAuditCadence',
];

export interface OperationalSettingsErrors {
  readonly fieldErrors: Partial<Record<OperationalSettingField, string>>;
  /** Messages that named no field, plus non-validation failures. */
  readonly formErrors: readonly string[];
}

export const NO_OPERATIONAL_SETTINGS_ERRORS: OperationalSettingsErrors = {
  fieldErrors: {},
  formErrors: [],
};

function fieldFor(path: string): OperationalSettingField | undefined {
  return FIELDS.find((candidate) => path === candidate || path.startsWith(`${candidate}.`));
}

export function mapOperationalSettingsErrors(error: unknown): OperationalSettingsErrors {
  if (error === null || error === undefined) {
    return NO_OPERATIONAL_SETTINGS_ERRORS;
  }

  const fieldErrors: Partial<Record<OperationalSettingField, string>> = {};
  const formErrors: string[] = [];

  if (error instanceof ApiError && error.fields.length > 0) {
    for (const field of error.fields) {
      const target = fieldFor(field.path);
      if (target === undefined) {
        formErrors.push(describeFieldError(field));
        continue;
      }
      // First message per field wins — a second one for the same control would
      // replace a specific complaint with a generic one.
      if (fieldErrors[target] === undefined) {
        fieldErrors[target] = describeFieldError(field);
      }
    }
    return { fieldErrors, formErrors };
  }

  const sentence = describeApiError(error, 'settings');
  const named = error instanceof ApiError ? error.params.field : undefined;
  const target = typeof named === 'string' ? fieldFor(named) : undefined;
  if (target === undefined) {
    formErrors.push(sentence);
  } else {
    fieldErrors[target] = sentence;
  }
  return { fieldErrors, formErrors };
}
