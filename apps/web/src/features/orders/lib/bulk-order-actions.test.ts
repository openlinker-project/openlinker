import { describe, expect, it } from 'vitest';

import { getMessages } from '../../../shared/i18n';
import {
  BULK_ORDER_ACTION_MAX,
  bulkCancelRow,
  bulkSelectionBlockReason,
  describeCancelWarning,
} from './bulk-order-actions';

const copy = getMessages('orders').bulkActions;

describe('describeCancelWarning', () => {
  it('should name the channel that cannot be told when the warning is participant-not-informed (B-13)', () => {
    const text = describeCancelWarning(
      'participant-not-informed:c1',
      (id) => (id === 'c1' ? 'Shoper shop' : undefined),
      copy,
    );

    expect(text).toContain('Shoper shop');
    expect(text).toContain('cannot be told');
  });

  it('should fall back to "one channel" when the connection name is unknown', () => {
    expect(describeCancelWarning('stock-restored-only:gone', () => undefined, copy)).toBe(
      'Stock was restored on one channel only.',
    );
  });

  it('should quote the reason a credit note could not be drafted', () => {
    expect(describeCancelWarning('correction-unavailable:no-invoice', () => undefined, copy)).toBe(
      'No credit note could be drafted (no-invoice).',
    );
    expect(describeCancelWarning('correction-unavailable:', () => undefined, copy)).toBe(
      'No credit note could be drafted.',
    );
  });

  it('should pass an unrecognised code through unchanged', () => {
    expect(describeCancelWarning('something-new', () => undefined, copy)).toBe('something-new');
  });
});

describe('bulkSelectionBlockReason', () => {
  it('should block a selection over the cap and name the cap', () => {
    expect(bulkSelectionBlockReason(BULK_ORDER_ACTION_MAX + 1, copy)).toBe(
      `Select at most ${String(BULK_ORDER_ACTION_MAX)} orders for this action.`,
    );
    expect(bulkSelectionBlockReason(BULK_ORDER_ACTION_MAX, copy)).toBeNull();
  });
});

describe('bulkCancelRow', () => {
  it('should pair each outcome with its label and tone', () => {
    expect(bulkCancelRow('pending', copy)).toEqual({ tone: 'warning', label: 'Waiting for the channel' });
    expect(bulkCancelRow('refused', copy)).toEqual({ tone: 'error', label: 'Refused' });
  });
});
