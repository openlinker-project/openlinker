import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../shared/api/api-error';
import {
  classifyOrderCancelError,
  hasAcceptedFulfilmentWork,
  isOrderCancelTerminal,
  orderCancelErrorNeedsRefresh,
  readOrderCancelErrorCode,
} from './order-cancel';

function conflict(code: string): ApiError {
  return new ApiError('reason', 409, { statusCode: 409, error: code, message: 'reason' });
}

describe('order cancel rules (#3541)', () => {
  describe('isOrderCancelTerminal', () => {
    const open = { snapshotStatus: 'processing', lifecyclePhase: 'ready', fulfillmentState: 'not-shipped' };

    it('should treat an open order as cancellable', () => {
      expect(isOrderCancelTerminal(open)).toBe(false);
    });

    it.each(['cancelled', 'delivered', 'refunded'])('should be terminal for status %s', (status) => {
      expect(isOrderCancelTerminal({ ...open, snapshotStatus: status })).toBe(true);
    });

    it.each(['cancelled', 'delivered'])('should be terminal for phase %s', (phase) => {
      expect(isOrderCancelTerminal({ ...open, lifecyclePhase: phase })).toBe(true);
    });

    it('should NOT treat a dispatched order as terminal, so its refusal can point to returns', () => {
      expect(
        isOrderCancelTerminal({ ...open, lifecyclePhase: 'in_transit', fulfillmentState: 'dispatched' }),
      ).toBe(false);
    });

    it('should treat unknown fields as not terminal', () => {
      expect(
        isOrderCancelTerminal({ snapshotStatus: undefined, lifecyclePhase: undefined, fulfillmentState: undefined }),
      ).toBe(false);
    });
  });

  describe('hasAcceptedFulfilmentWork', () => {
    it('should detect work a holder accepted or started', () => {
      expect(hasAcceptedFulfilmentWork([{ status: 'open', requestStatus: 'accepted' }])).toBe(true);
      expect(hasAcceptedFulfilmentWork([{ status: 'in_progress', requestStatus: 'unsubmitted' }])).toBe(true);
    });

    it('should ignore work that is unsubmitted or already finished', () => {
      expect(hasAcceptedFulfilmentWork([{ status: 'open', requestStatus: 'unsubmitted' }])).toBe(false);
      expect(hasAcceptedFulfilmentWork([{ status: 'closed', requestStatus: 'accepted' }])).toBe(false);
      expect(hasAcceptedFulfilmentWork([{ status: 'cancelled', requestStatus: 'accepted' }])).toBe(false);
      expect(hasAcceptedFulfilmentWork([])).toBe(false);
    });
  });

  describe('error codes', () => {
    it('should read the machine code off the error body, never the message', () => {
      expect(readOrderCancelErrorCode(conflict('LABEL_NOT_VOIDABLE'))).toBe('LABEL_NOT_VOIDABLE');
      expect(readOrderCancelErrorCode(conflict('SOMETHING_NEW'))).toBeNull();
      expect(readOrderCancelErrorCode(new Error('LABEL_NOT_VOIDABLE'))).toBeNull();
    });

    it('should choose a layout per code', () => {
      expect(classifyOrderCancelError(conflict('LABEL_NOT_VOIDABLE'))).toBe('label');
      expect(classifyOrderCancelError(conflict('ORDER_ALREADY_SHIPPED'))).toBe('shipped');
      expect(classifyOrderCancelError(conflict('ORDER_WORK_ACCEPTED_NEEDS_ACK'))).toBe('needs-ack');
      expect(classifyOrderCancelError(conflict('ORDER_HAS_FISCAL_RECEIPT'))).toBe('inline');
      expect(classifyOrderCancelError(new Error('boom'))).toBe('inline');
    });

    it('should refresh only for refusals that prove the page is stale', () => {
      expect(orderCancelErrorNeedsRefresh(conflict('ORDER_ALREADY_CANCELLED'))).toBe(true);
      expect(orderCancelErrorNeedsRefresh(conflict('ORDER_CANCEL_CONTENDED'))).toBe(false);
      expect(orderCancelErrorNeedsRefresh(conflict('LABEL_NOT_VOIDABLE'))).toBe(false);
    });
  });
});
