/**
 * TriggerSyncDialog Tests
 *
 * Unit tests for the TriggerSyncDialog component covering rendering, payload
 * field visibility, client-side validation, enqueue submission, success/error
 * feedback, and reset-on-reopen behaviour.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  getToastDescription,
  getToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { TriggerSyncDialog } from './TriggerSyncDialog';

// jsdom does not implement showModal/close — stub them on HTMLDialogElement
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

function renderDialog(open = true, onOpenChange = vi.fn(), apiOverrides = {}) {
  const mockApi = createMockApiClient(apiOverrides);
  renderWithProviders(
    <TriggerSyncDialog connection={sampleConnection} open={open} onOpenChange={onOpenChange} />,
    { apiClient: mockApi },
  );
  return { mockApi, onOpenChange };
}

describe('TriggerSyncDialog', () => {
  describe('rendering', () => {
    it('should render job types matching the connection capabilities', () => {
      // sampleConnection supports ProductMaster + InventoryMaster (not Marketplace)
      renderDialog();
      const options = screen.getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      expect(labels).toContain('Sync all products');
      expect(labels).toContain('Sync product by ID');
      expect(labels).toContain('Sync all inventory');
      expect(labels).toContain('Sync inventory by ID');
      expect(labels).toContain('Auto-match variants');
      expect(labels).not.toContain('Sync marketplace offers'); // requires Marketplace capability
      expect(labels).toContain('Propagate inventory to marketplaces');
    });

    it('should render marketplace jobs for Marketplace-capable connections', () => {
      const allegroConnection = {
        ...sampleConnection,
        platformType: 'allegro' as const,
        supportedCapabilities: ['OfferManager' as const, 'OfferEventReader' as const, 'OrderSource' as const],
        enabledCapabilities: ['OfferManager' as const],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={allegroConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );
      const options = screen.getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      expect(labels).toContain('Sync marketplace offers');
      expect(labels).not.toContain('Sync all products'); // requires ProductMaster
    });

    it('should render the Invoicing reconcile trigger for Invoicing-capable connections', () => {
      const ksefConnection = {
        ...sampleConnection,
        platformType: 'ksef' as const,
        supportedCapabilities: ['Invoicing'],
        enabledCapabilities: ['Invoicing' as const],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={ksefConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );
      const options = screen.getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      expect(labels).toContain('Reconcile regulatory status');
      // Inventory fan-out job is now gated to InventoryMaster — must not leak here.
      expect(labels).not.toContain('Propagate inventory to marketplaces');
      expect(labels).not.toContain('Sync all products');
    });

    it('should hide the inventory propagation job when the connection lacks InventoryMaster', () => {
      const invoicingOnlyConnection = {
        ...sampleConnection,
        platformType: 'ksef' as const,
        supportedCapabilities: ['Invoicing'],
        enabledCapabilities: ['Invoicing' as const],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={invoicingOnlyConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );
      const labels = screen.getAllByRole('option').map((o) => o.textContent);
      expect(labels).not.toContain('Propagate inventory to marketplaces');
    });

    it('should render a neutral empty-state and disable submit when no triggers match', () => {
      const shippingOnlyConnection = {
        ...sampleConnection,
        platformType: 'inpost' as const,
        supportedCapabilities: ['ShippingProviderManager'],
        enabledCapabilities: [],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={shippingOnlyConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );
      expect(screen.getByText(/no sync triggers available for this connection/i)).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /job type/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /trigger/i })).toBeDisabled();
    });

    it('should show job description for selected job type', () => {
      renderDialog();
      expect(
        screen.getByText(/enumerate and sync every product from the source catalog/i),
      ).toBeInTheDocument();
    });

    it('should not show text inputs for job types with no required params', () => {
      renderDialog();
      // master.product.syncAll is selected by default — no payload fields
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  describe('payload fields', () => {
    it('should show payload fields when a job type with fields is selected', () => {
      renderDialog();
      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.product.syncByExternalId' } });

      expect(screen.getByLabelText(/external id/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/object type/i)).toBeInTheDocument();
    });

    it('should default cursorKey to platform-scoped value for marketplace.orders.poll', () => {
      const allegroConnection = {
        ...sampleConnection,
        platformType: 'allegro' as const,
        supportedCapabilities: ['OfferManager' as const, 'OfferEventReader' as const, 'OrderSource' as const],
        enabledCapabilities: ['OfferManager' as const],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={allegroConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'marketplace.orders.poll' } });

      const cursorKeyInput = screen.getByLabelText(/cursor key/i);
      expect(cursorKeyInput).toHaveValue('allegro.orders.lastEventId');
    });

    it('should scope cursorKey default to the connection platform type', () => {
      const prestashopMarketplaceConnection = {
        ...sampleConnection,
        platformType: 'prestashop' as const,
        supportedCapabilities: ['OfferManager' as const, 'OfferEventReader' as const, 'OrderSource' as const],
        enabledCapabilities: ['OfferManager' as const],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={prestashopMarketplaceConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'marketplace.orders.poll' } });

      const cursorKeyInput = screen.getByLabelText(/cursor key/i);
      expect(cursorKeyInput).toHaveValue('prestashop.orders.lastEventId');
    });

    it('should clear payload fields when job type changes', () => {
      renderDialog();
      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.product.syncByExternalId' } });

      const externalIdInput = screen.getByLabelText(/external id/i);
      fireEvent.change(externalIdInput, { target: { value: '12345' } });
      expect(externalIdInput).toHaveValue('12345');

      fireEvent.change(select, { target: { value: 'master.inventory.syncByExternalId' } });
      expect(screen.getByLabelText(/external id/i)).toHaveValue('');
    });
  });

  describe('validation', () => {
    it('should block submission and show error when required externalId is empty', async () => {
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.product.syncByExternalId' } });

      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      expect(screen.getByText(/external id is required/i)).toBeInTheDocument();
      expect(mockApi.syncJobs.enqueue).not.toHaveBeenCalled();
    });

    it('should allow submission when optional objectType is empty', async () => {
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.product.syncByExternalId' } });
      fireEvent.change(screen.getByLabelText(/external id/i), { target: { value: 'ext-123' } });

      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      await waitFor(() => {
        expect(mockApi.syncJobs.enqueue).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('submission', () => {
    it('should call enqueue with correct jobType, payload, and idempotencyKey', async () => {
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      // Submit with default job type (master.product.syncAll)
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      await waitFor(() => {
        expect(mockApi.syncJobs.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            connectionId: sampleConnection.id,
            jobType: 'master.product.syncAll',
            payload: { schemaVersion: 1 },
            idempotencyKey: expect.stringMatching(
              // Suffix is a crypto.randomUUID() value — stable per dialog
              // open cycle so the backend dedup can collapse double-clicks.
              // See #369.
              new RegExp(
                `^manual:${sampleConnection.id}:master\\.product\\.syncAll:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
              ),
            ),
          }),
        );
      });
    });

    it('should include payload fields in the enqueue call', async () => {
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.product.syncByExternalId' } });
      fireEvent.change(screen.getByLabelText(/external id/i), { target: { value: 'ext-999' } });
      fireEvent.change(screen.getByLabelText(/object type/i), { target: { value: 'combination' } });

      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      await waitFor(() => {
        expect(mockApi.syncJobs.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            jobType: 'master.product.syncByExternalId',
            payload: { schemaVersion: 1, externalId: 'ext-999', objectType: 'combination' },
          }),
        );
      });
    });

    it('should enqueue the Invoicing reconcile job with schemaVersion and default limit', async () => {
      const ksefConnection = {
        ...sampleConnection,
        platformType: 'ksef' as const,
        supportedCapabilities: ['Invoicing'],
        enabledCapabilities: ['Invoicing' as const],
      };
      const mockApi = createMockApiClient();
      renderWithProviders(
        <TriggerSyncDialog connection={ksefConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      // Reconcile is the only trigger, so it is selected by default. Its optional
      // limit field pre-fills to 100.
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      await waitFor(() => {
        expect(mockApi.syncJobs.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            connectionId: ksefConnection.id,
            jobType: 'invoicing.regulatoryStatus.reconcile',
            payload: { schemaVersion: 1, limit: 100 },
          }),
        );
      });
    });
  });

  describe('success feedback', () => {
    it('should close the dialog and show success toast on successful enqueue', async () => {
      const onOpenChange = vi.fn();
      const mockApi = createMockApiClient({
        syncJobs: { enqueue: vi.fn().mockResolvedValue({ jobId: 'job_42', status: 'queued' }) },
      });
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={onOpenChange} />,
        { apiClient: mockApi },
      );

      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      expect(getToastTitle(/sync job enqueued/i)).toBeInTheDocument();
      expect(getToastDescription(/job_42/i)).toBeInTheDocument();
    });
  });

  describe('error feedback', () => {
    it('should keep dialog open and show error Alert on enqueue failure', async () => {
      const onOpenChange = vi.fn();
      const mockApi = createMockApiClient({
        syncJobs: {
          enqueue: vi.fn().mockRejectedValue(new Error('Connection refused')),
        },
      });
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={onOpenChange} />,
        { apiClient: mockApi },
      );

      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));

      await waitFor(() => {
        expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
      });

      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe('reset on reopen', () => {
    it('should reset state when dialog is closed and reopened', () => {
      const { rerender } = renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
      );

      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.product.syncByExternalId' } });
      expect(screen.getByLabelText(/external id/i)).toBeInTheDocument();

      // Close then reopen
      rerender(
        <TriggerSyncDialog connection={sampleConnection} open={false} onOpenChange={vi.fn()} />,
      );
      rerender(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
      );

      // Should be back to default job type (no payload fields)
      expect(screen.queryByLabelText(/external id/i)).not.toBeInTheDocument();
    });
  });

  describe('cancel', () => {
    it('should call onOpenChange(false) when Cancel is clicked', () => {
      const { onOpenChange } = renderDialog();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('idempotency key (#369)', () => {
    it('should reuse the same idempotency key across retries after a failed submit', async () => {
      const enqueue = vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({ jobId: 'job_retry', status: 'queued' });
      const mockApi = createMockApiClient({ syncJobs: { enqueue } });
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      // First click — rejects
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
      await waitFor(() => {
        expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
      });

      // Second click — succeeds (operator retries)
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
      await waitFor(() => {
        expect(enqueue).toHaveBeenCalledTimes(2);
      });

      const firstKey = (enqueue.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
      const secondKey = (enqueue.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
      expect(firstKey).toBe(secondKey); // stable across retries within the same dialog open cycle
    });

    it('should mint a fresh idempotency key on each dialog open cycle', async () => {
      const enqueue = vi.fn().mockResolvedValue({ jobId: 'job_x', status: 'queued' });
      const mockApi = createMockApiClient({ syncJobs: { enqueue } });

      const { rerender } = renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      // First open + submit
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
      await waitFor(() => {
        expect(enqueue).toHaveBeenCalledTimes(1);
      });

      // Close then reopen
      rerender(
        <TriggerSyncDialog connection={sampleConnection} open={false} onOpenChange={vi.fn()} />,
      );
      rerender(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
      );

      // Second open + submit
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
      await waitFor(() => {
        expect(enqueue).toHaveBeenCalledTimes(2);
      });

      const firstKey = (enqueue.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
      const secondKey = (enqueue.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
      expect(firstKey).not.toBe(secondKey); // distinct intents across dialog sessions
    });

    it('should yield a distinct key when switching job types within the same open cycle', async () => {
      const enqueue = vi.fn().mockResolvedValue({ jobId: 'job_x', status: 'queued' });
      const mockApi = createMockApiClient({ syncJobs: { enqueue } });
      renderWithProviders(
        <TriggerSyncDialog connection={sampleConnection} open onOpenChange={vi.fn()} />,
        { apiClient: mockApi },
      );

      // First submit — default job (master.product.syncAll)
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
      await waitFor(() => {
        expect(enqueue).toHaveBeenCalledTimes(1);
      });

      // Switch job type and submit again — different jobType segment in the key
      const select = screen.getByRole('combobox', { name: /job type/i });
      fireEvent.change(select, { target: { value: 'master.inventory.syncAll' } });
      fireEvent.click(screen.getByRole('button', { name: /trigger/i }));
      await waitFor(() => {
        expect(enqueue).toHaveBeenCalledTimes(2);
      });

      const firstKey = (enqueue.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
      const secondKey = (enqueue.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
      // Full keys differ because the jobType segment differs (master.product vs master.inventory)
      expect(firstKey).not.toBe(secondKey);
      expect(firstKey).toContain(':master.product.syncAll:');
      expect(secondKey).toContain(':master.inventory.syncAll:');
      // UUID suffix is stable across the session
      const firstSuffix = firstKey.split(':').at(-1);
      const secondSuffix = secondKey.split(':').at(-1);
      expect(firstSuffix).toBe(secondSuffix);
    });
  });
});
