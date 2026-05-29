/**
 * Label Document Reader Capability — Type-Guard Tests
 *
 * Verifies the `isLabelDocumentReader` runtime narrowing matches its
 * compile-time signature on both branches. Mirrors the sibling
 * `shipment-canceller.capability.spec.ts` shape.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities/__tests__
 */
import type { ShippingProviderManagerPort } from '../../shipping-provider-manager.port';
import {
  type LabelDocumentReader,
  isLabelDocumentReader,
} from '../label-document-reader.capability';

describe('isLabelDocumentReader', () => {
  it('should narrow to ShippingProviderManagerPort & LabelDocumentReader when the adapter implements fetchLabel', () => {
    const adapter: ShippingProviderManagerPort & LabelDocumentReader = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      fetchLabel: jest.fn(),
    };

    expect(isLabelDocumentReader(adapter)).toBe(true);

    if (isLabelDocumentReader(adapter)) {
      // Compile-time narrowing check: TS knows `fetchLabel` exists.
      expect(typeof adapter.fetchLabel).toBe('function');
    }
  });

  it('should return false when the adapter does not implement fetchLabel', () => {
    const adapter: ShippingProviderManagerPort = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
    };

    expect(isLabelDocumentReader(adapter)).toBe(false);
  });

  it('should return false when fetchLabel is present but not a function', () => {
    const adapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      fetchLabel: 'not a function',
    } as unknown as ShippingProviderManagerPort;

    expect(isLabelDocumentReader(adapter)).toBe(false);
  });
});
