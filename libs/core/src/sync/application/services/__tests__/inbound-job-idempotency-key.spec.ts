/**
 * Inbound Job Idempotency Key Unit Tests
 *
 * Pins the three-part key the lookup endpoint and the frontend rebuild, and the
 * discriminated form a fanned-out webhook's non-primary jobs carry.
 *
 * @module libs/core/src/sync/application/services
 */
import { buildInboundJobIdempotencyKey } from '../inbound-job-idempotency-key';

describe('buildInboundJobIdempotencyKey', () => {
  it('should build the unchanged three-part key when no discriminator is passed', () => {
    expect(buildInboundJobIdempotencyKey('shoper', 'conn-1', 'evt-1')).toBe('shoper:conn-1:evt-1');
  });

  it('should append the discriminator when one is passed', () => {
    expect(
      buildInboundJobIdempotencyKey(
        'shoper',
        'conn-1',
        'evt-1',
        'master.inventory.syncByExternalId'
      )
    ).toBe('shoper:conn-1:evt-1:master.inventory.syncByExternalId');
  });

  it('should treat an empty discriminator as absent when it carries no information', () => {
    expect(buildInboundJobIdempotencyKey('shoper', 'conn-1', 'evt-1', '')).toBe(
      'shoper:conn-1:evt-1'
    );
  });
});
