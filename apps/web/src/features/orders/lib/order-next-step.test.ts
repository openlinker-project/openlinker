import { describe, expect, it } from 'vitest';
import { deriveOrderNextStep, type OrderNextStepInput } from './order-next-step';

const quiet: OrderNextStepInput = {
  cancelled: false,
  failedDestinationCount: 0,
  activeHoldLabel: null,
  documentBlocked: false,
  shipByOverdue: false,
  fulfillment: 'delivered',
};

describe('deriveOrderNextStep', () => {
  it('should return null when nothing needs the operator', () => {
    expect(deriveOrderNextStep(quiet)).toBeNull();
  });
  it('should put failed destinations before everything else', () => {
    const step = deriveOrderNextStep({ ...quiet, failedDestinationCount: 2, activeHoldLabel: 'Fraud check', fulfillment: 'not-shipped' });
    expect(step).toMatchObject({ kind: 'failed-destinations', tone: 'error', tab: 'technical', value: 2 });
  });
  it('should point a hold at the Packing tab with its reason', () => {
    expect(deriveOrderNextStep({ ...quiet, activeHoldLabel: 'Fraud check' })).toMatchObject({ kind: 'on-hold', tab: 'packing', value: 'Fraud check' });
  });
  it('should treat an overdue ship-by as an error only while nothing shipped', () => {
    expect(deriveOrderNextStep({ ...quiet, shipByOverdue: true, fulfillment: 'not-shipped' })).toMatchObject({ kind: 'ship-by-overdue', tone: 'error' });
    expect(deriveOrderNextStep({ ...quiet, shipByOverdue: true, fulfillment: 'dispatched' })).toBeNull();
  });
  it('should not prompt to ship a cancelled order', () => {
    expect(deriveOrderNextStep({ ...quiet, cancelled: true, fulfillment: 'not-shipped' })).toBeNull();
  });
  it('should not prompt when shipping is not available on any connection', () => {
    expect(deriveOrderNextStep({ ...quiet, fulfillment: 'unavailable' })).toBeNull();
  });
});
