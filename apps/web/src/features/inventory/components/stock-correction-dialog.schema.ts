/**
 * Stock correction dialog form schema + copy (#3567)
 *
 * Both entry fields live in form state as strings (native inputs); only the
 * one the selected mode shows is validated. `delta` accepts a sign, including
 * the typographic minus the mockup's hint uses.
 *
 * @module apps/web/src/features/inventory/components
 */
import { z } from 'zod';
import {
  CorrectionModeValues,
  CorrectionReasonValues,
  type CorrectionReason,
  type CorrectionTargetRefusalReason,
  type CorrectStockInput,
} from '../api/inventory-correction.types';
import { parseSignedInteger } from '../lib/stock-correction-preview';

export const NOTE_MAX_LENGTH = 500;

export const stockCorrectionSchema = z
  .object({
    mode: z.enum(CorrectionModeValues),
    quantity: z.string(),
    delta: z.string(),
    reason: z.enum(CorrectionReasonValues),
    note: z.string().max(NOTE_MAX_LENGTH, `Note must be ${NOTE_MAX_LENGTH} characters or fewer`),
  })
  .superRefine((values, ctx) => {
    if (values.mode === 'set') {
      const parsed = parseSignedInteger(values.quantity);
      if (parsed === null || parsed < 0 || values.quantity.trim().startsWith('+')) {
        ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a whole number, 0 or more' });
      }
    } else {
      const parsed = parseSignedInteger(values.delta);
      if (parsed === null) {
        ctx.addIssue({ code: 'custom', path: ['delta'], message: 'Enter a whole number, e.g. +3 or -2' });
      } else if (parsed === 0) {
        ctx.addIssue({ code: 'custom', path: ['delta'], message: 'A change of 0 would not do anything' });
      }
    }
    if (values.reason === 'other' && values.note.trim().length === 0) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say what happened when the reason is Other' });
    }
  });

export type StockCorrectionFormValues = z.input<typeof stockCorrectionSchema>;

export const STOCK_CORRECTION_DEFAULT_VALUES: StockCorrectionFormValues = {
  mode: 'set',
  quantity: '',
  delta: '',
  reason: 'count_correction',
  note: '',
};

export const REASON_LABEL: Record<CorrectionReason, string> = {
  count_correction: 'Counted (physical stock check)',
  found: 'Found or received',
  damaged: 'Damaged or lost',
  other: 'Other',
};

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
export const TARGET_REFUSAL_COPY: Record<CorrectionTargetRefusalReason, { title: string; body: string }> = {
  'no-inventory-master': {
    title: 'No connection owns this stock',
    body: 'No connection is set up as the stock master for this product, so there is nowhere to write the change.',
  },
  'ambiguous-inventory-master': {
    title: 'More than one connection claims this stock',
    body: 'Two connections claim this stock, so OpenLinker will not guess which one to change.',
  },
  'no-position': {
    title: 'The master has not reported this variant yet',
    body: 'There is no stock row for this variant to change. Wait for the next stock sync, then try again.',
  },
  'unattributed-owner': {
    title: 'OpenLinker cannot tell who owns this stock row',
    body: 'This stock row predates ownership tracking. It will be attributed by the next stock sync, after which you can correct it.',
  },
  'adapter-unresolved': {
    title: "OpenLinker can't reach the master connection",
    body: 'The connection that owns this stock may be disabled or need re-authorisation. Check it on the Connections page.',
  },
};

export function isTargetRefusalCode(code: unknown): code is CorrectionTargetRefusalReason {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(TARGET_REFUSAL_COPY, code);
}

/** Inline messages for 409s that keep the form open. */
export const INLINE_ERROR_COPY: Record<string, string> = {
  contended: 'Another correction for this variant is being applied right now. Wait a moment and save again.',
  'no-change': 'This would not change the stock - the master already has that number.',
  'master-unreadable':
    "Couldn't read the current stock for this item from {master}. Nothing changed. Try again in a moment.",
  'insufficient-stock': 'There is not enough stock in the master for this removal. Nothing changed.',
  'idempotency-key-reused':
    'This correction was already submitted with different values. Close this dialog and start a new one.',
};
