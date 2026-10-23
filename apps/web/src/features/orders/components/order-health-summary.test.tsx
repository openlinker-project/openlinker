/**
 * Order Health Summary tests (#3482, #2703)
 *
 * The Sync cell hint has three answers for an order with no destination rows,
 * and the precedence between them is the point: handled in OpenLinker, then a
 * router that chose nobody, then nothing configured.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
