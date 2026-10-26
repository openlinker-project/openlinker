/**
 * `order-edit` copy and rules unit tests (#3544).
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../shared/api/api-error';
import {
  classifyOrderEditRefusal,
  describeCeilingVerdict,
  isPlainDecimal,
  keepsAnyUnit,
  lockedSectionsFor,
  ORDER_EDIT_ERROR_CODES,
  ORDER_EDIT_REFUSAL_COPY,
  orderEditErrorNeedsRefresh,
  orderEditHistoryTitle,
  readOrderEditErrorCode,
} from './order-edit';

function refusal(code: string): ApiError {
  return new ApiError('reason', 409, { statusCode: 409, error: code, message: 'reason' });
}

describe('readOrderEditErrorCode', () => {
  it('should read a known code off the error body', () => {
    expect(readOrderEditErrorCode(refusal('ORDER_PACKED'))).toBe('ORDER_PACKED');
  });

  it('should return null for an unknown code, a non-api error and a body without one', () => {
    expect(readOrderEditErrorCode(refusal('SOMETHING_NEW'))).toBeNull();
    expect(readOrderEditErrorCode(new Error('boom'))).toBeNull();
    expect(readOrderEditErrorCode(new ApiError('x', 500, null))).toBeNull();
  });
});

describe('refusal copy', () => {
  it('should carry copy for every code the backend can answer', () => {
    for (const code of ORDER_EDIT_ERROR_CODES) {
      expect(ORDER_EDIT_REFUSAL_COPY[code].title).not.toBe('');
      expect(ORDER_EDIT_REFUSAL_COPY[code].fallbackReason).not.toBe('');
    }
  });

  it('should point a packed order at Packing and an issued document at Sales document', () => {
    expect(ORDER_EDIT_REFUSAL_COPY.ORDER_PACKED.remedy).toEqual({
      target: 'packing',
      label: 'Go to Packing',
    });
    expect(ORDER_EDIT_REFUSAL_COPY.SALES_DOCUMENT_ISSUED.remedy?.target).toBe('invoicing');
    expect(ORDER_EDIT_REFUSAL_COPY.LABEL_ALREADY_BOUGHT.remedy?.target).toBe('shipment');
  });

  it('should use no em dash anywhere in the copy', () => {
    const text = JSON.stringify(ORDER_EDIT_REFUSAL_COPY);
    expect(text).not.toContain('—');
  });
});

describe('classifyOrderEditRefusal', () => {
  it.each([
    ['ORDER_PACKED', 'blocked'],
    ['LABEL_ALREADY_BOUGHT', 'blocked'],
    ['SALES_DOCUMENT_ISSUED', 'blocked'],
    ['ORDER_ALREADY_SHIPPED', 'blocked'],
    ['ORDER_WORK_ACCEPTED_NEEDS_ACK', 'needs-ack'],
    ['QUANTITY_ONLY_DECREASES', 'inline'],
    ['NOTHING_CHANGED', 'inline'],
    ['DISCOUNT_EXCEEDS_TOTAL', 'inline'],
  ] as const)('should classify %s as %s', (code, view) => {
    expect(classifyOrderEditRefusal(code)).toBe(view);
  });

  it('should treat an unrecognised refusal as an inline error', () => {
    expect(classifyOrderEditRefusal(null)).toBe('inline');
  });
});

describe('lockedSectionsFor', () => {
  it('should lock the address and delivery for a bought label, and only items for an issued document', () => {
    expect([...lockedSectionsFor('LABEL_ALREADY_BOUGHT')].sort()).toEqual(['address', 'delivery']);
    expect([...lockedSectionsFor('SALES_DOCUMENT_ISSUED')]).toEqual(['lines']);
  });

  it('should lock only the refused section when a code does not normally lock it (B-35)', () => {
    expect([...lockedSectionsFor('LABEL_ALREADY_BOUGHT', 'discount')]).toEqual(['discount']);
    expect([...lockedSectionsFor('LABEL_ALREADY_BOUGHT', 'address')].sort()).toEqual([
      'address',
      'delivery',
    ]);
  });

  it('should leave the discount editable on a shipped order', () => {
    expect(lockedSectionsFor('ORDER_ALREADY_SHIPPED').has('discount')).toBe(false);
    expect(lockedSectionsFor('DISCOUNT_BELOW_REFUNDED').has('discount')).toBe(true);
    expect([...lockedSectionsFor('LINE_PRICE_NOT_RESOLVABLE')]).toEqual(['lines']);
  });

  it('should lock every section for a packed order and none for a typing problem', () => {
    expect(lockedSectionsFor('ORDER_PACKED').size).toBe(4);
    expect(lockedSectionsFor('QUANTITY_ONLY_DECREASES').size).toBe(0);
    expect(lockedSectionsFor(null).size).toBe(0);
  });
});

describe('orderEditErrorNeedsRefresh', () => {
  it('should ask for a refetch only when the page is provably stale', () => {
    expect(orderEditErrorNeedsRefresh('ORDER_PACKED')).toBe(true);
    expect(orderEditErrorNeedsRefresh('ORDER_ALREADY_CANCELLED')).toBe(true);
    expect(orderEditErrorNeedsRefresh('QUANTITY_ONLY_DECREASES')).toBe(false);
    expect(orderEditErrorNeedsRefresh(null)).toBe(false);
  });
});

describe('mirrored input rules', () => {
  it('should accept a plain decimal and refuse anything else', () => {
    expect(isPlainDecimal('12.50')).toBe(true);
    expect(isPlainDecimal(' 0 ')).toBe(true);
    expect(isPlainDecimal('-1')).toBe(false);
    expect(isPlainDecimal('1,5')).toBe(false);
    expect(isPlainDecimal('')).toBe(false);
  });

  it('should refuse an order lowered to nothing', () => {
    expect(keepsAnyUnit([0, 0])).toBe(false);
    expect(keepsAnyUnit([0, 1])).toBe(true);
  });
});

describe('describeCeilingVerdict', () => {
  it('should state a within, an exceeded and an unknown verdict', () => {
    expect(
      describeCeilingVerdict({
        status: 'within',
        ceiling: '100.00',
        alreadyRefunded: '0',
        requested: '15.00',
        currency: 'PLN',
      }).tone,
    ).toBe('info');
    const exceeded = describeCeilingVerdict({
      status: 'exceeded',
      ceiling: '10.00',
      alreadyRefunded: '90.00',
      requested: '15.00',
      currency: 'PLN',
    });
    expect(exceeded.tone).toBe('warning');
    expect(exceeded.text).toContain('15.00 PLN requested');
    expect(describeCeilingVerdict({ status: 'unknown', reason: 'x' }).text).toMatch(/could not check/);
  });
});

describe('orderEditHistoryTitle', () => {
  it('should title each edit kind and fall back for an unknown one', () => {
    const entry = { changeId: 'c', at: 'x', byUserId: null, channelKeeps: true, channelConnectionId: 'k' };
    expect(orderEditHistoryTitle({ ...entry, kind: 'order.address_change' })).toBe(
      'Shipping address changed',
    );
    expect(orderEditHistoryTitle({ ...entry, kind: 'order.future' })).toBe('Order edited');
  });
});
