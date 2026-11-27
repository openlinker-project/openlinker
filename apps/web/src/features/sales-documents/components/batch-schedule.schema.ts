/**
 * Batch schedule form schema (#3584)
 *
 * One kind's schedule as an operator edits it, and its mapping to the stored
 * `salesDocument.batchSchedules[kind]` the worker reads (`readBatchSchedule`,
 * #3583). The rules mirror that reader: a 24-hour `HH:MM`, 1-24 hours, and a
 * time zone `Intl` accepts. The reader falls back silently on a bad value, so
 * the form refuses it instead of letting a typo change when documents go out.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { z } from 'zod';
import { getMessages } from '../../../shared/i18n';
import type { BatchScheduleConfig } from '../api/sales-documents.types';
import type { BatchScheduleView } from '../api/sales-document-batch.types';

export const DEFAULT_BATCH_TIME_ZONE = 'Europe/Warsaw';
export const DEFAULT_BATCH_TIME = '18:00';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(value: string): boolean {
  if (value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const batchScheduleSchema = z
  .object({
    frequency: z.enum(['daily', 'every-n-hours', 'month-end']),
    time: z.string(),
    everyHours: z.string(),
    timeZone: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    // Read at validation time, so the message follows the active language.
    const messages = getMessages('sales-documents').batch.form.validation;
    if (values.frequency === 'daily' && !TIME_PATTERN.test(values.time)) {
      ctx.addIssue({ code: 'custom', path: ['time'], message: messages.time });
    }
    if (values.frequency === 'every-n-hours') {
      const hours = Number(values.everyHours);
      if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
        ctx.addIssue({
          code: 'custom',
          path: ['everyHours'],
          message: messages.everyHours,
        });
      }
    }
    if (!isValidTimeZone(values.timeZone)) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeZone'],
        message: messages.timeZone,
      });
    }
  });

export type BatchScheduleFormValues = z.input<typeof batchScheduleSchema>;
export type BatchScheduleFormSubmission = z.output<typeof batchScheduleSchema>;

export function toBatchScheduleFormValues(
  view: BatchScheduleView | undefined
): BatchScheduleFormValues {
  return {
    frequency: view?.frequency ?? 'daily',
    time: view?.time ?? DEFAULT_BATCH_TIME,
    everyHours: String(view?.everyHours ?? 4),
    timeZone: view?.timeZone ?? DEFAULT_BATCH_TIME_ZONE,
  };
}

/**
 * The stored value. `effectiveFrom` is the moment of saving, so a schedule
 * saved at 19:00 does not immediately run the 18:00 slot it has just passed.
 */
export function toBatchScheduleConfig(
  values: BatchScheduleFormSubmission,
  now: Date
): BatchScheduleConfig {
  const base = {
    frequency: values.frequency,
    timeZone: values.timeZone,
    effectiveFrom: now.toISOString(),
  };
  if (values.frequency === 'daily') return { ...base, time: values.time };
  if (values.frequency === 'every-n-hours')
    return { ...base, everyHours: Number(values.everyHours) };
  return base;
}
