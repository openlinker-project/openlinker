/**
 * Observed payment methods query key (#3775)
 *
 * The query is refreshed after a connection save only because its key sits
 * under the `['connections']` prefix the update mutation invalidates. Pinning
 * that here stops a rename from silently leaving pre-save values on screen.
 *
 * @module features/connections/hooks
 */
import { describe, expect, it } from 'vitest';
import { connectionsQueryKeys } from '../api/connections.query-keys';

describe('connectionsQueryKeys.observedPaymentMethods', () => {
  it('should sit under the prefix a connection update invalidates', () => {
    const key = connectionsQueryKeys.observedPaymentMethods('conn_1');

    expect(key.slice(0, connectionsQueryKeys.all.length)).toEqual([...connectionsQueryKeys.all]);
    expect(key).toContain('conn_1');
  });
});
