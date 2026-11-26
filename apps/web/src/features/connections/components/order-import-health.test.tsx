/**
 * OrderImportHealth tests (#4228)
 *
 * @module features/connections/components
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { OrderImportStatus } from '../api/connections.types';
import { OrderImportHealth } from './order-import-health';

function makeImport(overrides: Partial<OrderImportStatus> = {}): OrderImportStatus {
  return {
    importedLast24h: 12,
    lastPolledAt: new Date(Date.now() - 60_000).toISOString(),
    failedLast7d: 0,
    failures: [],
    waiting: 0,
    lastImportedAt: null,
    activeImport: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe('OrderImportHealth', () => {
  it('renders nothing when the figures could not be read', () => {
    const { container } = renderWithProviders(<OrderImportHealth orderImport={null} />);

    expect(container.querySelector('.order-import-health')).toBeNull();
    // Never drawn as zero orders, which would read as "nothing is wrong".
    expect(screen.queryByText('Imported in the last 24 hours')).not.toBeInTheDocument();
  });

  it('shows the figures and no waiting, failure or run block for a quiet connection', async () => {
    renderWithProviders(<OrderImportHealth orderImport={makeImport()} />);

    expect(screen.getByText('Last check for new orders')).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Waiting to import')).not.toBeInTheDocument();
    expect(screen.queryByText('History import in progress')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });

  it('says the shop was never checked', () => {
    renderWithProviders(<OrderImportHealth orderImport={makeImport({ lastPolledAt: null })} />);

    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  });

  it('shows how many orders wait to import', () => {
    renderWithProviders(<OrderImportHealth orderImport={makeImport({ waiting: 4 })} />);

    expect(screen.getByText('Waiting to import')).toBeInTheDocument();
  });

  it('describes a running history import', () => {
    renderWithProviders(
      <OrderImportHealth
        orderImport={makeImport({
          activeImport: {
            runId: 'run_1',
            direction: 'newest-first',
            from: '2026-10-01',
            to: null,
            pagesDone: 3,
            startedAt: new Date().toISOString(),
          },
        })}
      />
    );

    expect(screen.getByText('History import in progress')).toBeInTheDocument();
    expect(screen.getByText(/Newest first/)).toBeInTheDocument();
  });

  describe('failures', () => {
    const failing = makeImport({
      failedLast7d: 2,
      failures: [
        {
          code: 'missing-mapping',
          count: 2,
          lastFailedAt: new Date().toISOString(),
          sampleOrderId: 'A-100',
          sampleMessage: 'No mapping',
        },
      ],
    });

    it('shows a banner and opens the causes in a side panel', async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrderImportHealth orderImport={failing} />);

      expect(screen.getByText('2 orders could not be imported')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'View' }));

      expect(await screen.findByText('Orders that failed')).toBeInTheDocument();
      expect(screen.getByText(/unknown product/)).toBeInTheDocument();
    });

    it('offers to sync products for an unknown product and retries on request', async () => {
      const user = userEvent.setup();
      const onSyncProducts = vi.fn();
      const onRetry = vi.fn();
      renderWithProviders(
        <OrderImportHealth
          orderImport={failing}
          onSyncProducts={onSyncProducts}
          onRetry={onRetry}
        />
      );

      await user.click(screen.getByRole('button', { name: 'View' }));
      await user.click(await screen.findByRole('button', { name: 'Sync products…' }));
      expect(onSyncProducts).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Retry failed orders' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('withholds the retry action when the user cannot retry', async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrderImportHealth orderImport={failing} />);

      await user.click(screen.getByRole('button', { name: 'View' }));
      await screen.findByText('Orders that failed');

      expect(screen.queryByRole('button', { name: 'Retry failed orders' })).not.toBeInTheDocument();
    });

    it('shows an unknown cause as the generic one, not a crash', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <OrderImportHealth
          orderImport={makeImport({
            failures: [
              {
                code: 'something-new' as 'other',
                count: 1,
                lastFailedAt: new Date().toISOString(),
                sampleOrderId: null,
                sampleMessage: 'Boom',
              },
            ],
          })}
        />
      );

      await user.click(screen.getByRole('button', { name: 'View' }));

      await waitFor(() => expect(screen.getByText(/other error/)).toBeInTheDocument());
      expect(screen.getByText('Boom')).toBeInTheDocument();
    });
  });
});
