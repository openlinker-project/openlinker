/**
 * Content Editor — Smoke Tests
 *
 * Verifies the combined #339/#342 editor: renders master + channel tabs from
 * the state endpoint, invokes the save + publish mutations with the correct
 * payloads, and shows the suggestion dialog on demand.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentEditor } from './content-editor';
import {
  createMockApiClient,
  findToastDescription,
  renderWithProviders,
} from '../../../test/test-utils';
import type { ContentState } from '../api/content.types';

function makeState(overrides: Partial<ContentState> = {}): ContentState {
  return {
    productId: 'ol_product_1',
    master: {
      baseValue: 'Current master description',
      draftValue: null,
      hasConflict: false,
      updatedAt: '2026-04-20T10:00:00.000Z',
      updatedBy: 'admin@example.com',
    },
    channels: [
      {
        connectionId: 'conn_allegro_1',
        connectionName: 'Allegro PL',
        platformType: 'allegro',
        connectionStatus: 'active',
        baseValue: null,
        draftValue: 'Channel draft in progress',
        hasConflict: false,
        updatedAt: '2026-04-21T10:00:00.000Z',
        updatedBy: 'admin@example.com',
        linkedOfferCount: 3,
      },
    ],
    ...overrides,
  };
}

// Below 1024px editors render read-only. Mock useMediaQuery so Save/Publish
// are reachable in jsdom without wiring a full matchMedia polyfill.
vi.mock('../../../shared/ui/use-media-query', () => ({
  useMediaQuery: (): boolean => true,
}));

describe('ContentEditor', () => {
  afterEach(cleanup);

  it('renders master and channel tabs from the content state', async () => {
    const mockApi = createMockApiClient({
      content: { get: vi.fn().mockResolvedValue(makeState()) },
    });

    renderWithProviders(<ContentEditor productId="ol_product_1" />, { apiClient: mockApi });

    expect(await screen.findByRole('tab', { name: /Master/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Allegro PL/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Current master description')).toBeInTheDocument();
  });

  it('saves a draft for the master target with connectionId=null', async () => {
    const saveDraft = vi.fn().mockResolvedValue({
      id: 'field_1',
      productId: 'ol_product_1',
      connectionId: null,
      fieldKey: 'description',
      baseValue: 'Current master description',
      draftValue: 'New master draft',
      baseVersion: null,
      hasConflict: false,
      updatedAt: '2026-04-23T10:00:00.000Z',
      updatedBy: 'admin@example.com',
    });
    const mockApi = createMockApiClient({
      content: {
        get: vi.fn().mockResolvedValue(makeState()),
        saveDraft,
      },
    });

    renderWithProviders(<ContentEditor productId="ol_product_1" />, { apiClient: mockApi });

    const textarea = await screen.findByDisplayValue('Current master description');
    const user = userEvent.setup();
    await user.clear(textarea);
    await user.type(textarea, 'New master draft');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await findToastDescription('Draft saved');
    expect(saveDraft).toHaveBeenCalledWith('ol_product_1', {
      connectionId: null,
      fieldKey: 'description',
      value: 'New master draft',
    });
  });

  it('shows a conflict banner when the master target has hasConflict=true', async () => {
    const state = makeState({
      master: {
        baseValue: 'External version won',
        draftValue: 'Stale draft',
        hasConflict: true,
        updatedAt: '2026-04-22T10:00:00.000Z',
        updatedBy: 'admin@example.com',
      },
    });
    const mockApi = createMockApiClient({
      content: { get: vi.fn().mockResolvedValue(state) },
    });

    renderWithProviders(<ContentEditor productId="ol_product_1" />, { apiClient: mockApi });

    await screen.findByRole('tab', { name: /Master/ });
    expect(screen.getByText(/An external update was detected/)).toBeInTheDocument();
  });

  it('renders a retry error state when the query fails', async () => {
    const mockApi = createMockApiClient({
      content: {
        get: vi.fn().mockRejectedValue(new Error('boom')),
      },
    });

    renderWithProviders(<ContentEditor productId="ol_product_1" />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  describe('publish failure surfaces (#486)', () => {
    it('renders the structured error list when publish rejects with CHANNEL_PUBLISH_FAILED', async () => {
      const { ApiError } = await import('../../../shared/api/api-error');
      const stateWithPublishableMaster = makeState({
        master: {
          baseValue: 'old master',
          draftValue: 'new master draft',
          hasConflict: false,
          updatedAt: '2026-05-01T10:00:00.000Z',
          updatedBy: 'admin@example.com',
        },
      });
      const mockApi = createMockApiClient({
        content: {
          get: vi.fn().mockResolvedValue(stateWithPublishableMaster),
          publish: vi.fn().mockRejectedValue(
            new ApiError('Channel publish rejected by Allegro', 422, {
              message: 'Channel publish rejected by Allegro',
              code: 'CHANNEL_PUBLISH_FAILED',
              errors: [
                {
                  field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
                  code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
                  message:
                    'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
                },
              ],
            }),
          ),
        },
      });

      renderWithProviders(<ContentEditor productId="ol_product_1" />, { apiClient: mockApi });

      await screen.findByRole('tab', { name: /Master/ });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Publish' }));
      await user.click(screen.getByRole('button', { name: 'Publish' })); // confirm dialog

      // Translated message renders (RESPONSIBLE_PRODUCER_NOT_SPECIFIED is in the
      // translator allowlist).
      expect(await screen.findByText(/Responsible Producer entry/i)).toBeInTheDocument();
      // Field path renders as a copy-button breadcrumb.
      expect(
        screen.getByRole('button', {
          name: /Copy field path offer\.modules\.productSafety\.data\.productsData\[0\]\.responsibleProducer/i,
        }),
      ).toBeInTheDocument();
      // The bare-string "Allegro API error (422):" is NOT shown — that's the
      // collapsed-error regression #486 was filed to fix.
      expect(screen.queryByText(/Allegro API error \(422\):/)).toBeNull();
    });

    it('falls back to a bare-string Alert when publish rejects with a non-structured error', async () => {
      const stateWithPublishableMaster = makeState({
        master: {
          baseValue: 'old master',
          draftValue: 'new master draft',
          hasConflict: false,
          updatedAt: '2026-05-01T10:00:00.000Z',
          updatedBy: 'admin@example.com',
        },
      });
      const mockApi = createMockApiClient({
        content: {
          get: vi.fn().mockResolvedValue(stateWithPublishableMaster),
          publish: vi.fn().mockRejectedValue(new Error('plain old error')),
        },
      });

      renderWithProviders(<ContentEditor productId="ol_product_1" />, { apiClient: mockApi });

      await screen.findByRole('tab', { name: /Master/ });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Publish' }));
      await user.click(screen.getByRole('button', { name: 'Publish' }));

      expect(await screen.findByText('plain old error')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /allegro errors/i })).toBeNull();
    });
  });
});
