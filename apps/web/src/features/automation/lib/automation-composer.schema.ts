/**
 * Composer form schema (#2365)
 *
 * The RHF resolver, plus the pure draft→wire projection.
 *
 * ## Why the amount check is LOOSER than the backend's
 *
 * `automation-condition.types.ts` narrows an amount with
 * `/^\d+(\.\d{1,2})?$/` and a currency with `/^[A-Z]{3}$/`. `apps/web` cannot
 * import core (#591), so any restatement here can drift — and the direction of
 * drift is a choice. `frontend-architecture.md` § Form State says "server-side
 * validation remains the source of truth", so this checks SHAPE only and lets
 * the server own exactness: a looser client can only ever produce a late 400
 * that `describeAutomationWriteError` attributes to the right row, whereas a
 * stricter one silently refuses input the server would have accepted, with no
 * signal anywhere. The strict source is named above so the next reader can find
 * it.
 *
 * ## The draft is flat; the wire shape is a discriminated union
 *
 * A form field array cannot hold a union cleanly — switching a condition's
 * `field` would have to destroy and rebuild the row, losing anything the
 * operator typed. So the draft carries every possible slot and
 * `toConditionInput` / `toActionInput` project just the ones that field or
 * action actually uses. That projection is the only place the wire shape is
 * built, so it cannot disagree with itself.
 *
 * @module apps/web/src/features/automation/lib
 */
import { z } from 'zod/v4';
import {
  AUTOMATION_AMOUNT_OP_VALUES,
  AUTOMATION_CONDITION_FIELD_VALUES,
  AUTOMATION_ACTION_VALUES,
} from '../api/automation.types';
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The validation messages, read from `automation.composerSchema`. */
export type AutomationComposerSchemaCopy = ResolvedCopy<Messages['automation']['composerSchema']>;

/** Shape only — see the module docblock. */
const AMOUNT_SHAPE = /^\d+(\.\d{1,2})?$/;

export function createAutomationConditionDraftSchema(copy: AutomationComposerSchemaCopy) {
  return z
  .object({
    field: z.enum(AUTOMATION_CONDITION_FIELD_VALUES),
    value: z.string(),
    op: z.enum(AUTOMATION_AMOUNT_OP_VALUES),
    amount: z.string(),
    currency: z.string(),
  })
  .check((ctx) => {
    const draft = ctx.value;
    if (draft.field === 'orderTotalGross') {
      if (!AMOUNT_SHAPE.test(draft.amount)) {
        ctx.issues.push({
          code: 'custom',
          input: draft.amount,
          path: ['amount'],
          message: copy.amountShape,
        });
      }
      if (draft.currency.trim().length !== 3) {
        ctx.issues.push({
          code: 'custom',
          input: draft.currency,
          path: ['currency'],
          message: copy.currencyShape,
        });
      }
      return;
    }
    if (draft.value.trim().length === 0) {
      ctx.issues.push({
        code: 'custom',
        input: draft.value,
        path: ['value'],
        message: copy.valueRequired,
      });
    }
  });
}

export function createAutomationActionDraftSchema(copy: AutomationComposerSchemaCopy) {
  return z
  .object({
    action: z.enum(AUTOMATION_ACTION_VALUES),
    carrierId: z.string(),
    cashOnDelivery: z.boolean(),
    recipientKind: z.enum(['buyer', 'address']),
    address: z.string(),
    subject: z.string(),
    body: z.string(),
    holdReason: z.string(),
    note: z.string(),
  })
  .check((ctx) => {
    const draft = ctx.value;
    const require = (path: string, value: string, message: string): void => {
      if (value.trim().length === 0) {
        ctx.issues.push({ code: 'custom', input: value, path: [path], message });
      }
    };

    switch (draft.action) {
      case 'dispatch-shipment':
        require('carrierId', draft.carrierId, copy.carrierRequired);
        return;
      case 'send-email':
        if (draft.recipientKind === 'address') {
          require('address', draft.address, copy.addressRequired);
        }
        // `subject` is deliberately NOT required: the narrower accepts an empty
        // string, and a subject-less email is a real (if odd) choice. `body` is
        // required because the narrower rejects an empty one.
        require('body', draft.body, copy.bodyRequired);
        return;
      case 'place-hold':
        require('holdReason', draft.holdReason, copy.holdReasonRequired);
        return;
      case 'release-hold':
        // Required, mirroring the manual release (spec §5.3b A6).
        require('note', draft.note, copy.noteRequired);
        return;
      case 'issue-sales-document':
      case 'relay-status-to-source':
        // No parameters, deliberately — see the A1 / A3 notes in the copy.
        return;
      default: {
        const exhaustive: never = draft.action;
        throw new Error(`Unhandled automation action: ${String(exhaustive)}`);
      }
    }
  });
}

/**
 * The composer's resolver schema. Built from copy, so the component creates it
 * with `useMemo(() => createAutomationComposerSchema(copy), [copy])` and the
 * messages follow the active language.
 */
export function createAutomationComposerSchema(copy: AutomationComposerSchemaCopy) {
  return z.object({
    name: z.string().trim().min(1, copy.nameRequired).max(200),
    trigger: z.string().min(1, copy.triggerRequired),
    triggerConfigValue: z.string(),
    conditions: z.array(createAutomationConditionDraftSchema(copy)),
    actions: z.array(createAutomationActionDraftSchema(copy)).min(1, copy.actionsRequired),
    isActive: z.boolean(),
    moneyAcknowledged: z.boolean(),
    effectiveFrom: z.string().min(1, copy.effectiveFromRequired),
    effectiveTo: z.string(),
  });
}

export type AutomationComposerValues = z.infer<ReturnType<typeof createAutomationComposerSchema>>;
export type AutomationConditionDraft = z.infer<
  ReturnType<typeof createAutomationConditionDraftSchema>
>;
export type AutomationActionDraft = z.infer<ReturnType<typeof createAutomationActionDraftSchema>>;

export function newConditionDraft(): AutomationConditionDraft {
  return { field: 'sourceConnection', value: '', op: 'gte', amount: '', currency: 'PLN' };
}

export function newActionDraft(): AutomationActionDraft {
  return {
    action: 'relay-status-to-source',
    carrierId: '',
    cashOnDelivery: false,
    recipientKind: 'address',
    address: '',
    subject: '',
    body: '',
    holdReason: '',
    note: '',
  };
}

/** Project one condition draft onto the wire shape the narrower accepts. */
export function toConditionInput(draft: AutomationConditionDraft): Record<string, unknown> {
  if (draft.field === 'orderTotalGross') {
    return {
      field: 'orderTotalGross',
      op: draft.op,
      amount: draft.amount.trim(),
      currency: draft.currency.trim().toUpperCase(),
    };
  }
  return { field: draft.field, op: 'eq', value: draft.value.trim() };
}

/** Project one action draft onto the wire shape the narrower accepts. */
export function toActionInput(draft: AutomationActionDraft): Record<string, unknown> {
  switch (draft.action) {
    case 'dispatch-shipment':
      return {
        action: 'dispatch-shipment',
        carrierId: draft.carrierId.trim(),
        // Null, not omitted — the narrower accepts `null` explicitly, and there
        // is no service or package-preset source anywhere in the product to
        // populate them from. See `a2NoOptions` in the copy.
        serviceId: null,
        packagePresetId: null,
        cashOnDelivery: draft.cashOnDelivery,
      };
    case 'send-email':
      return {
        action: 'send-email',
        recipient:
          draft.recipientKind === 'buyer'
            ? { kind: 'buyer' }
            : { kind: 'address', address: draft.address.trim() },
        subject: draft.subject,
        body: draft.body,
      };
    case 'place-hold':
      return { action: 'place-hold', reason: draft.holdReason, note: draft.note };
    case 'release-hold':
      return {
        action: 'release-hold',
        // Empty means "any hold" (spec §5.3b A6's default), which the narrower
        // spells as an explicit null.
        holdReason: draft.holdReason.length > 0 ? draft.holdReason : null,
        note: draft.note,
      };
    case 'issue-sales-document':
    case 'relay-status-to-source':
      return { action: draft.action };
    default: {
      const exhaustive: never = draft.action;
      throw new Error(`Unhandled automation action: ${String(exhaustive)}`);
    }
  }
}
