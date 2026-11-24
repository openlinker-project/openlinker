/**
 * `OrderProgressLine` unit tests (#4286).
 *
 * The current step is the one after the last done step, so a skipped step
 * (cash on delivery is paid at the door) never holds the marker.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderProgressLine, type OrderProgressInput } from './order-progress-line';
import { renderWithProviders } from '../../../test/test-utils';

const base: OrderProgressInput = {
  placedAt: '2026-01-01T00:00:00.000Z',
  paid: false,
  syncedCount: 1,
  syncTotal: 1,
  packedAt: '2026-01-02T00:00:00.000Z',
  dispatched: true,
  delivered: false,
};

describe('OrderProgressLine', () => {
  afterEach(cleanup);

  it('should mark the step after the last done one as current when payment was skipped', () => {
    const { container } = renderWithProviders(<OrderProgressLine input={base} />);
    const items = Array.from(container.querySelectorAll('li'));
    const current = items.filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(items.indexOf(current[0])).toBe(5);
  });

  it('should mark the first not-done step as current for a fresh order', () => {
    const { container } = renderWithProviders(
      <OrderProgressLine
        input={{ ...base, syncedCount: 0, packedAt: null, dispatched: false }}
      />,
    );
    const items = Array.from(container.querySelectorAll('li'));
    expect(items.findIndex((li) => li.getAttribute('aria-current') === 'step')).toBe(1);
  });
});
