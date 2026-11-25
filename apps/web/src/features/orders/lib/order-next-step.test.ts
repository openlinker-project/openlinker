import { describe, expect, it } from 'vitest';
import { deriveOrderIssues, deriveOrderNextStep, type OrderNextStepInput } from './order-next-step';

const quiet: OrderNextStepInput = {
  cancelled: false,
  failedDestinationCount: 0,
  activeHoldLabel: null,
  documentBlocked: false,
  shipByOverdue: false,
  fulfillment: 'delivered',
  recordReady: true,
  awaitingPayment: false,
  shipmentsLoaded: true,
  canGenerateLabel: true,
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
  it('should list every problem in priority order', () => {
    const issues = deriveOrderIssues({ ...quiet, failedDestinationCount: 1, activeHoldLabel: 'Fraud check', shipByOverdue: true, fulfillment: 'not-shipped' });
    expect(issues.map((i) => i.kind)).toEqual(['failed-destinations', 'on-hold', 'ship-by-overdue', 'ready-to-ship']);
  });
  it('should not say ready to ship for an order that cannot ship yet', () => {
    const base = { ...quiet, fulfillment: 'not-shipped' as const };
    expect(deriveOrderNextStep(base)).toMatchObject({ kind: 'ready-to-ship' });
    expect(deriveOrderNextStep({ ...base, recordReady: false })).toBeNull();
    expect(deriveOrderNextStep({ ...base, awaitingPayment: true })).toBeNull();
    expect(deriveOrderNextStep({ ...base, shipmentsLoaded: false })).toBeNull();
    expect(deriveOrderNextStep({ ...base, canGenerateLabel: false })).toBeNull();
  });
  it('should name a failed shipment as such and not as ready to ship', () => {
    expect(deriveOrderNextStep({ ...quiet, fulfillment: 'failed' })).toMatchObject({
      kind: 'shipment-failed',
      tone: 'warning',
      tab: 'shipping',
    });
  });
});
