/**
 * ConnectionRateLimit structural parity (#1810 review follow-up)
 *
 * `ConnectionRateLimit` is deliberately duplicated (not imported) between
 * this package and `@openlinker/shared/rate-limit` — `shared` must stay
 * free of any CORE dependency. Nothing else enforces the two shapes stay
 * structurally identical: a field added to one and not the other would be
 * silently dropped at the `HttpTransportFactoryPort.for()` boundary rather
 * than surfaced. This test cross-assigns both directions so a drift fails
 * `pnpm type-check` instead.
 *
 * @module domain/types
 */
import type { ConnectionRateLimit as CoreConnectionRateLimit } from '../connection.types';
import type { ConnectionRateLimit as SharedConnectionRateLimit } from '@openlinker/shared/rate-limit';

describe('ConnectionRateLimit structural parity', () => {
  it('stays structurally assignable in both directions between core and shared', () => {
    const fromCore: CoreConnectionRateLimit = { requestsPerMinute: 60, maxConcurrent: 4 };
    const fromShared: SharedConnectionRateLimit = { requestsPerMinute: 60, maxConcurrent: 4 };

    const coreToShared: SharedConnectionRateLimit = fromCore;
    const sharedToCore: CoreConnectionRateLimit = fromShared;

    expect(coreToShared).toEqual(sharedToCore);
  });
});
