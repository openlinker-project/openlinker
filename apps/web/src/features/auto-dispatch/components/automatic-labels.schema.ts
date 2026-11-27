/**
 * Automatic shipping labels - form schema (#2729)
 *
 * The same bounds the backend enforces on save (`ConnectionService.
 * validateAutoDispatchConfig`): a positive weight, and a box set whole or not at
 * all. They are stated here so the operator sees the problem beside the field
 * instead of as a 400 after Save.
 *
 * An EMPTY weight is deliberately not an error. When every product carries its
 * own weight no fallback is needed, and refusing to save would block a valid
 * setup; the form says what an empty one means instead.
 *
 * @module apps/web/src/features/auto-dispatch/components
 */
import { z } from 'zod';

import { AutoDispatchTriggerValues } from '../api/auto-dispatch.types';
import type { AutoDispatchSettings } from '../lib/auto-dispatch-config';

const optionalPositive = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) > 0), {
      message: `${label} must be a number greater than 0`,
    });

export const automaticLabelsSchema = z
  .object({
    enabled: z.boolean(),
    trigger: z.enum(AutoDispatchTriggerValues),
    defaultWeightGrams: optionalPositive('Weight'),
    parcelTemplate: z.string().trim(),
    lengthMm: optionalPositive('Length'),
    widthMm: optionalPositive('Width'),
    heightMm: optionalPositive('Height'),
  })
  .superRefine((value, context) => {
    const set = [value.lengthMm, value.widthMm, value.heightMm].filter((part) => part !== '');
    if (set.length !== 0 && set.length !== 3) {
      for (const field of ['lengthMm', 'widthMm', 'heightMm'] as const) {
        if (value[field] === '') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: 'Set length, width and height together, or leave all three empty',
          });
        }
      }
    }
  });

export type AutomaticLabelsFormValues = z.input<typeof automaticLabelsSchema>;
export type AutomaticLabelsSubmission = z.output<typeof automaticLabelsSchema>;

/** Typed settings from validated form output; an empty box is "not set". */
export function toAutoDispatchSettings(values: AutomaticLabelsSubmission): AutoDispatchSettings {
  const num = (text: string): number | undefined => (text === '' ? undefined : Number(text));
  return {
    enabled: values.enabled,
    trigger: values.trigger,
    ...(num(values.defaultWeightGrams) !== undefined
      ? { defaultWeightGrams: Math.floor(Number(values.defaultWeightGrams)) }
      : {}),
    ...(values.parcelTemplate !== '' ? { parcelTemplate: values.parcelTemplate } : {}),
    ...(num(values.lengthMm) !== undefined &&
    num(values.widthMm) !== undefined &&
    num(values.heightMm) !== undefined
      ? {
          lengthMm: Number(values.lengthMm),
          widthMm: Number(values.widthMm),
          heightMm: Number(values.heightMm),
        }
      : {}),
  };
}
