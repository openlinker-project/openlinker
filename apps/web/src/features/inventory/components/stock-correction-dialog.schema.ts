/**
 * Stock correction dialog form schema (#3567)
 *
 * Both entry fields live in form state as strings (native inputs); only the
 * one the selected mode shows is validated. `delta` accepts a sign, including
 * the typographic minus the mockup's hint uses.
 *
 * @module apps/web/src/features/inventory/components
 */
import { z } from 'zod';
import { interpolate } from '../../../shared/i18n';
import type { getMessages } from '../../../shared/i18n';
import {
  CorrectionModeValues,
  CorrectionReasonValues,
  type CorrectionReason,
  type CorrectionTargetRefusalReason,
  type CorrectStockInput,
} from '../api/inventory-correction.types';
import { parseSignedInteger } from '../lib/stock-correction-preview';

export const NOTE_MAX_LENGTH = 500;

type InventoryCopy = ReturnType<typeof getMessages<'inventory'>>;
export type StockCorrectionCopy = InventoryCopy['stockCorrectionDialog'];

export function createStockCorrectionSchema(copy: StockCorrectionCopy) {
  return z
    .object({
      mode: z.enum(CorrectionModeValues),
      quantity: z.string(),
      delta: z.string(),
      reason: z.enum(CorrectionReasonValues),
      note: z.string().max(NOTE_MAX_LENGTH, interpolate(copy.errors.noteTooLong, { max: NOTE_MAX_LENGTH })),
    })
    .superRefine((values, ctx) => {
      if (values.mode === 'set') {
        const parsed = parseSignedInteger(values.quantity);
        if (parsed === null || parsed < 0 || values.quantity.trim().startsWith('+')) {
          ctx.addIssue({ code: 'custom', path: ['quantity'], message: copy.errors.quantityInvalid });
        }
      } else {
        const parsed = parseSignedInteger(values.delta);
        if (parsed === null) {
          ctx.addIssue({ code: 'custom', path: ['delta'], message: copy.errors.deltaInvalid });
        } else if (parsed === 0) {
          ctx.addIssue({ code: 'custom', path: ['delta'], message: copy.errors.deltaZero });
        }
      }
      if (values.reason === 'other' && values.note.trim().length === 0) {
        ctx.addIssue({ code: 'custom', path: ['note'], message: copy.errors.noteRequired });
      }
    });
}

export type StockCorrectionFormValues = z.input<ReturnType<typeof createStockCorrectionSchema>>;

export const STOCK_CORRECTION_DEFAULT_VALUES: StockCorrectionFormValues = {
  mode: 'set',
  quantity: '',
  delta: '',
  reason: 'count_correction',
  note: '',
};

const REASON_KEY: Record<CorrectionReason, keyof StockCorrectionCopy['reasons']> = {
  count_correction: 'countCorrection',
  found: 'found',
  damaged: 'damaged',
  other: 'other',
};

export function reasonLabel(copy: StockCorrectionCopy, reason: CorrectionReason): string {
  return copy.reasons[REASON_KEY[reason]];
}

/** The number the entry means: the new stock in `set` mode, the signed change in `delta` mode. */
export function readEntry(values: StockCorrectionFormValues): number | null {
  return parseSignedInteger(values.mode === 'set' ? values.quantity : values.delta);
}

export function toCorrectStockInput(
  values: StockCorrectionFormValues,
  entry: number,
  idempotencyKey: string,
  confirmLargeChange: boolean,
): CorrectStockInput {
  const note = values.note.trim();
  return {
    mode: values.mode,
    quantity: entry,
    operatorReason: values.reason,
    ...(note.length > 0 ? { note } : {}),
    idempotencyKey,
    ...(confirmLargeChange ? { confirmLargeChange: true } : {}),
  };
}

/** Why a correction cannot be made at all, in the operator's words (D41). */
const TARGET_REFUSAL_KEY: Record<CorrectionTargetRefusalReason, keyof StockCorrectionCopy['targetRefusals']> = {
  'no-inventory-master': 'noInventoryMaster',
  'ambiguous-inventory-master': 'ambiguousInventoryMaster',
  'no-position': 'noPosition',
  'unattributed-owner': 'unattributedOwner',
  'adapter-unresolved': 'adapterUnresolved',
};

export function targetRefusalCopy(
  copy: StockCorrectionCopy,
  reason: CorrectionTargetRefusalReason,
): { title: string; body: string } {
  return copy.targetRefusals[TARGET_REFUSAL_KEY[reason]];
}

export function isTargetRefusalCode(code: unknown): code is CorrectionTargetRefusalReason {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(TARGET_REFUSAL_KEY, code);
}

/** Inline messages for 409s that keep the form open; `null` for a code with no copy of its own. */
const INLINE_ERROR_KEY: Record<string, keyof StockCorrectionCopy['inlineErrors']> = {
  contended: 'contended',
  'no-change': 'noChange',
  'master-unreadable': 'masterUnreadable',
  'idempotency-key-reused': 'idempotencyKeyReused',
};

export function inlineErrorText(copy: StockCorrectionCopy, code: string | null, master: string): string | null {
  if (code === null || !Object.prototype.hasOwnProperty.call(INLINE_ERROR_KEY, code)) return null;
  return interpolate(copy.inlineErrors[INLINE_ERROR_KEY[code]], { master });
}
