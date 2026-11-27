/**
 * `OrderPeek` keyboard navigation (#4026): ↓/J and ↑/K walk the visible rows
 * while the peek is open, never while the operator types, and the listener
 * goes away with the panel.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderPeek, type OrderPeekView } from './order-peek';
import { renderWithProviders } from '../../../test/test-utils';

const VIEW: OrderPeekView = {
  internalOrderId: 'ol_order_1',
  reference: 'A-1001',
  source: 'Allegro',
  status: null,
  shipment: null,
  money: null,
  detail: <input aria-label="note field" />,
};

function renderPeek(
  props: Partial<Parameters<typeof OrderPeek>[0]> = {}
): { onNavigate: ReturnType<typeof vi.fn>; unmount: () => void } {
  const onNavigate = vi.fn();
  const { unmount } = renderWithProviders(
    <OrderPeek
      view={VIEW}
      position={2}
      count={3}
      onNavigate={onNavigate}
      onOpenChange={vi.fn()}
      {...props}
    />
  );
  return { onNavigate, unmount };
}

describe('OrderPeek keyboard navigation', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ['ArrowDown', 1],
    ['j', 1],
    ['ArrowUp', -1],
    ['k', -1],
  ] as const)('should move by %s when %s is pressed', (key, step) => {
    const { onNavigate } = renderPeek();

    fireEvent.keyDown(document.body, { key });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(step);
  });

  it('should not move past the last row or before the first', () => {
    const atEnd = renderPeek({ position: 3, count: 3 });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(atEnd.onNavigate).not.toHaveBeenCalled();
    atEnd.unmount();

    const atStart = renderPeek({ position: 1, count: 3 });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(atStart.onNavigate).not.toHaveBeenCalled();
  });

  it('should ignore the keys while the operator types in a field', () => {
    const { onNavigate } = renderPeek();

    fireEvent.keyDown(screen.getByLabelText('note field'), { key: 'j' });
    fireEvent.keyDown(screen.getByLabelText('note field'), { key: 'ArrowDown' });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('should ignore the keys with a modifier held', () => {
    const { onNavigate } = renderPeek();

    fireEvent.keyDown(document.body, { key: 'j', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowDown', ctrlKey: true });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('should not listen while closed or after unmount', () => {
    const closed = renderPeek({ view: null });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(closed.onNavigate).not.toHaveBeenCalled();
    closed.unmount();

    const open = renderPeek();
    open.unmount();
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(open.onNavigate).not.toHaveBeenCalled();
  });
});
