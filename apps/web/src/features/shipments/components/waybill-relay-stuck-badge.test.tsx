/**
 * Waybill Relay Stuck Badge — Tests (#2073)
 *
 * @module apps/web/src/features/shipments/components
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WaybillRelay } from '../api/shipments.types';
import { WaybillRelayStuckBadge, describeWaybillRelayStuck } from './waybill-relay-stuck-badge';

function relay(overrides: Partial<WaybillRelay> = {}): WaybillRelay {
  return {
    failureCount: 4,
    stuck: true,
    firstFailedAt: '2026-05-19T10:00:00.000Z',
    lastFailedAt: '2026-05-19T14:00:00.000Z',
    lastFailureReason: 'rejected',
    lastFailureConnectionId: '00000000-0000-0000-0000-0000000000aa',
    ...overrides,
  };
}

afterEach(cleanup);

describe('WaybillRelayStuckBadge', () => {
  it('renders nothing when the shipment has no relay failure history', () => {
    const { container } = render(<WaybillRelayStuckBadge waybillRelay={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the failures are below the escalation threshold', () => {
    // `stuck` is the BACKEND's answer — this component never compares a count
    // to a threshold, so a low count with `stuck: true` would still render.
    // That is deliberate: the rule has exactly one home (#591, #2229).
    const { container } = render(
      <WaybillRelayStuckBadge waybillRelay={relay({ failureCount: 2, stuck: false })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the badge once the backend reports the relay as stuck', () => {
    render(<WaybillRelayStuckBadge waybillRelay={relay()} />);

    expect(screen.getByText('Tracking not sent')).toBeInTheDocument();
  });

  it('exposes the cause as real text, not only as a hover title', () => {
    // `title` is not reliably surfaced by assistive tech, so the sentence is
    // also `sr-only` content inside the badge.
    render(<WaybillRelayStuckBadge waybillRelay={relay()} />);

    expect(
      screen.getByText(/the channel refused the update/, { exact: false }),
    ).toBeInTheDocument();
  });
});

describe('describeWaybillRelayStuck', () => {
  it('names the attempt count and the cause', () => {
    expect(describeWaybillRelayStuck(relay({ failureCount: 4 }))).toContain('4 attempts');
    expect(describeWaybillRelayStuck(relay())).toContain('the channel refused the update');
    expect(describeWaybillRelayStuck(relay())).toContain('The buyer has not been notified.');
  });

  it('singularises a single attempt', () => {
    expect(describeWaybillRelayStuck(relay({ failureCount: 1 }))).toContain('after 1 attempt');
    expect(describeWaybillRelayStuck(relay({ failureCount: 2 }))).toContain('after 2 attempts');
  });

  it('omits the cause rather than guessing when the reason is unrecognised', () => {
    // The backend coerces a value this build does not know to null; inventing
    // copy for it would state something nothing observed.
    const text = describeWaybillRelayStuck(relay({ lastFailureReason: null }));

    expect(text).toContain('has not reached the sales channel');
    expect(text).not.toContain('last failure');
  });
});
