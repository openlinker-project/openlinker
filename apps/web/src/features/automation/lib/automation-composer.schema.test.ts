/**
 * Composer schema tests (#2365)
 */
import { describe, expect, it } from 'vitest';
import {
  automationActionDraftSchema,
  automationConditionDraftSchema,
  newActionDraft,
  newConditionDraft,
  toActionInput,
  toConditionInput,
} from './automation-composer.schema';

describe('automationConditionDraftSchema', () => {
  it('should require a value for a non-amount condition', () => {
    const result = automationConditionDraftSchema.safeParse({
      ...newConditionDraft(),
      field: 'orderCountry',
      value: '',
    });
    expect(result.success).toBe(false);
  });

  it('should accept a two-decimal amount', () => {
    const result = automationConditionDraftSchema.safeParse({
      ...newConditionDraft(),
      field: 'orderTotalGross',
      amount: '2000.50',
      currency: 'PLN',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an amount with three decimals', () => {
    const result = automationConditionDraftSchema.safeParse({
      ...newConditionDraft(),
      field: 'orderTotalGross',
      amount: '1.234',
      currency: 'PLN',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a negative amount', () => {
    const result = automationConditionDraftSchema.safeParse({
      ...newConditionDraft(),
      field: 'orderTotalGross',
      amount: '-1',
      currency: 'PLN',
    });
    expect(result.success).toBe(false);
  });

  it('should not require a value when the amount branch applies', () => {
    // The draft carries every slot so switching `field` keeps what was typed;
    // only the slots the selected field uses are validated.
    const result = automationConditionDraftSchema.safeParse({
      ...newConditionDraft(),
      field: 'orderTotalGross',
      value: '',
      amount: '10',
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });
});

describe('toConditionInput', () => {
  it('should emit an inline amount and currency, never a thresholdRef', () => {
    // The declared §5.5 divergence-2 shape.
    const wire = toConditionInput({
      ...newConditionDraft(),
      field: 'orderTotalGross',
      op: 'lt',
      amount: ' 250 ',
      currency: 'pln',
    });

    expect(wire).toEqual({
      field: 'orderTotalGross',
      op: 'lt',
      amount: '250',
      currency: 'PLN',
    });
    expect(wire).not.toHaveProperty('thresholdRef');
  });

  it('should emit an eq comparison for the closed-vocabulary fields', () => {
    expect(toConditionInput({ ...newConditionDraft(), field: 'orderCountry', value: 'PL' })).toEqual(
      { field: 'orderCountry', op: 'eq', value: 'PL' },
    );
  });
});

describe('automationActionDraftSchema', () => {
  it('should require a carrier for a dispatch step', () => {
    const result = automationActionDraftSchema.safeParse({
      ...newActionDraft(),
      action: 'dispatch-shipment',
    });
    expect(result.success).toBe(false);
  });

  it('should require a note when lifting a hold, mirroring the manual release', () => {
    const result = automationActionDraftSchema.safeParse({
      ...newActionDraft(),
      action: 'release-hold',
      note: '',
    });
    expect(result.success).toBe(false);
  });

  it('should require a body but not a subject for an email', () => {
    // The narrower accepts an empty subject and rejects an empty body.
    expect(
      automationActionDraftSchema.safeParse({
        ...newActionDraft(),
        action: 'send-email',
        recipientKind: 'buyer',
        subject: '',
        body: 'Your order is on its way.',
      }).success,
    ).toBe(true);
    expect(
      automationActionDraftSchema.safeParse({
        ...newActionDraft(),
        action: 'send-email',
        recipientKind: 'buyer',
        body: '',
      }).success,
    ).toBe(false);
  });

  it('should accept the two parameterless actions with nothing filled in', () => {
    for (const action of ['issue-sales-document', 'relay-status-to-source'] as const) {
      expect(automationActionDraftSchema.safeParse({ ...newActionDraft(), action }).success).toBe(
        true,
      );
    }
  });
});

describe('toActionInput', () => {
  it('should send explicit nulls for the sources that do not exist yet', () => {
    // The narrower accepts null; an omitted key would fail it.
    expect(
      toActionInput({ ...newActionDraft(), action: 'dispatch-shipment', carrierId: 'conn-1' }),
    ).toEqual({
      action: 'dispatch-shipment',
      carrierId: 'conn-1',
      serviceId: null,
      packagePresetId: null,
      cashOnDelivery: false,
    });
  });

  it('should map an empty release reason to "any hold"', () => {
    expect(
      toActionInput({ ...newActionDraft(), action: 'release-hold', holdReason: '', note: 'ok' }),
    ).toEqual({ action: 'release-hold', holdReason: null, note: 'ok' });
  });

  it('should emit the buyer recipient without an address', () => {
    expect(
      toActionInput({
        ...newActionDraft(),
        action: 'send-email',
        recipientKind: 'buyer',
        body: 'hi',
      }),
    ).toEqual({ action: 'send-email', recipient: { kind: 'buyer' }, subject: '', body: 'hi' });
  });

  it('should emit no parameters for A1 and A3', () => {
    expect(toActionInput({ ...newActionDraft(), action: 'issue-sales-document' })).toEqual({
      action: 'issue-sales-document',
    });
  });
});
