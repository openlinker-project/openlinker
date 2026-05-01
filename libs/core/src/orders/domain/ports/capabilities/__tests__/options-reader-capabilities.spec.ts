/**
 * Order Source / Order Processor Manager — options-reader capability guards spec (#472)
 *
 * Both `DestinationOptionsReader` and `SourceOptionsReader` declare three
 * methods. The guard must return true only when **all three** are present as
 * functions; missing or non-callable slots fail the guard.
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */

import type { OrderProcessorManagerPort } from '../../order-processor-manager.port';
import type { OrderSourcePort } from '../../order-source.port';
import { isDestinationOptionsReader } from '../destination-options-reader.capability';
import { isSourceOptionsReader } from '../source-options-reader.capability';

const DESTINATION_METHODS = ['listCarriers', 'listOrderStatuses', 'listPaymentMethods'] as const;
const SOURCE_METHODS = ['listOrderStatuses', 'listDeliveryMethods', 'listPaymentMethods'] as const;

function makeProcessorAdapter(extra: Record<string, unknown> = {}): OrderProcessorManagerPort {
  return { createOrder: jest.fn(), ...extra } as unknown as OrderProcessorManagerPort;
}

function makeSourceAdapter(extra: Record<string, unknown> = {}): OrderSourcePort {
  return {
    listOrderFeed: jest.fn(),
    getOrder: jest.fn(),
    ...extra,
  } as unknown as OrderSourcePort;
}

describe('isDestinationOptionsReader', () => {
  it('returns true when all three methods are functions', () => {
    const adapter = makeProcessorAdapter({
      listCarriers: jest.fn(),
      listOrderStatuses: jest.fn(),
      listPaymentMethods: jest.fn(),
    });
    expect(isDestinationOptionsReader(adapter)).toBe(true);
  });

  it.each(DESTINATION_METHODS)('returns false when %s is absent', (missing) => {
    const methods: Record<string, unknown> = {
      listCarriers: jest.fn(),
      listOrderStatuses: jest.fn(),
      listPaymentMethods: jest.fn(),
    };
    delete methods[missing];
    expect(isDestinationOptionsReader(makeProcessorAdapter(methods))).toBe(false);
  });

  it('returns false when one method is present but not callable', () => {
    const adapter = makeProcessorAdapter({
      listCarriers: jest.fn(),
      listOrderStatuses: 'not-a-function',
      listPaymentMethods: jest.fn(),
    });
    expect(isDestinationOptionsReader(adapter)).toBe(false);
  });

  it('returns false on a bare adapter implementing only the base port', () => {
    expect(isDestinationOptionsReader(makeProcessorAdapter())).toBe(false);
  });
});

describe('isSourceOptionsReader', () => {
  it('returns true when all three methods are functions', () => {
    const adapter = makeSourceAdapter({
      listOrderStatuses: jest.fn(),
      listDeliveryMethods: jest.fn(),
      listPaymentMethods: jest.fn(),
    });
    expect(isSourceOptionsReader(adapter)).toBe(true);
  });

  it.each(SOURCE_METHODS)('returns false when %s is absent', (missing) => {
    const methods: Record<string, unknown> = {
      listOrderStatuses: jest.fn(),
      listDeliveryMethods: jest.fn(),
      listPaymentMethods: jest.fn(),
    };
    delete methods[missing];
    expect(isSourceOptionsReader(makeSourceAdapter(methods))).toBe(false);
  });

  it('returns false on a bare adapter implementing only the base port', () => {
    expect(isSourceOptionsReader(makeSourceAdapter())).toBe(false);
  });
});
