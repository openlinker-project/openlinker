/**
 * `OrderAttentionSummary` (#4026): one number per "Needs a look" group, taken
 * from the server's union counts, and a popover whose items toggle the same
 * URL filters the old chips did.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderAttentionSummary } from './order-attention-summary';
import { renderWithProviders } from '../../../test/test-utils';
import type { OrderHealthSummary } from '../api/orders.types';
import type { UseOrderListFiltersResult } from '../hooks/use-order-list-filters';
import { parseOrderListFilterState } from '../lib/order-filter-descriptors';

function filtersApi(params = ''): UseOrderListFiltersResult {
  return {
    state: parseOrderListFilterState(new URLSearchParams(params)),
    toggle: vi.fn(),
    setFilter: vi.fn(),
  } as unknown as UseOrderListFiltersResult;
}

const SUMMARY = {
  total: 20,
  onPackBench: 2,
  hasBuyerNote: 1,
  openReturn: 3,
  attention: { lateToShip: 6, stuck: 7, toHandle: 5 },
} as OrderHealthSummary;

function group(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-attention-group="${id}"]`);
  if (!el) throw new Error(`group ${id} not rendered`);
  return el;
}

describe('OrderAttentionSummary', () => {
  afterEach(() => {
    cleanup();
  });

  it('should show the server union count for each group', () => {
    renderWithProviders(
      <OrderAttentionSummary filtersApi={filtersApi()} summary={SUMMARY} slaSummary={undefined} />
    );

    expect(group('late')).toHaveTextContent('6');
    expect(group('stuck')).toHaveTextContent('7');
    expect(group('toHandle')).toHaveTextContent('5');
  });

  it('should show "-" for a group whose count is unknown, never 0', () => {
    const summary = { ...SUMMARY, attention: { lateToShip: 6, stuck: 7 } } as OrderHealthSummary;
    renderWithProviders(
      <OrderAttentionSummary filtersApi={filtersApi()} summary={summary} slaSummary={undefined} />
    );

    expect(group('toHandle')).toHaveTextContent('-');
    expect(group('toHandle')).not.toHaveTextContent('0');
  });

  it('should list the group items with their own counts and toggle the matching filter', async () => {
    const user = userEvent.setup();
    const api = filtersApi();
    renderWithProviders(
      <OrderAttentionSummary filtersApi={api} summary={SUMMARY} slaSummary={undefined} />
    );

    await user.click(group('toHandle'));
    const openReturn = await screen.findByRole('button', { name: /Open return/ });
    expect(openReturn).toHaveTextContent('3');
    expect(openReturn).toHaveAttribute('aria-pressed', 'false');

    await user.click(openReturn);

    expect(api.toggle).toHaveBeenCalledWith('openReturn');
  });

  it('should mark an item that is already filtered as pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrderAttentionSummary
        filtersApi={filtersApi('hasBuyerNote=true')}
        summary={SUMMARY}
        slaSummary={undefined}
      />
    );

    await user.click(group('toHandle'));

    expect(await screen.findByRole('button', { name: /Buyer left a note/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('should link the late-to-ship group to the dispatch risk page', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrderAttentionSummary filtersApi={filtersApi()} summary={SUMMARY} slaSummary={undefined} />
    );

    await user.click(group('late'));

    const links = await screen.findAllByRole('link');
    expect(links.some((link) => link.getAttribute('href') === '/orders/dispatch-risk')).toBe(true);
  });
});
