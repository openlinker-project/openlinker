/**
 * Empik offer settings
 *
 * The two values every new Empik offer needs that OpenLinker does not hold
 * (#4278): the lead time (days to ship) and the logistic class. The batch sets
 * them in `platformParams`; the connection's `offerDefaults` seed the form.
 * The bounds mirror the backend's (`readMiraklOfferDefaults`): a lead time of
 * 0-30 whole days and a non-empty logistic class code.
 *
 * @module features/listings/components/empik
 */

export interface EmpikOfferSettings {
  leadTimeToShip?: number;
  logisticClass?: string;
}

export const EMPIK_MAX_LEAD_TIME_DAYS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidEmpikLeadTime(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= EMPIK_MAX_LEAD_TIME_DAYS
  );
}

/** The valid settings found in `value`; anything else is left out. */
export function readEmpikOfferSettings(value: unknown): EmpikOfferSettings {
  if (!isRecord(value)) {
    return {};
  }
  const logistic =
    typeof value.logisticClass === 'string' || typeof value.logisticClass === 'number'
      ? String(value.logisticClass).trim()
      : '';
  return {
    ...(isValidEmpikLeadTime(value.leadTimeToShip) && { leadTimeToShip: value.leadTimeToShip }),
    ...(logistic !== '' && { logisticClass: logistic }),
  };
}

/** The connection's `offerDefaults`, the batch's starting values. */
export function readEmpikConnectionOfferDefaults(
  config: Record<string, unknown>
): EmpikOfferSettings {
  return readEmpikOfferSettings(config.offerDefaults);
}

/** Both values set and valid: the config step may continue. */
export function empikBulkConfigIsComplete(values: {
  platformParams: Record<string, unknown>;
}): boolean {
  const settings = readEmpikOfferSettings(values.platformParams);
  return settings.leadTimeToShip !== undefined && settings.logisticClass !== undefined;
}
