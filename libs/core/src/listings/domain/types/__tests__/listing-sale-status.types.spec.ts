/**
 * Listing Sale State Rule Tests (#3962)
 *
 * Pins every branch of `deriveListingSaleState`, the one rule that turns a
 * listing's channel status, reported quantity and sale hold into on sale /
 * off sale / unknown.
 *
 * @module libs/core/src/listings/domain/types/__tests__
 */
import { deriveListingSaleState } from '../listing-sale-status.types';
import type { ListingSaleStateInput } from '../listing-sale-status.types';

const input = (overrides: Partial<ListingSaleStateInput> = {}): ListingSaleStateInput => ({
  channelStatus: null,
  quantity: null,
  hold: null,
  ...overrides,
});

describe('deriveListingSaleState', () => {
  it('should be off_sale when an active hold was applied, even if the channel still reads active', () => {
    expect(
      deriveListingSaleState(
        input({ channelStatus: 'active', quantity: 5, hold: { outcome: 'applied', active: true } })
      )
    ).toBe('off_sale');
  });

  it.each(['inactive', 'inactivating', 'ended', 'draft', 'unpublished', 'removed'])(
    'should be off_sale when the channel status is %s',
    (channelStatus) => {
      expect(deriveListingSaleState(input({ channelStatus, quantity: 3 }))).toBe('off_sale');
    }
  );

  it('should be off_sale when the channel reports quantity 0', () => {
    expect(deriveListingSaleState(input({ channelStatus: 'active', quantity: 0 }))).toBe(
      'off_sale'
    );
  });

  it('should be off_sale when an active hold failed but the channel status is off sale', () => {
    expect(
      deriveListingSaleState(
        input({ channelStatus: 'draft', hold: { outcome: 'failed', active: true } })
      )
    ).toBe('off_sale');
  });

  it('should be on_sale when an active hold did not stop the sale and nothing reads off sale', () => {
    expect(
      deriveListingSaleState(input({ hold: { outcome: 'not_possible', active: true } }))
    ).toBe('on_sale');
    expect(deriveListingSaleState(input({ hold: { outcome: 'failed', active: true } }))).toBe(
      'on_sale'
    );
  });

  it('should be on_sale when the channel reports an on-sale status', () => {
    expect(deriveListingSaleState(input({ channelStatus: 'active' }))).toBe('on_sale');
    expect(deriveListingSaleState(input({ channelStatus: 'published' }))).toBe('on_sale');
  });

  it('should be on_sale when there is no status but a positive quantity', () => {
    expect(deriveListingSaleState(input({ quantity: 4 }))).toBe('on_sale');
  });

  it('should ignore a released applied hold when the listing reads on sale again', () => {
    expect(
      deriveListingSaleState(
        input({ channelStatus: 'active', quantity: 2, hold: { outcome: 'applied', active: false } })
      )
    ).toBe('on_sale');
  });

  it('should be unknown when there is no status, no quantity and no active hold', () => {
    expect(deriveListingSaleState(input())).toBe('unknown');
    expect(
      deriveListingSaleState(input({ hold: { outcome: 'applied', active: false } }))
    ).toBe('unknown');
  });

  it('should be unknown when there is no status and a negative quantity', () => {
    expect(deriveListingSaleState(input({ quantity: -1 }))).toBe('unknown');
  });
});
