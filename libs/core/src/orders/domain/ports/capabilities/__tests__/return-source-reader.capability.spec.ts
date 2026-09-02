/**
 * ReturnSourceReader capability guard tests (#2329)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import type { IncomingReturn, ReturnFeedOutput } from '@openlinker/core/returns';

import type { OrderSourcePort } from '../../order-source.port';
import type { ReturnSourceReader } from '../return-source-reader.capability';
import { isReturnSourceReader } from '../return-source-reader.capability';

const feedPage: ReturnFeedOutput = { items: [], nextCursor: null };

const aReturn: IncomingReturn = {
  externalReturnId: 'r-1',
  externalOrderId: null,
  rawStatus: 'CREATED',
  createdAt: '2026-08-25T00:00:00.000Z',
  lines: [],
};

describe('isReturnSourceReader', () => {
  it('should return true when both listReturnFeed and getReturn are present', () => {
    const adapter = {
      listReturnFeed: jest.fn().mockResolvedValue(feedPage),
      getReturn: jest.fn().mockResolvedValue(aReturn),
    };

    expect(isReturnSourceReader(adapter)).toBe(true);
  });

  it('should return false when only listReturnFeed is present', () => {
    expect(isReturnSourceReader({ listReturnFeed: jest.fn() })).toBe(false);
  });

  it('should return false when only getReturn is present', () => {
    expect(isReturnSourceReader({ getReturn: jest.fn() })).toBe(false);
  });

  it('should return false when the adapter is base OrderSourcePort-shaped', () => {
    const base = { listOrderFeed: jest.fn(), getOrder: jest.fn() };

    expect(isReturnSourceReader(base)).toBe(false);
  });

  it('should not throw when the adapter is an empty object', () => {
    expect(() => isReturnSourceReader({})).not.toThrow();
    expect(isReturnSourceReader({})).toBe(false);
  });

  it('should return false when the properties are present but not functions', () => {
    const shaped = { listReturnFeed: 'nope', getReturn: 42 };

    expect(() => isReturnSourceReader(shaped)).not.toThrow();
    expect(isReturnSourceReader(shaped)).toBe(false);
  });

  it('should narrow an OrderSourcePort & ReturnSourceReader double', async () => {
    const double = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      listReturnFeed: jest.fn().mockResolvedValue(feedPage),
      getReturn: jest.fn().mockResolvedValue(aReturn),
    } as unknown as OrderSourcePort;

    if (!isReturnSourceReader(double)) {
      throw new Error('expected the double to narrow');
    }

    // After the guard TypeScript knows both methods are present.
    await expect(double.listReturnFeed({ fromCursor: null, limit: 10 })).resolves.toEqual(feedPage);
    await expect(double.getReturn({ externalReturnId: 'r-1' })).resolves.toEqual(aReturn);
  });
});

describe('ReturnSourceReader contract shape (type-only assertions)', () => {
  it('should accept a literal satisfying the contract', () => {
    const reader = {
      listReturnFeed: () => Promise.resolve(feedPage),
      getReturn: () => Promise.resolve(aReturn),
    } satisfies ReturnSourceReader;

    expect(typeof reader.getReturn).toBe('function');
  });

  it('should keep the feed cursor opaque (a plain string alias)', () => {
    // Compiles only while MarketplaceCursor stays a string alias.
    const cursor: NonNullable<ReturnFeedOutput['nextCursor']> = 'opaque-token';
    const asString: string = cursor;

    expect(asString).toBe('opaque-token');
  });

  it('should keep externalOrderId nullable rather than optional', () => {
    // `null` is assignable; omitting the key entirely would not compile.
    const orphan: IncomingReturn = { ...aReturn, externalOrderId: null };
    const linked: IncomingReturn = { ...aReturn, externalOrderId: 'o-9' };

    expect(orphan.externalOrderId).toBeNull();
    expect(linked.externalOrderId).toBe('o-9');
  });
});
