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
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
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
        supportedCapabilities: ['Marketplace' as const],
        enabledCapabilities: ['Marketplace' as const],
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
              new RegExp(`^manual:${sampleConnection.id}:master\\.product\\.syncAll:\\d+$`),
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

      expect(screen.getByText(/sync job enqueued/i)).toBeInTheDocument();
      expect(screen.getByText(/job_42/i)).toBeInTheDocument();
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
});
