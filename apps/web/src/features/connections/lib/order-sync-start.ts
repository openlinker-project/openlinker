/**
 * Order sync start
 *
 * The form value, the zod rule and the create-payload mapping for the "which
 * orders should we import first?" choice (#4228), shared by every guided
 * wizard that creates an order-reading connection. The choice is made once, at
 * connect time, so the date bounds are about what a seller can sensibly ask
 * for: a past day, within the last five years.
 *
 * @module features/connections/lib
 */
import { z } from 'zod';
import {
  ORDER_IMPORT_ORDER_VALUES,
  ORDER_SYNC_START_MODE_VALUES,
  type OrderSyncStart,
  type OrderSyncStartMode,
} from '../api/connections.types';
import { schemaMessage } from './schema-message';

const msg = schemaMessage('orderSyncStartSchema');

export const ORDER_SYNC_START_MAX_YEARS = 5;

/** What the adapter metadata means when it declares nothing. */
export const ORDER_SYNC_START_DEFAULT_MODES: readonly OrderSyncStartMode[] = ['now', 'all'];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` of the day before `today` (local time). */
export function latestOrderSyncStartDate(today: Date = new Date()): string {
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return toDateString(yesterday);
}

/**
 * `YYYY-MM-DD` of the earliest day a start date may name: today minus five
 * years plus one day. The backend compares instants, so the day exactly five
 * years back (which starts before the same moment five years ago) is refused.
 */
export function earliestOrderSyncStartDate(today: Date = new Date()): string {
  return toDateString(
    new Date(
      today.getFullYear() - ORDER_SYNC_START_MAX_YEARS,
      today.getMonth(),
      today.getDate() + 1
    )
  );
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  );
}

export const orderSyncStartSchema = z
  .object({
    mode: z.enum(ORDER_SYNC_START_MODE_VALUES),
    from: z.string().optional(),
    order: z.enum(ORDER_IMPORT_ORDER_VALUES).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== 'from') return;
    const from = value.from ?? '';
    const fail = (key: Parameters<typeof msg>[0]): void => {
      ctx.addIssue({ code: 'custom', path: ['from'], message: msg(key).error() });
    };
    if (from === '') return fail('dateRequired');
    if (!isRealDate(from)) return fail('dateInvalid');
    if (from > latestOrderSyncStartDate()) return fail('dateFuture');
    if (from < earliestOrderSyncStartDate()) return fail('dateTooOld');
  });

export type OrderSyncStartValue = z.input<typeof orderSyncStartSchema>;

export const ORDER_SYNC_START_DEFAULT_VALUE: OrderSyncStartValue = { mode: 'now' };

/**
 * The create-payload part. "Only new orders" is what the backend does with no
 * value, so it is sent as nothing rather than as an explicit default.
 */
export function toOrderSyncStart(
  value: OrderSyncStartValue | undefined
): OrderSyncStart | undefined {
  if (!value || value.mode === 'now') return undefined;
  // Oldest-first is what the backend does with no value, so only the other choice is sent.
  const order = value.order === 'newest-first' ? { order: value.order } : {};
  if (value.mode === 'all') return { mode: 'all', ...order };
  return { mode: 'from', from: value.from ?? '', ...order };
}

/** Whether the order-history step applies to this connection. */
export function readsOrders(capabilities: readonly string[] | undefined): boolean {
  return (capabilities ?? []).includes('OrderSource');
}

interface ReviewCopy {
  now: string;
  all: string;
  from: string;
  /** Appended to "all" and "from" when the newest orders are imported first. */
  newestFirst?: string;
}

/** One-line statement of the choice, for the review step and the summary rail. */
export function describeOrderSyncStart(
  value: OrderSyncStartValue | undefined,
  copy: ReviewCopy,
  formatDate: (iso: string) => string
): string {
  if (!value || value.mode === 'now') return copy.now;
  const suffix = value.order === 'newest-first' && copy.newestFirst ? ` · ${copy.newestFirst}` : '';
  if (value.mode === 'all') return `${copy.all}${suffix}`;
  // A date that is still being typed, or that the schema will refuse, must not
  // be echoed back as the operator's choice, and must not read as "only new
  // orders" either: the summary would then contradict the selected card.
  const from = value.from ?? '';
  const usable =
    isRealDate(from) && from <= latestOrderSyncStartDate() && from >= earliestOrderSyncStartDate();
  return `${copy.from.replace('{date}', usable ? formatDate(`${from}T12:00:00`) : '…')}${suffix}`;
}
