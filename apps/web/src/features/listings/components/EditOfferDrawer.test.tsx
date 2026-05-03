/**
 * EditOfferDrawer Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { EditOfferDrawer } from './EditOfferDrawer';
import type { OfferMapping } from '../api/listings.types';

const mockMapping: OfferMapping = {
  id: 'row-1',
  entityType: 'Offer',
  internalId: 'ol_offer_abc123',
  externalId: 'allegro-offer-999',
  platformType: 'allegro',
  connectionId: 'conn-1',
  context: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderDrawer(
  isOpen: boolean,
  overrides: Parameters<typeof createMockApiClient>[0] = {},
  onClose = vi.fn(),
  mapping: OfferMapping = mockMapping,
) {
  const mockApi = createMockApiClient(overrides);
  renderWithProviders(
    <EditOfferDrawer isOpen={isOpen} onClose={onClose} mapping={mapping} />,
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
    expect(await findToastTitle(/update dispatched/i)).toBeInTheDocument();
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

  describe('AI suggest (#485)', () => {
    it('should render the Suggest button when linkedProductId and platformType resolve to a channel', () => {
      const mappingWithLink: OfferMapping = {
        ...mockMapping,
        linkedProductId: 'ol_product_xyz789',
      };
      renderDrawer(true, {}, undefined, mappingWithLink);
      expect(
        screen.getByRole('button', { name: /suggest with ai/i }),
      ).toBeInTheDocument();
    });

    it('should show a hint instead of the Suggest button when no variant is linked', () => {
      const mappingWithoutLink: OfferMapping = { ...mockMapping, linkedProductId: null };
      renderDrawer(true, {}, undefined, mappingWithoutLink);
      expect(
        screen.queryByRole('button', { name: /suggest with ai/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/link this offer to a product variant/i)).toBeInTheDocument();
    });

    it('should populate description and mark form dirty when applying a suggestion (#485)', async () => {
      const suggest = vi.fn().mockResolvedValue({
        suggestion: 'Generated copy',
        requestId: 'req-1',
        templateKey: 'offer.description.suggest',
        templateVersion: 1,
        templateChannel: 'allegro',
        modelUsed: 'fake',
        latencyMs: 0,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      });
      const mappingWithLink: OfferMapping = {
        ...mockMapping,
        linkedProductId: 'ol_product_xyz789',
      };
      renderDrawer(true, { content: { suggest } }, undefined, mappingWithLink);

      // Save is disabled while pristine.
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /suggest with ai/i }));
      fireEvent.click(await screen.findByRole('button', { name: /^generate$/i }));

      const applyButton = await screen.findByRole('button', { name: /apply to editor/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        const textarea = screen.getByLabelText(/description/i);
        expect(textarea).toHaveValue('Generated copy');
      });
      // Apply must mark the form dirty so Save activates.
      expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
    });

    it('should show the offer-scope warning copy inside the suggestion dialog (#485)', async () => {
      const mappingWithLink: OfferMapping = {
        ...mockMapping,
        linkedProductId: 'ol_product_xyz789',
      };
      renderDrawer(true, {}, undefined, mappingWithLink);

      fireEvent.click(screen.getByRole('button', { name: /suggest with ai/i }));

      expect(await screen.findByText(/this offer only/i)).toBeInTheDocument();
      expect(
        screen.getByText(/does not update the product master/i),
      ).toBeInTheDocument();
    });
  });
});
