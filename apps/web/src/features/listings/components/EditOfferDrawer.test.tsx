/**
 * EditOfferDrawer Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { EditOfferDrawer } from './EditOfferDrawer';
import type { OfferMapping } from '../api/listings.types';

const mockMapping: OfferMapping = {
  id: 'row-1',
  entityType: 'Offer',
  internalId: 'ol_offer_abc123',
  externalId: 'allegro-offer-999',
  platformType: 'Allegro',
  connectionId: 'conn-1',
  context: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderDrawer(
  isOpen: boolean,
  overrides: Parameters<typeof createMockApiClient>[0] = {},
  onClose = vi.fn(),
) {
  const mockApi = createMockApiClient(overrides);
  renderWithProviders(
    <EditOfferDrawer isOpen={isOpen} onClose={onClose} mapping={mockMapping} />,
    { apiClient: mockApi },
  );
  return { mockApi, onClose };
}

describe('EditOfferDrawer', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('should not render when closed', () => {
    renderDrawer(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should render title, price, and description fields when open', () => {
    renderDrawer(true);
    expect(screen.getByRole('dialog', { name: 'Edit offer' })).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('should disable save button when form is pristine', () => {
    renderDrawer(true);
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('should enable save button when a field is dirty', () => {
    renderDrawer(true);
    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('should show validation error when title exceeds 75 characters', async () => {
    renderDrawer(true);
    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'A'.repeat(76) } });
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);
    expect((await screen.findAllByText(/75 characters/i)).length).toBeGreaterThan(0);
  });

  it('should only include dirty fields in the API request payload', async () => {
    const updateOfferFields = vi.fn().mockResolvedValue({ jobId: 'job-1' });
    renderDrawer(true, { listings: { updateOfferFields } });

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateOfferFields).toHaveBeenCalledWith(
        'conn-1',
        'ol_offer_abc123',
        expect.not.objectContaining({ price: expect.anything() }),
      );
      expect(updateOfferFields).toHaveBeenCalledWith(
        'conn-1',
        'ol_offer_abc123',
        expect.objectContaining({ title: 'Updated title' }),
      );
    });
  });

  it('should show success toast and close drawer on successful submit', async () => {
    const onClose = vi.fn();
    const updateOfferFields = vi.fn().mockResolvedValue({ jobId: 'job-42' });
    const mockApi = createMockApiClient({ listings: { updateOfferFields } });
    renderWithProviders(
      <EditOfferDrawer isOpen={true} onClose={onClose} mapping={mockMapping} />,
      { apiClient: mockApi },
    );

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'My new title' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(await screen.findByText(/update dispatched/i)).toBeInTheDocument();
  });

  it('should show inline error and not close drawer on API failure', async () => {
    const onClose = vi.fn();
    const updateOfferFields = vi.fn().mockRejectedValue(new Error('Allegro API error'));
    const mockApi = createMockApiClient({ listings: { updateOfferFields } });
    renderWithProviders(
      <EditOfferDrawer isOpen={true} onClose={onClose} mapping={mockMapping} />,
      { apiClient: mockApi },
    );

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'My title' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/update failed/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
