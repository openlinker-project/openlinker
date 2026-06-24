/**
 * OfferCreationTracker Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { OfferCreationTracker } from './OfferCreationTracker';
import type {
  CreateOfferRequest,
  OfferCreationStatus,
  OfferCreationStatusResponse,
} from '../api/listings.types';

const sampleRequest: CreateOfferRequest = {
  internalVariantId: 'ol_variant_abc',
  stock: 5,
  publishImmediately: false,
  price: { amount: 99.99, currency: 'PLN' },
  overrides: { title: 'T', categoryId: '12345' },
};

function makeRecord(status: OfferCreationStatus, overrides: Partial<OfferCreationStatusResponse> = {}): OfferCreationStatusResponse {
  return {
    id: 'rec-1',
    connectionId: 'conn-1',
    internalVariantId: 'ol_variant_abc',
    externalOfferId: status === 'active' ? 'allegro-999' : null,
    status,
    errors: status === 'failed' ? [{ code: 'X', message: 'boom' }] : null,
    publishImmediately: false,
    createdAt: '2026-04-22T10:00:00Z',
    updatedAt: '2026-04-22T10:00:00Z',
    request: null,
    ...overrides,
  };
}

describe('OfferCreationTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the pending status and the record id', async () => {
    const mockApi = createMockApiClient({
      listings: { getOfferCreationStatus: vi.fn().mockResolvedValue(makeRecord('pending')) },
    });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={vi.fn()} />,
      { apiClient: mockApi },
    );

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('rec-1')).toBeInTheDocument();
  });

  it('renders the active state with the external offer id', async () => {
    const mockApi = createMockApiClient({
      listings: { getOfferCreationStatus: vi.fn().mockResolvedValue(makeRecord('active')) },
    });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={vi.fn()} />,
      { apiClient: mockApi },
    );

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('allegro-999')).toBeInTheDocument();
    // Dismiss is visible on a terminal status
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('renders the reused state (already existed) with the external offer id', async () => {
    const mockApi = createMockApiClient({
      listings: {
        getOfferCreationStatus: vi
          .fn()
          .mockResolvedValue(makeRecord('reused', { externalOfferId: 'erli-sku-1' })),
      },
    });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={vi.fn()} />,
      { apiClient: mockApi },
    );

    expect(await screen.findByText('Already existed')).toBeInTheDocument();
    expect(screen.getByText(/reused the existing listing/i)).toBeInTheDocument();
    expect(screen.getByText('erli-sku-1')).toBeInTheDocument();
    // Reused is terminal → Dismiss is visible.
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('renders the error list on failed status', async () => {
    const mockApi = createMockApiClient({
      listings: {
        getOfferCreationStatus: vi
          .fn()
          .mockResolvedValue(
            makeRecord('failed', {
              errors: [
                { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
              ],
            }),
          ),
      },
    });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={vi.fn()} />,
      { apiClient: mockApi },
    );

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    // Field path renders as a breadcrumb copy-button (#486 design refresh).
    expect(screen.getByRole('button', { name: /Copy field path parameters\.EAN/i })).toBeInTheDocument();
    expect(screen.getByText('EAN is required.')).toBeInTheDocument();
  });

  it('stops polling on a terminal status (does not fetch again)', async () => {
    const getOfferCreationStatus = vi.fn().mockResolvedValue(makeRecord('active'));
    const mockApi = createMockApiClient({ listings: { getOfferCreationStatus } });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={vi.fn()} />,
      { apiClient: mockApi },
    );

    await screen.findByText('Active');
    // Give any scheduled refetchInterval a generous window to fire; it shouldn't.
    await new Promise((r) => setTimeout(r, 50));
    expect(getOfferCreationStatus).toHaveBeenCalledTimes(1);
  });

  it('shows a dismiss button only for terminal statuses', async () => {
    const mockApi = createMockApiClient({
      listings: { getOfferCreationStatus: vi.fn().mockResolvedValue(makeRecord('pending')) },
    });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={vi.fn()} />,
      { apiClient: mockApi },
    );

    await screen.findByText('Pending');
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('invokes onDismiss when the dismiss button is clicked on a terminal status', async () => {
    const onDismiss = vi.fn();
    const mockApi = createMockApiClient({
      listings: { getOfferCreationStatus: vi.fn().mockResolvedValue(makeRecord('failed')) },
    });

    renderWithProviders(
      <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" onDismiss={onDismiss} />,
      { apiClient: mockApi },
    );

    const dismiss = await screen.findByRole('button', { name: /dismiss/i });
    dismiss.click();
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  describe('read-only consumers (no onDismiss)', () => {
    it('renders the failed-status content without a Dismiss button when onDismiss is omitted', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi.fn().mockResolvedValue(
            makeRecord('failed', {
              errors: [{ field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' }],
            }),
          ),
        },
      });

      renderWithProviders(
        <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" />,
        { apiClient: mockApi },
      );

      // Status, error, and id all render — content is identical to the with-onDismiss path.
      expect(await screen.findByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('EAN is required.')).toBeInTheDocument();
      expect(screen.getByText('rec-1')).toBeInTheDocument();
      // …but the terminal-status Dismiss button is suppressed.
      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('renders nothing when the status fetch errors and onDismiss is omitted', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi.fn().mockRejectedValue(new Error('Boom')),
        },
      });

      const { container } = renderWithProviders(
        <OfferCreationTracker connectionId="conn-1" offerCreationRecordId="rec-1" />,
        { apiClient: mockApi },
      );

      // Wait for the query to settle. The component must render no error UI
      // and no Dismiss button — read-only consumers can't act on errors.
      await waitFor(() => {
        expect(screen.queryByText(/unable to load status/i)).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
      expect(container.querySelector('.offer-creation-tracker--error')).toBeNull();
    });
  });

  describe('retry affordance (#307)', () => {
    it('renders Retry on a failed record when onRetry is provided and a request snapshot exists', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi
            .fn()
            .mockResolvedValue(makeRecord('failed', { request: sampleRequest })),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
          onRetry={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('invokes onRetry with the record when Retry is clicked', async () => {
      const onRetry = vi.fn();
      const record = makeRecord('failed', { request: sampleRequest });
      const mockApi = createMockApiClient({
        listings: { getOfferCreationStatus: vi.fn().mockResolvedValue(record) },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
          onRetry={onRetry}
        />,
        { apiClient: mockApi },
      );

      const retry = await screen.findByRole('button', { name: /retry/i });
      retry.click();
      await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
      expect(onRetry).toHaveBeenCalledWith(record);
    });

    it('hides Retry when onRetry is not provided', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi
            .fn()
            .mockResolvedValue(makeRecord('failed', { request: sampleRequest })),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await screen.findByText('Failed');
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('hides Retry when the failed record has no request snapshot', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi
            .fn()
            .mockResolvedValue(makeRecord('failed', { request: null })),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
          onRetry={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await screen.findByText('Failed');
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('hides Retry when the snapshot carries an unknown schemaVersion', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi.fn().mockResolvedValue(
            makeRecord('failed', {
              request: { ...sampleRequest, schemaVersion: 99 },
            }),
          ),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
          onRetry={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await screen.findByText('Failed');
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('does not render Retry on a non-failed status', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi
            .fn()
            .mockResolvedValue(makeRecord('active', { request: sampleRequest })),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
          onRetry={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await screen.findByText('Active');
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });
  });

  describe('draft status (#407)', () => {
    it('renders external id, sandbox seller-panel link, and the error list when errors are present', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi.fn().mockResolvedValue(
            makeRecord('draft', {
              externalOfferId: 'allegro-555',
              errors: [
                { field: 'parameters.42', code: 'MissingValue', message: 'Brand is required.' },
              ],
            }),
          ),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          marketplacePlatformType="allegro"
          marketplaceEnvironment="sandbox"
          onDismiss={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      expect(await screen.findByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('allegro-555')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /open in allegro seller panel/i });
      expect(link).toHaveAttribute(
        'href',
        'https://allegro.pl.allegrosandbox.pl/oferta/allegro-555/edit',
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByText('Brand is required.')).toBeInTheDocument();
    });

    it('renders the production seller-panel link and "no inline validation issues" copy when errors are empty', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi.fn().mockResolvedValue(
            makeRecord('draft', { externalOfferId: 'allegro-777', errors: null }),
          ),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          marketplacePlatformType="allegro"
          marketplaceEnvironment="production"
          onDismiss={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      expect(await screen.findByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('allegro-777')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /open in allegro seller panel/i })).toHaveAttribute(
        'href',
        'https://allegro.pl/oferta/allegro-777/edit',
      );
      expect(
        screen.getByText(/no inline validation issues/i),
      ).toBeInTheDocument();
    });

    it('renders the draft body without an id or seller-panel link when externalOfferId is null and props are omitted', async () => {
      const mockApi = createMockApiClient({
        listings: {
          getOfferCreationStatus: vi.fn().mockResolvedValue(
            makeRecord('draft', { externalOfferId: null, errors: null }),
          ),
        },
      });

      renderWithProviders(
        <OfferCreationTracker
          connectionId="conn-1"
          offerCreationRecordId="rec-1"
          onDismiss={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      expect(await screen.findByText('Draft')).toBeInTheDocument();
      expect(screen.getByText(/offer created as a draft on allegro/i)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /open in allegro seller panel/i })).not.toBeInTheDocument();
      expect(
        screen.getByText(/no inline validation issues/i),
      ).toBeInTheDocument();
    });
  });
});
