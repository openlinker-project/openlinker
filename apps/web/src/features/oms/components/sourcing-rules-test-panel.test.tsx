/**
 * Sourcing-rules test panel (#2954)
 *
 * Holds the states the mockup names (`empty`, `picking`, `routable`,
 * `unfulfillable`, `compare`, `error`) and the two properties that matter most:
 * the router's words are rendered verbatim, and a failed test says nothing was
 * changed instead of asserting a result.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { RoutingDryRunResult } from '../api/routing-dry-run.types';
import { SourcingRulesTestPanel } from './sourcing-rules-test-panel';

const LOCATIONS = [
  { id: 'loc-a', code: 'POZ', name: 'Poznań', isActive: true },
  { id: 'loc-b', code: 'WRO', name: 'Wrocław', isActive: true },
];

const baseInput = {
  lines: [{ orderLineId: 'l1', productVariantId: 'SKU-1', quantity: 2 }],
  shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: '61-000', city: null },
  requestedDeliveryMethod: null,
};

const routable: RoutingDryRunResult = {
  input: baseInput,
  saved: {
    candidates: [
      { orderLineId: 'l1', locationId: 'loc-a', connectionId: 'c', deliveryMethod: null, quantity: 2 },
    ],
    unfulfillable: [],
    explanation: [
      {
        rule: { ruleId: 'r1', name: 'in-stock', displayLabel: 'Has stock' },
        eliminated: ['loc-b'],
        score: null,
        detail: null,
      },
    ],
  },
};

function renderPanel(
  run: ReturnType<typeof vi.fn>,
  props: Partial<React.ComponentProps<typeof SourcingRulesTestPanel>> = {}
): void {
  renderWithProviders(
    <SourcingRulesTestPanel connectionId="conn_1" locations={LOCATIONS} {...props} />,
    { apiClient: createMockApiClient({ routingDryRun: { run } as never }) }
  );
}

async function runBasket(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Build a basket' }));
  await user.type(screen.getByLabelText('Variant id'), 'SKU-1');
  await user.click(screen.getByRole('button', { name: 'Run test' }));
}

describe('SourcingRulesTestPanel (#2954)', () => {
  it('should start empty with the run button disabled and the dry-run banner shown', () => {
    renderPanel(vi.fn());

    expect(screen.getByTestId('routing-test-state-empty')).toBeInTheDocument();
    expect(screen.getByText('Dry run - nothing is committed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled();
  });

  it('should show a routable result with location names and the router label', async () => {
    const run = vi.fn().mockResolvedValue(routable);
    const user = userEvent.setup();
    renderPanel(run);

    await runBasket(user);

    expect(await screen.findByTestId('routing-test-state-routable')).toBeInTheDocument();
    expect(screen.getByText('Every line can be sourced')).toBeInTheDocument();
    expect(screen.getByTestId('routing-test-lines')).toHaveTextContent('Poznań × 2');
    expect(screen.getByTestId('routing-test-explanation')).toHaveTextContent('Has stock (removed 1)');
  });

  it('should send a basket and never an order id', async () => {
    const run = vi.fn().mockResolvedValue(routable);
    const user = userEvent.setup();
    renderPanel(run);

    await runBasket(user);

    expect(run).toHaveBeenCalledWith('conn_1', {
      basket: { lines: [{ productVariantId: 'SKU-1', quantity: 1 }], countryIso2: 'PL' },
    });
  });

  it('should render an unfulfillable reason exactly as the router sent it', async () => {
    const run = vi.fn().mockResolvedValue({
      ...routable,
      saved: {
        candidates: [],
        unfulfillable: [{ orderLineId: 'l1', quantity: 2, resolution: 'refund', reason: 'no-stock-in-network' }],
        explanation: [],
      },
    });
    const user = userEvent.setup();
    renderPanel(run);

    await runBasket(user);

    expect(await screen.findByTestId('routing-test-state-unfulfillable')).toBeInTheDocument();
    expect(screen.getByTestId('routing-test-unfulfillable')).toHaveTextContent('refund - no-stock-in-network');
  });

  it('should say nothing was changed when the test fails, with a retry', async () => {
    const run = vi.fn().mockRejectedValue(new ApiError('boom', 500, {}));
    const user = userEvent.setup();
    renderPanel(run);

    await runBasket(user);

    expect(await screen.findByTestId('routing-test-state-error')).toBeInTheDocument();
    expect(screen.getByText("Couldn't finish this test")).toBeInTheDocument();
    expect(screen.getByText('Nothing was changed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  describe('compare', () => {
    const draft = [
      { id: 'd1', position: 1, kind: 'sort', name: 'priority', afterAction: 'quantity-split', priorityLocationIds: ['loc-b'] },
    ];

    it('should offer no compare control when the page supplies no draft', () => {
      renderPanel(vi.fn());

      expect(screen.queryByLabelText('Compare with my draft')).toBeNull();
    });

    it('should send the draft only when the operator asked to compare', async () => {
      const run = vi.fn().mockResolvedValue(routable);
      const user = userEvent.setup();
      renderPanel(run, { draftRules: draft });

      await runBasket(user);
      expect(run.mock.calls[0]?.[1]).not.toHaveProperty('draftRules');

      await user.click(screen.getByLabelText('Compare with my draft'));
      await user.click(screen.getByRole('button', { name: 'Run test' }));

      expect(run.mock.calls[1]?.[1]).toHaveProperty('draftRules');
    });

    it('should list the lines the draft would move', async () => {
      const run = vi.fn().mockResolvedValue({
        ...routable,
        draft: routable.saved,
        changedLines: [{ orderLineId: 'l1', saved: ['loc-a:2'], draft: ['loc-b:2'] }],
      });
      const user = userEvent.setup();
      renderPanel(run, { draftRules: draft });

      await user.click(screen.getByLabelText('Compare with my draft'));
      await runBasket(user);

      expect(await screen.findByTestId('routing-test-state-compare')).toBeInTheDocument();
      expect(screen.getByTestId('routing-test-compare')).toHaveTextContent('1 line would move');
    });

    it('should say a draft that changes nothing places every line as before', async () => {
      const run = vi.fn().mockResolvedValue({ ...routable, draft: routable.saved, changedLines: [] });
      const user = userEvent.setup();
      renderPanel(run, { draftRules: draft });

      await user.click(screen.getByLabelText('Compare with my draft'));
      await runBasket(user);

      expect(await screen.findByText(/places every line exactly where the saved rules do/)).toBeInTheDocument();
    });
  });

  it('should clear a shown result when the input changes, so it never describes another input', async () => {
    const run = vi.fn().mockResolvedValue(routable);
    const user = userEvent.setup();
    renderPanel(run);

    await runBasket(user);
    expect(await screen.findByTestId('routing-test-state-routable')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Variant id'), '2');

    expect(screen.queryByTestId('routing-test-state-routable')).toBeNull();
    expect(screen.getByTestId('routing-test-state-empty')).toBeInTheDocument();
  });
});
