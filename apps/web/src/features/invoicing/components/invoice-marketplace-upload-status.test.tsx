/**
 * InvoiceMarketplaceUploadStatus tests (#3549)
 *
 * The retry button is an ADMIN affordance (the route is admin-only), and a
 * failed read must never render as the empty "nothing attempted" state.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { InvoiceMarketplaceUploadStatus } from './invoice-marketplace-upload-status';

afterEach(cleanup);

const entry = (overrides: Record<string, unknown> = {}) => ({
  targetConnectionId: 'conn-1',
  status: 'failed',
  lastFailureCode: 'transient',
  attempts: 1,
  uploadedAt: null,
  ...overrides,
});

const api = (uploads: unknown[]) =>
  createMockApiClient({
    invoicing: {
      getMarketplaceUpload: vi.fn().mockResolvedValue({ invoiceId: 'inv-1', uploads }),
      retryMarketplaceUpload: vi.fn().mockResolvedValue({ queued: true }),
    },
  });

describe('InvoiceMarketplaceUploadStatus', () => {
  it('should render nothing when no upload was attempted', async () => {
    renderWithProviders(<InvoiceMarketplaceUploadStatus invoiceId="inv-1" />, {
      apiClient: api([]),
    });

    await Promise.resolve();
    expect(screen.queryByTestId('marketplace-upload')).not.toBeInTheDocument();
  });

  it('should show an uploaded document as on the marketplace order', async () => {
    renderWithProviders(<InvoiceMarketplaceUploadStatus invoiceId="inv-1" />, {
      apiClient: api([entry({ status: 'uploaded', lastFailureCode: null })]),
    });

    expect(await screen.findByText('On the marketplace order')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('should offer a retry to an admin for a retryable failure and queue it', async () => {
    const apiClient = api([entry()]);
    renderWithProviders(<InvoiceMarketplaceUploadStatus invoiceId="inv-1" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(apiClient.invoicing.retryMarketplaceUpload).toHaveBeenCalledWith('inv-1');
  });

  it('should not offer a retry to a non-admin', async () => {
    renderWithProviders(<InvoiceMarketplaceUploadStatus invoiceId="inv-1" />, {
      apiClient: api([entry()]),
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'op',
        email: 'op@example.com',
        role: 'operator',
        permissions: ['invoices:write'],
        analyticsConsent: true,
      } as never),
    });

    expect(await screen.findByText('Not delivered to marketplace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('should not offer a retry for a refusal the marketplace will repeat', async () => {
    renderWithProviders(<InvoiceMarketplaceUploadStatus invoiceId="inv-1" />, {
      apiClient: api([entry({ lastFailureCode: 'rejected' })]),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText(/refused the file/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('should report an unreadable status instead of showing the empty state', async () => {
    const apiClient = createMockApiClient({
      invoicing: { getMarketplaceUpload: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    renderWithProviders(<InvoiceMarketplaceUploadStatus invoiceId="inv-1" />, { apiClient });

    expect(await screen.findByTestId('marketplace-upload-unreadable')).toBeInTheDocument();
  });
});
