/**
 * OfferCreationTracker Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { OfferCreationTracker } from './OfferCreationTracker';
import type { OfferCreationStatus, OfferCreationStatusResponse } from '../api/listings.types';

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
    expect(screen.getByText('parameters.EAN')).toBeInTheDocument();
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
});
