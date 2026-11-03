/**
 * Batch issuing schedule - the pure rules (#3583, epic #3515)
 *
 * When a connection batches a document kind (`triggerModel = 'batched'`, read
 * per kind since #3582), its queued orders are issued together at scheduled
 * SLOTS. This file owns the schedule's shape, its tolerant reader, and the
 * arithmetic that turns "daily at 18:00" into the instant a run is due.
 *
 * ## Where it lives
 *
 * `Connection.config.salesDocument.batchSchedules[kind]`, beside the kind and
 * the kind-scoped trigger model, so one connection can batch invoices monthly
 * and receipts daily. Kind-keyed for the same open-world reason
 * `triggerModels` is.
 *
 * ## The time zone travels WITH the schedule
 *
 * "18:00" is a wall-clock time, and nothing in this system has an install-wide
 * time zone (mockup M15 shows "Server time zone: Europe/Warsaw" as a caption,
 * but no setting backs it). Storing `timeZone` in the schedule means the worker
 * that fires a run and the API that shows the next one read the SAME value and
 * cannot disagree, which an env var on each process could not promise. A
 * missing or unknown zone reads as `Europe/Warsaw`, the pilot's zone.
 *
 * ## D42 - month end is business customers only
 *
 * A `month-end` schedule yields two slots: the last calendar day at 23:00 for
 * B2B orders, and a daily 23:00 slot for everyone else, so a consumer order on
 * a month-end connection is never left unissued.
 *
 * ## The `*.types.ts` pure-rule exception applies
 *
 * Pure: no clock, no env, no I/O. `now` is an argument.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import type { SalesDocumentKind } from './sales-document-kind.types';

export const BatchFrequencyValues = ['daily', 'every-n-hours', 'month-end'] as const;
export type BatchFrequency = (typeof BatchFrequencyValues)[number];

/** Which orders of the queue a slot issues (D42). */
export const BatchRunSegmentValues = ['all', 'b2b', 'b2c'] as const;
export type BatchRunSegment = (typeof BatchRunSegmentValues)[number];

export const DEFAULT_BATCH_TIME_ZONE = 'Europe/Warsaw';
export const DEFAULT_BATCH_TIME = '18:00';
/** M15: "Runs once, on the last calendar day of the month at 23:00". */
export const MONTH_END_BATCH_TIME = '23:00';

export interface BatchSchedule {
  frequency: BatchFrequency;
  /** `HH:MM`, 24-hour, in `timeZone`. Used by `daily`. */
  time: string;
  /** 1..24, hours between runs from 00:00. Used by `every-n-hours`. */
  everyHours: number;
  /** IANA zone the wall-clock times are read in. */
  timeZone: string;
  /** No slot before this instant fires, so enabling a schedule at 19:00 does not run today's 18:00. */
  effectiveFrom: Date;
}

export interface DueBatchSlot {
  slotAt: Date;
  segment: BatchRunSegment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBatchFrequency(value: unknown): value is BatchFrequency {
  return typeof value === 'string' && (BatchFrequencyValues as readonly string[]).includes(value);
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function readTime(value: unknown): string {
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : DEFAULT_BATCH_TIME;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The batch schedule for one kind, or `null` when none is readable.
 *
 * An unreadable frequency is `null` - never a guessed schedule, because a
 * guessed one would issue fiscal documents nobody scheduled. Every other field
 * degrades to its documented default. A missing `effectiveFrom` reads as the
 * epoch: the most recent slot then fires once, which only issues what is
 * already queued and paid.
 */
export function readBatchSchedule(config: unknown, kind: SalesDocumentKind): BatchSchedule | null {
  const record = isRecord(config) ? config : {};
  const salesDocument = isRecord(record.salesDocument) ? record.salesDocument : {};
  const schedules = isRecord(salesDocument.batchSchedules) ? salesDocument.batchSchedules : {};
  const raw = schedules[kind];
  if (!isRecord(raw) || !isBatchFrequency(raw.frequency)) {
    return null;
  }

  const everyHoursRaw = raw.everyHours;
  const everyHours =
    typeof everyHoursRaw === 'number' &&
    Number.isInteger(everyHoursRaw) &&
    everyHoursRaw >= 1 &&
    everyHoursRaw <= 24
      ? everyHoursRaw
      : 24;

  const effectiveFromRaw = typeof raw.effectiveFrom === 'string' ? new Date(raw.effectiveFrom) : null;
  const effectiveFrom =
    effectiveFromRaw !== null && !Number.isNaN(effectiveFromRaw.getTime())
      ? effectiveFromRaw
      : new Date(0);

  return {
    frequency: raw.frequency,
    time: readTime(raw.time),
    everyHours,
    timeZone: isValidTimeZone(raw.timeZone) ? raw.timeZone : DEFAULT_BATCH_TIME_ZONE,
    effectiveFrom,
  };
}

/**
 * Why `config.salesDocument.batchSchedules` cannot be stored, or `null` when it
 * can. The write-side twin of `readBatchSchedule`, which degrades a bad time,
 * interval or zone to its default silently: a typo there changes WHEN fiscal
 * documents go out with nothing reported. The schedule form refuses such
 * values, but the raw config editor, curl and MCP do not go through the form
 * (#2610), so the server refuses them too. An absent or `null` key - and a
 * `null` per-kind entry (a cleared schedule) - is fine.
 */
export function describeInvalidBatchSchedules(config: unknown): string | null {
  const record = isRecord(config) ? config : {};
  const salesDocument = record.salesDocument;
  if (salesDocument === undefined || salesDocument === null) return null;
  if (!isRecord(salesDocument)) return 'config.salesDocument must be an object';
  const schedules = salesDocument.batchSchedules;
  if (schedules === undefined || schedules === null) return null;
  if (!isRecord(schedules)) return 'config.salesDocument.batchSchedules must be an object';

  for (const [kind, raw] of Object.entries(schedules)) {
    if (raw === null) continue;
    const path = `config.salesDocument.batchSchedules.${kind}`;
    if (!isRecord(raw)) return `${path} must be an object`;
    if (!isBatchFrequency(raw.frequency)) {
      return `${path}.frequency must be one of: ${BatchFrequencyValues.join(', ')}`;
    }
    if (raw.frequency === 'daily' && !(typeof raw.time === 'string' && TIME_PATTERN.test(raw.time))) {
      return `${path}.time must be a 24-hour HH:MM time`;
    }
    if (
      raw.frequency === 'every-n-hours' &&
      !(
        typeof raw.everyHours === 'number' &&
        Number.isInteger(raw.everyHours) &&
        raw.everyHours >= 1 &&
        raw.everyHours <= 24
      )
    ) {
      return `${path}.everyHours must be a whole number from 1 to 24`;
    }
    if (raw.timeZone !== undefined && !isValidTimeZone(raw.timeZone)) {
      return `${path}.timeZone must be an IANA time zone such as ${DEFAULT_BATCH_TIME_ZONE}`;
    }
    if (
      raw.effectiveFrom !== undefined &&
      (typeof raw.effectiveFrom !== 'string' || Number.isNaN(new Date(raw.effectiveFrom).getTime()))
    ) {
      return `${path}.effectiveFrom must be an ISO date-time`;
    }
  }
  return null;
}

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

interface CivilDateTime extends CivilDate {
  hour: number;
  minute: number;
}

// Building an `Intl.DateTimeFormat` costs far more than using one, and
// `findNextBatchSlots` formats thousands of instants per call.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** UTC offset (ms) of `timeZone` at `instant`, robust across DST with no hard-coded rules. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asIfUtc - instant;
}

function toCivil(date: Date, timeZone: string): CivilDateTime {
  const shifted = new Date(date.getTime() + offsetMs(date.getTime(), timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Wall-clock in `timeZone` → instant. Two-pass so a date across a DST change settles. */
function civilToInstant(c: CivilDateTime, timeZone: string): Date {
  const asIfUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  const first = offsetMs(asIfUtc, timeZone);
  let instant = asIfUtc - first;
  const settled = offsetMs(instant, timeZone);
  if (settled !== first) {
    instant = asIfUtc - settled;
  }
  return new Date(instant);
}

/** Calendar arithmetic on a civil date, normalised through `Date.UTC`. */
function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function lastDayOfMonth(year: number, month: number): CivilDate {
  const d = new Date(Date.UTC(year, month, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

/** The most recent daily slot at `time` that is not after `now`. */
function lastDailySlot(now: Date, time: string, timeZone: string): Date {
  const today = toCivil(now, timeZone);
  const { hour, minute } = parseTime(time);
  const candidate = civilToInstant({ ...today, hour, minute }, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    return candidate;
  }
  return civilToInstant({ ...addDays(today, -1), hour, minute }, timeZone);
}

/** The most recent `every-n-hours` slot (from 00:00 each day) that is not after `now`. */
function lastIntervalSlot(now: Date, everyHours: number, timeZone: string): Date {
  const today = toCivil(now, timeZone);
  const hour = Math.floor(today.hour / everyHours) * everyHours;
  const candidate = civilToInstant({ ...today, hour, minute: 0 }, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    return candidate;
  }
  // Only reachable around a DST change; fall back to the previous slot.
  const previousHour = hour - everyHours;
  if (previousHour >= 0) {
    return civilToInstant({ ...today, hour: previousHour, minute: 0 }, timeZone);
  }
  const yesterday = addDays(today, -1);
  const lastHourYesterday = Math.floor(23 / everyHours) * everyHours;
  return civilToInstant({ ...yesterday, hour: lastHourYesterday, minute: 0 }, timeZone);
}

/** The most recent month-end slot (last calendar day, 23:00) that is not after `now`. */
function lastMonthEndSlot(now: Date, timeZone: string): Date {
  const today = toCivil(now, timeZone);
  const { hour, minute } = parseTime(MONTH_END_BATCH_TIME);
  const thisMonthEnd = civilToInstant(
    { ...lastDayOfMonth(today.year, today.month), hour, minute },
    timeZone,
  );
  if (thisMonthEnd.getTime() <= now.getTime()) {
    return thisMonthEnd;
  }
  const previousMonth = lastDayOfMonth(today.year, today.month - 1);
  return civilToInstant({ ...previousMonth, hour, minute }, timeZone);
}

/**
 * The slots due at `now`: for each segment, the most recent slot that is not
 * after `now` and not before `effectiveFrom`.
 *
 * Only the MOST RECENT slot per segment is returned, never the backlog: a run
 * issues everything queued, so a slot missed while the worker was down is
 * covered by the next one, and replaying them would only produce empty runs.
 * The caller dedupes on the slot instant, so returning the same slot on every
 * tick until the next one is the intended contract.
 */
export function findDueBatchSlots(schedule: BatchSchedule, now: Date): DueBatchSlot[] {
  const candidates: DueBatchSlot[] = [];
  switch (schedule.frequency) {
    case 'daily':
      candidates.push({
        slotAt: lastDailySlot(now, schedule.time, schedule.timeZone),
        segment: 'all',
      });
      break;
    case 'every-n-hours':
      candidates.push({
        slotAt: lastIntervalSlot(now, schedule.everyHours, schedule.timeZone),
        segment: 'all',
      });
      break;
    case 'month-end':
      candidates.push(
        { slotAt: lastMonthEndSlot(now, schedule.timeZone), segment: 'b2b' },
        // D42: consumer orders on a month-end connection go out daily.
        { slotAt: lastDailySlot(now, MONTH_END_BATCH_TIME, schedule.timeZone), segment: 'b2c' },
      );
      break;
  }
  return candidates.filter((slot) => slot.slotAt.getTime() >= schedule.effectiveFrom.getTime());
}

/** The first daily slot at `time` strictly after `now`. */
function nextDailySlot(now: Date, time: string, timeZone: string): Date {
  const today = toCivil(now, timeZone);
  const { hour, minute } = parseTime(time);
  for (let offset = 0; offset <= 2; offset += 1) {
    const candidate = civilToInstant({ ...addDays(today, offset), hour, minute }, timeZone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return civilToInstant({ ...addDays(today, 3), hour, minute }, timeZone);
}

/** The first `every-n-hours` slot (from 00:00 each day) strictly after `now`. */
function nextIntervalSlot(now: Date, everyHours: number, timeZone: string): Date {
  const today = toCivil(now, timeZone);
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = addDays(today, offset);
    for (let hour = 0; hour <= 23; hour += everyHours) {
      const candidate = civilToInstant({ ...day, hour, minute: 0 }, timeZone);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  return civilToInstant({ ...addDays(today, 3), hour: 0, minute: 0 }, timeZone);
}

/** The first month-end slot (last calendar day, 23:00) strictly after `now`. */
function nextMonthEndSlot(now: Date, timeZone: string): Date {
  const today = toCivil(now, timeZone);
  const { hour, minute } = parseTime(MONTH_END_BATCH_TIME);
  const thisMonthEnd = civilToInstant(
    { ...lastDayOfMonth(today.year, today.month), hour, minute },
    timeZone,
  );
  if (thisMonthEnd.getTime() > now.getTime()) return thisMonthEnd;
  return civilToInstant({ ...lastDayOfMonth(today.year, today.month + 1), hour, minute }, timeZone);
}

/**
 * The next slot after `now` for each segment - what a screen shows as
 * "Next run". Computed directly from the calendar with the same civil-time
 * helpers `findDueBatchSlots` uses, so the two agree on where slots fall (the
 * spec pins that against the due-slot rule). It used to step `now` forward in
 * 5-minute increments, which cost ~0.5 s of CPU per call for a month-end
 * schedule on the overview read the batch screen polls.
 */
export function findNextBatchSlots(schedule: BatchSchedule, now: Date): DueBatchSlot[] {
  switch (schedule.frequency) {
    case 'daily':
      return [{ slotAt: nextDailySlot(now, schedule.time, schedule.timeZone), segment: 'all' }];
    case 'every-n-hours':
      return [
        { slotAt: nextIntervalSlot(now, schedule.everyHours, schedule.timeZone), segment: 'all' },
      ];
    case 'month-end':
      return [
        { slotAt: nextMonthEndSlot(now, schedule.timeZone), segment: 'b2b' },
        { slotAt: nextDailySlot(now, MONTH_END_BATCH_TIME, schedule.timeZone), segment: 'b2c' },
      ];
  }
}
