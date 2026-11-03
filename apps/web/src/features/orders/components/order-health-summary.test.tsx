/**
 * Order Health Summary tests (#3482, #2703 / #2704)
 *
 * The Sync cell hint has several answers for an order with no destination rows,
 * and the precedence between them is the point: handled in OpenLinker, then a
 * routing reason, then nothing configured. With destination rows, a partial
 * routing narrowing must not read as "All destinations reconciled".
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { OrderSyncStatus } from '../api/orders.types';
import {
  DESTINATION_ROUTING_ATTENTION_SYNC_HINT,
  DESTINATION_ROUTING_PARTIAL_SYNC_HINT,
  DESTINATION_ROUTING_REASON_COPY,
} from '../lib/destination-routing-copy';
import { OrderHealthSummary } from './order-health-summary';

afterEach(cleanup);

const base = { syncStatus: [], fulfillment: 'not-shipped' as const, itemCount: 1 };

describe('OrderHealthSummary - an order with no destination rows', () => {
  it('should say handled in OpenLinker when the order has live pack-bench work', () => {
    render(<OrderHealthSummary {...base} handledInOpenLinker={{ stage: 'packing', workCount: 1 }} />);
    expect(screen.getByText('In OpenLinker')).toBeInTheDocument();
    expect(screen.getByText('Handled in OpenLinker')).toBeInTheDocument();
    expect(screen.queryByText('No destinations configured')).not.toBeInTheDocument();
  });

  it('should prefer handled-in-OpenLinker over a routed-nowhere reason', () => {
    render(
      <OrderHealthSummary
        {...base}
        destinationRoutingBlockReason="routed-to-no-destination"
        handledInOpenLinker={{ stage: 'to-pack', workCount: 1 }}
      />
    );
    expect(screen.getByText('Handled in OpenLinker')).toBeInTheDocument();
  });

  it('should keep the routed-nowhere copy when the order has no work', () => {
    render(<OrderHealthSummary {...base} destinationRoutingBlockReason="routed-to-no-destination" />);
    expect(screen.getByText('Routed nowhere')).toBeInTheDocument();
  });

  it('should still say nothing is configured when neither applies', () => {
    render(<OrderHealthSummary {...base} />);
    expect(screen.getByText('No destinations configured')).toBeInTheDocument();
  });
});

const synced: OrderSyncStatus = {
  destinationConnectionId: 'dest-a',
  status: 'synced',
  syncedAt: '2026-10-27T08:00:00Z',
  externalOrderId: '1',
  externalOrderNumber: '1',
  error: null,
};

const renderSummary = (
  syncStatus: OrderSyncStatus[],
  destinationRoutingBlockReason: string | null
): void => {
  render(
    <OrderHealthSummary
      syncStatus={syncStatus}
      fulfillment="not-shipped"
      itemCount={1}
      destinationRoutingBlockReason={destinationRoutingBlockReason}
    />
  );
};

describe('OrderHealthSummary sync hint', () => {
  it('should say nothing is configured when no destination exists and routing narrowed nothing', () => {
    renderSummary([], null);

    expect(screen.getByText('No destinations configured')).toBeInTheDocument();
  });

  it('should show the decision hint when the router chose no destination', () => {
    renderSummary([], 'routed-to-no-destination');

    expect(
      screen.getByText(DESTINATION_ROUTING_REASON_COPY['routed-to-no-destination'].hint)
    ).toBeInTheDocument();
    expect(screen.queryByText('No destinations configured')).not.toBeInTheDocument();
  });

  it.each(['routed-destinations-unavailable', 'routed-to-source-only'])(
    'should point to routing attention rather than repeat the callout when %s has no destination rows',
    (reason) => {
      renderSummary([], reason);

      expect(screen.getByText(DESTINATION_ROUTING_ATTENTION_SYNC_HINT)).toBeInTheDocument();
    }
  );

  it('should not claim every destination reconciled when routing reached only some', () => {
    renderSummary([synced], 'routed-destinations-partially-unavailable');

    expect(screen.getByText(DESTINATION_ROUTING_PARTIAL_SYNC_HINT)).toBeInTheDocument();
    expect(screen.queryByText('All destinations reconciled')).not.toBeInTheDocument();
  });

  it('should keep the reconciled hint when destination rows exist and routing narrowed nothing', () => {
    renderSummary([synced], null);

    expect(screen.getByText('All destinations reconciled')).toBeInTheDocument();
  });

  it('should fall back to the original wording when the reason is unrecognised', () => {
    renderSummary([], 'routed-somewhere-new');

    expect(screen.getByText('No destinations configured')).toBeInTheDocument();
  });
});
