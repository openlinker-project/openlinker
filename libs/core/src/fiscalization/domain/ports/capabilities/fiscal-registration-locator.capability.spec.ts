/**
 * Fiscal Registration Locator Capability - unit tests
 *
 * Pins the ADR-002 narrowing contract: a provider that cannot be queried by
 * business coordinates must be recognisable WITHOUT calling it, because the
 * alternative path for an indeterminate outcome is a resend, and a resend of a
 * registration that already landed is the failure this whole contract prevents.
 *
 * @module libs/core/src/fiscalization/domain/ports/capabilities
 */
import { isFiscalRegistrationLocator } from './fiscal-registration-locator.capability';
import type { FiscalRegistrationLocator } from './fiscal-registration-locator.capability';
import type { FiscalizationPort } from '../fiscalization.port';

const baseOnly: FiscalizationPort = {
  registerTransaction: jest.fn(),
};

const withLocator: FiscalizationPort & FiscalRegistrationLocator = {
  registerTransaction: jest.fn(),
  locateByQuery: jest.fn(),
};

describe('isFiscalRegistrationLocator', () => {
  it('should narrow an adapter that implements the lookup', () => {
    expect(isFiscalRegistrationLocator(withLocator)).toBe(true);
  });

  it('should reject a base-port-only adapter', () => {
    expect(isFiscalRegistrationLocator(baseOnly)).toBe(false);
  });

  it('should reject a non-callable property of the same name', () => {
    // Structural guards are duck-typed, so a data property would otherwise pass
    // the narrowing and then throw at the call site.
    const impostor = {
      registerTransaction: jest.fn(),
      locateByQuery: 'yes',
    } as unknown as FiscalizationPort;
    expect(isFiscalRegistrationLocator(impostor)).toBe(false);
  });
});
