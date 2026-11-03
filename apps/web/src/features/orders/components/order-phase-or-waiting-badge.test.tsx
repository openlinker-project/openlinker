/**
 * Order Phase Or Waiting Badge tests (#3482)
 *
 * "On hold" and "Waiting" must never sit side by side for one order, so the
 * waiting badge REPLACES the phase pill rather than joining it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { FulfillmentBlockReasonValue } from '../api/orders.types';

import { OrderPhaseOrWaitingBadge } from './order-phase-or-waiting-badge';

afterEach(cleanup);

describe('OrderPhaseOrWaitingBadge', () => {
  it('should show the waiting reason and no phase pill when OpenLinker holds the order', () => {
    render(
      <OrderPhaseOrWaitingBadge
        order={{ fulfillmentBlockReason: 'routing-refused', lifecyclePhase: 'held' }}
      />
    );
    expect(screen.getByText('Waiting: stock')).toBeInTheDocument();
    expect(screen.queryByText('On hold')).not.toBeInTheDocument();
  });

  it('should fall back to the phase badge when nothing holds the order', () => {
    render(
      <OrderPhaseOrWaitingBadge order={{ fulfillmentBlockReason: null, lifecyclePhase: 'blocked' }} />
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('should fall back to the phase badge for a held reason it does not recognise', () => {
    render(
      <OrderPhaseOrWaitingBadge
        order={{
          fulfillmentBlockReason: 'routing-teleported' as FulfillmentBlockReasonValue,
          lifecyclePhase: 'blocked',
        }}
      />
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });
});
