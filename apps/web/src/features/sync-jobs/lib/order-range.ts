/**
 * Order range
 *
 * The form value, validation and job payload of the manual "import orders from
 * a date range" run (#4228). Days are local `YYYY-MM-DD` strings, the same
 * shape the start choice uses; the backend reads a day as the whole day in the
 * shop's own time. Pure functions, so the rules are testable without the dialog.
 *
 * @module apps/web/src/features/sync-jobs/lib
 */
export type OrderRangeDirection = 'oldest-first' | 'newest-first';

export interface OrderRangeValue {
  from: string;
  to: string;
  direction: OrderRangeDirection;
}

export interface OrderRangeErrors {
  from?: string;
  to?: string;
}

export const ORDER_RANGE_DEFAULT_VALUE: OrderRangeValue = {
  from: '',
  to: '',
  direction: 'oldest-first',
};

/** How far back a range may reach, matching the start choice's own bound. */
const MAX_YEARS = 5;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayOrderRangeDate(now: Date = new Date()): string {
  return toDateString(now);
}

export function earliestOrderRangeDate(now: Date = new Date()): string {
  // Plus one day: the backend compares instants, so the exact five-year-old day is refused.
  return toDateString(new Date(now.getFullYear() - MAX_YEARS, now.getMonth(), now.getDate() + 1));
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  );
}

export type OrderRangeErrorKey =
  | 'fromRequired'
  | 'fromInvalid'
  | 'fromTooOld'
  | 'toInvalid'
  | 'toBeforeFrom'
  | 'future';

/** The problems with a range as error KEYS; the caller turns them into copy. */
export function validateOrderRange(
  value: OrderRangeValue,
  now: Date = new Date()
): { from?: OrderRangeErrorKey; to?: OrderRangeErrorKey } {
  const errors: { from?: OrderRangeErrorKey; to?: OrderRangeErrorKey } = {};
  const today = todayOrderRangeDate(now);
  if (value.from === '') errors.from = 'fromRequired';
  else if (!isRealDate(value.from)) errors.from = 'fromInvalid';
  else if (value.from > today) errors.from = 'future';
  else if (value.from < earliestOrderRangeDate(now)) errors.from = 'fromTooOld';

  if (value.to !== '') {
    if (!isRealDate(value.to)) errors.to = 'toInvalid';
    else if (value.to > today) errors.to = 'future';
    else if (value.from !== '' && value.to < value.from) errors.to = 'toBeforeFrom';
  }
  return errors;
}

/**
 * The `marketplace.orders.import` payload for a valid range. `runId` identifies
 * the run: it is the dialog's intent key, so a double click cannot start two.
 */
export function toOrderImportPayload(
  value: OrderRangeValue,
  runId: string
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId,
    from: value.from,
    ...(value.to !== '' ? { to: value.to } : {}),
    direction: value.direction,
    cursor: null,
    page: 1,
  };
}
