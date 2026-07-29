/**
 * Shipment dispatch lock helper unit tests (#1917).
 *
 * The TTL is resolved once at module load (same shape as
 * `ORDER_CREATE_LOCK_TTL_MS`), so each env case re-imports the module inside
 * `jest.isolateModules` rather than expecting a re-read at call time.
 */

import type * as LockModule from './shipment-dispatch-lock';
import { shipmentDispatchLockKey } from './shipment-dispatch-lock';

/** Load the module fresh with `OL_SHIPMENT_DISPATCH_LOCK_TTL_MS` set to `raw`. */
function ttlWithEnv(raw: string | undefined): number {
  const previous = process.env.OL_SHIPMENT_DISPATCH_LOCK_TTL_MS;
  if (raw === undefined) {
    delete process.env.OL_SHIPMENT_DISPATCH_LOCK_TTL_MS;
  } else {
    process.env.OL_SHIPMENT_DISPATCH_LOCK_TTL_MS = raw;
  }

  let ttl = Number.NaN;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- isolateModules needs a sync require
    ttl = (require('./shipment-dispatch-lock') as typeof LockModule).SHIPMENT_DISPATCH_LOCK_TTL_MS;
  });

  if (previous === undefined) {
    delete process.env.OL_SHIPMENT_DISPATCH_LOCK_TTL_MS;
  } else {
    process.env.OL_SHIPMENT_DISPATCH_LOCK_TTL_MS = previous;
  }
  return ttl;
}

describe('shipmentDispatchLockKey', () => {
  it('should key on the order alone, not the connection', () => {
    // Two operators picking DIFFERENT carrier connections for one order is
    // exactly as wrong as picking the same one, so the key must not include
    // the connection id.
    expect(shipmentDispatchLockKey('ol_order_9f3c')).toBe('shipment:dispatch:ol_order_9f3c');
  });

  it('should produce distinct keys for distinct orders', () => {
    expect(shipmentDispatchLockKey('ol_order_a')).not.toBe(shipmentDispatchLockKey('ol_order_b'));
  });
});

describe('SHIPMENT_DISPATCH_LOCK_TTL_MS', () => {
  it('should default to 120s when the env var is unset', () => {
    expect(ttlWithEnv(undefined)).toBe(120_000);
  });

  it('should default to 120s when the env var is empty', () => {
    expect(ttlWithEnv('')).toBe(120_000);
  });

  it('should default to 120s when the env var is not a number', () => {
    expect(ttlWithEnv('soon')).toBe(120_000);
  });

  it('should honour an in-range override', () => {
    expect(ttlWithEnv('45000')).toBe(45_000);
  });

  it('should clamp an under-range override up to 10s', () => {
    expect(ttlWithEnv('500')).toBe(10_000);
  });

  it('should clamp an over-range override down to 600s', () => {
    expect(ttlWithEnv('9999999')).toBe(600_000);
  });
});
