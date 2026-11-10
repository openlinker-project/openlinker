/**
 * `OrderStatusTabs` (#4026): the health partition as tabs, with arrow-key
 * movement that wraps at both ends.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderStatusTabs } from './order-status-tabs';
import { renderWithProviders } from '../../../test/test-utils';
import type { OrderHealthSummary } from '../api/orders.types';

const SUMMARY = {
  total: 10,
  sourceDeleted: 1,
  needsAttention: 2,
  awaitingMapping: 0,
  awaitingDispatch: 3,
  synced: 4,
} as OrderHealthSummary;

describe('OrderStatusTabs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('should show each health count and mark the selected tab', () => {
    renderWithProviders(<OrderStatusTabs value="synced" summary={SUMMARY} onChange={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('data-health'))).toEqual([
      'all',
      'source_deleted',
      'needs_attention',
      'awaiting_mapping',
      'awaiting_dispatch',
      'synced',
    ]);
    expect(tabs[0]).toHaveTextContent('10');
    expect(tabs[5]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[5]).toHaveAttribute('tabindex', '0');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
  });

  it('should show "—" rather than 0 while the summary is unknown', () => {
    renderWithProviders(<OrderStatusTabs value={undefined} summary={undefined} onChange={vi.fn()} />);

    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('—');
  });

  it('should move to the next tab with ArrowRight', () => {
    const onChange = vi.fn();
    renderWithProviders(<OrderStatusTabs value={undefined} summary={SUMMARY} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('source_deleted');
  });

  it('should wrap from the first tab to the last with ArrowLeft', () => {
    const onChange = vi.fn();
    renderWithProviders(<OrderStatusTabs value={undefined} summary={SUMMARY} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('synced');
  });

  it('should wrap from the last tab back to "All orders" with ArrowRight', () => {
    const onChange = vi.fn();
    renderWithProviders(<OrderStatusTabs value="synced" summary={SUMMARY} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('should ignore other keys', () => {
    const onChange = vi.fn();
    renderWithProviders(<OrderStatusTabs value={undefined} summary={SUMMARY} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });

    expect(onChange).not.toHaveBeenCalled();
  });
});
