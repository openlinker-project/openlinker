/**
 * DispatchProtocolReader type-guard unit tests (#964).
 */

import { isDispatchProtocolReader } from './dispatch-protocol-reader.capability';
import type { DispatchProtocolReader } from './dispatch-protocol-reader.capability';
import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';

const base: ShippingProviderManagerPort = {
  generateLabel: jest.fn(),
  getTracking: jest.fn(),
  getSupportedMethods: jest.fn(),
};

describe('isDispatchProtocolReader', () => {
  it('should return true when the adapter implements generateProtocol', () => {
    const adapter: ShippingProviderManagerPort & DispatchProtocolReader = {
      ...base,
      generateProtocol: jest.fn(),
    };
    expect(isDispatchProtocolReader(adapter)).toBe(true);
  });

  it('should return false when the adapter does not implement generateProtocol', () => {
    expect(isDispatchProtocolReader(base)).toBe(false);
  });
});
