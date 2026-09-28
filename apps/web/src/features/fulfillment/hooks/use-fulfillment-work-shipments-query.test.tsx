/**
 * `useFulfillmentWorkShipmentsQuery` tests (#3292/#3103)
 *
 * Two properties: the query is disabled for an absent id, and an empty
 * response is read as a normal "nothing dispatched yet" answer rather than
 * an error.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { FulfillmentTaskShipment } from '../api/fulfillment.types';
import { useFulfillmentWorkShipmentsQuery } from './use-fulfillment-work-shipments-query';

function shipment(overrides: Partial<FulfillmentTaskShipment> = {}): FulfillmentTaskShipment {
  return {
    id: 'ol_shipment_1',
    status: 'dispatched',
    carrier: 'inpost',
    trackingNumber: '6800000001',
    hasLabel: true,
    createdAt: '2026-09-01T09:00:00.000Z',
    dispatchedAt: '2026-09-01T09:05:00.000Z',
    deliveredAt: null,
    ...overrides,
  };
}

function renderQuery(
  workId: string,
  listShipments: ReturnType<typeof vi.fn>
): { result: () => ReturnType<typeof useFulfillmentWorkShipmentsQuery> } {
  let latest: ReturnType<typeof useFulfillmentWorkShipmentsQuery> | undefined;

  function Probe(): null {
    latest = useFulfillmentWorkShipmentsQuery(workId);
    return null;
  }

  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({ fulfillment: { listShipments } as never }),
  });

  return {
    result: () => {
      if (latest === undefined) throw new Error('Probe has not rendered yet');
      return latest;
    },
  };
}

describe('useFulfillmentWorkShipmentsQuery', () => {
  it('never calls the API for an absent id', async () => {
    const listShipments = vi.fn();
    const { result } = renderQuery('', listShipments);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listShipments).not.toHaveBeenCalled();
    expect(result().fetchStatus).toBe('idle');
  });

  it('reads an empty array as a normal answer, not an error', async () => {
    const listShipments = vi.fn().mockResolvedValue([]);
    const { result } = renderQuery('ol_work_1', listShipments);

    await waitFor(() => {
      expect(result().isSuccess).toBe(true);
    });

    expect(result().data).toEqual([]);
    expect(result().isError).toBe(false);
  });

  it('fetches and returns the shipments for a real id', async () => {
    const listShipments = vi.fn().mockResolvedValue([shipment()]);
    const { result } = renderQuery('ol_work_1', listShipments);

    await waitFor(() => {
      expect(result().data).toEqual([shipment()]);
    });

    expect(listShipments).toHaveBeenCalledWith('ol_work_1');
  });
});
