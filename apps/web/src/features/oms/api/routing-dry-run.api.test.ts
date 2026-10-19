/**
 * Routing dry-run api client (#2954)
 *
 * The load-bearing cases are the URL and the verb: every consumer mocks the
 * client, so a path that drifts onto the rules CRUD routes, or past an
 * unencoded connection id, breaks nothing elsewhere.
 */
import { describe, expect, it, vi } from 'vitest';

import { createRoutingDryRunApi } from './routing-dry-run.api';

const evaluation = { candidates: [], unfulfillable: [], explanation: [] };
const payload = {
  input: {
    lines: [],
    shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: null, city: null },
    requestedDeliveryMethod: null,
  },
  saved: evaluation,
};

describe('routing dry-run api', () => {
  it('should POST to the dry-run path with the body and encode the connection id', async () => {
    const request = vi.fn().mockResolvedValue(payload);

    await createRoutingDryRunApi(request).run('conn/1', { orderId: 'ol_order_1' });

    expect(request).toHaveBeenCalledWith('/connections/conn%2F1/sourcing-rules/dry-run', {
      method: 'POST',
      body: JSON.stringify({ orderId: 'ol_order_1' }),
    });
  });

  it('should parse the response, turning absent draft fields into undefined', async () => {
    const request = vi.fn().mockResolvedValue({ ...payload, draft: null, changedLines: null });

    const result = await createRoutingDryRunApi(request).run('c1', { orderId: 'o1' });

    expect(result.draft).toBeUndefined();
    expect(result.changedLines).toBeUndefined();
  });

  it('should keep an unfulfillable reason exactly as the router sent it', async () => {
    const request = vi.fn().mockResolvedValue({
      ...payload,
      saved: {
        ...evaluation,
        unfulfillable: [{ orderLineId: 'l1', quantity: 3, resolution: 'refund', reason: 'no-stock-in-network' }],
      },
    });

    const result = await createRoutingDryRunApi(request).run('c1', { orderId: 'o1' });

    expect(result.saved.unfulfillable[0]?.reason).toBe('no-stock-in-network');
  });

  it('should reject a response whose resolution is outside the closed set', async () => {
    const request = vi.fn().mockResolvedValue({
      ...payload,
      saved: {
        ...evaluation,
        unfulfillable: [{ orderLineId: 'l1', quantity: 1, resolution: 'partial-cancel', reason: 'x' }],
      },
    });

    await expect(createRoutingDryRunApi(request).run('c1', { orderId: 'o1' })).rejects.toThrow();
  });
});
