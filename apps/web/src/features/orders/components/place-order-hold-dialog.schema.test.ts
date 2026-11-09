import { describe, expect, it } from 'vitest';
import { getMessages, interpolate } from '../../../shared/i18n';
import { createPlaceOrderHoldSchema, HOLD_NOTE_MAX_LENGTH } from './place-order-hold-dialog.schema';

describe('createPlaceOrderHoldSchema', () => {
  const copy = getMessages('orders').holds.validation;

  it('should report the reason message from the copy when no reason is chosen', () => {
    const result = createPlaceOrderHoldSchema(copy).safeParse({ reason: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(copy.reasonRequired);
  });

  it('should interpolate the maximum into the note message when the note is too long', () => {
    const result = createPlaceOrderHoldSchema(copy).safeParse({
      reason: undefined,
      note: 'x'.repeat(HOLD_NOTE_MAX_LENGTH + 1),
    });

    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      interpolate(copy.noteTooLong, { max: HOLD_NOTE_MAX_LENGTH })
    );
  });

  it('should use the copy it was given, so a language switch reaches the messages', () => {
    const result = createPlaceOrderHoldSchema({ ...copy, reasonRequired: 'Custom reason message' }).safeParse({
      reason: 'not-a-reason',
    });

    expect(result.error?.issues.map((issue) => issue.message)).toContain('Custom reason message');
  });
});
