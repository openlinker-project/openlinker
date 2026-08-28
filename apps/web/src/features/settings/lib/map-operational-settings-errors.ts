/**
 * Operational Settings — server error routing
 *
 * Puts a rejected value's message next to the control that produced it,
 * rather than in one banner above the form. A banner reading "value out of
 * range" over five controls asks the operator to find the offending one, and
 * they are the person least equipped to.
 *
 * Every message the API can return for this surface begins with the field
 * name — both `class-validator`'s (`catalogueSweepBudget must not be greater
 * than 2000`) and the domain error's (`deletionAuditCadence must fire at
 * least once every 7 days...`), which is what makes prefix matching sound
 * rather than a guess. Anything that matches nothing is returned as a
 * form-level message instead of being dropped: an unattributed error is still
 * an error, and swallowing it is worse than showing it once at the top.
 *
 * @module apps/web/src/features/settings/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type { OperationalSettingField } from '../api/operational-settings.types';

const FIELDS: readonly OperationalSettingField[] = [
  'catalogueSweepBudget',
  'inventorySweepBudget',
  'sweepPageSize',
  'deletionAuditBudget',
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

function readMessages(error: unknown): string[] {
  if (error instanceof ApiError) {
    const details = error.details;
    if (typeof details === 'object' && details !== null && 'message' in details) {
      const raw = (details as { message: unknown }).message;
      if (Array.isArray(raw)) {
        return raw.map((entry) => String(entry));
      }
      if (typeof raw === 'string') {
        return [raw];
      }
    }
    return [error.message];
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return [];
}

export function mapOperationalSettingsErrors(error: unknown): OperationalSettingsErrors {
  if (error === null || error === undefined) {
    return NO_OPERATIONAL_SETTINGS_ERRORS;
  }

  const fieldErrors: Partial<Record<OperationalSettingField, string>> = {};
  const formErrors: string[] = [];

  for (const message of readMessages(error)) {
    const field = FIELDS.find((candidate) => message.includes(candidate));
    if (field === undefined) {
      formErrors.push(message);
      continue;
    }
    // First message per field wins — a second one for the same control would
    // replace a specific complaint with a generic one.
    if (fieldErrors[field] === undefined) {
      fieldErrors[field] = message;
    }
  }

  return { fieldErrors, formErrors };
}
