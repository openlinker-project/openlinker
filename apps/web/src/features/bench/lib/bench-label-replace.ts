/**
 * Change-size form to wire body (#3655)
 *
 * The one place cm and kg become mm and grams. The form works in the units a
 * packer measures in; the wire (#3654) is integer mm and grams, and rounding
 * here means the server never sees a fractional value.
 *
 * @module apps/web/src/features/bench/lib
 */
import type { BenchLabelReplaceInput } from '../api/bench-parcel.types';

export type ChangeSizeMode = 'template' | 'box' | 'weight';

export interface ChangeSizeFormValues {
  readonly mode: ChangeSizeMode;
  readonly template: string;
  readonly lengthCm: string;
  readonly widthCm: string;
  readonly heightCm: string;
  readonly weightKg: string;
}

/**
 * Sane maxima. Must stay at or below the API's `REPLACE_LABEL_MAX_DIMENSION_MM`
 * / `REPLACE_LABEL_MAX_WEIGHT_GRAMS` once converted (`cmToMm`, `kgToGrams`):
 * the browser cannot import that DTO (#591) and the server is the gate.
 */
export const MAX_SIDE_CM = 300;
export const MAX_WEIGHT_KG = 100;

export const cmToMm = (cm: number): number => Math.round(cm * 10);
export const kgToGrams = (kg: number): number => Math.round(kg * 1000);

const num = (value: string): number => Number(value.replace(',', '.'));

export function toReplaceInput(values: ChangeSizeFormValues): BenchLabelReplaceInput {
  if (values.mode === 'template') return { template: values.template };
  if (values.mode === 'weight') return { weightGrams: kgToGrams(num(values.weightKg)) };
  return {
    lengthMm: cmToMm(num(values.lengthCm)),
    widthMm: cmToMm(num(values.widthCm)),
    heightMm: cmToMm(num(values.heightCm)),
    weightGrams: kgToGrams(num(values.weightKg)),
  };
}
