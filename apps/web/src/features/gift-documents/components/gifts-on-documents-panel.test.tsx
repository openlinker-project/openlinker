/**
 * GiftsOnDocumentsPanel and GiftDocumentsDefaultPanel tests (#3941)
 *
 * @module apps/web/src/features/gift-documents/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { ApiClient } from '../../../app/api/api-client';
import type { Connection } from '../../connections';
import { GiftDocumentsDefaultPanel } from './gift-documents-default-panel';
import { GiftsOnDocumentsPanel } from './gifts-on-documents-panel';

const RECEIPT_ONLY = [
  {
    connectionId: 'c',
    name: 'eparagony.pl',
    platformType: 'eparagony',
    kind: 'fiscal-receipt' as const,
    acceptsZeroValueLine: false,
  },
];
const ACCEPTS_ZERO = [
  {
    connectionId: 'a',
    name: 'KSeF',
    platformType: 'ksef',
    kind: 'invoice' as const,
    acceptsZeroValueLine: true,
  },
];

function connectionWith(config: Record<string, unknown>): Connection {
  return { ...sampleConnection, id: 'alg_1', config };
}

function buildApi(options: {
  config?: Record<string, unknown>;
  globalForm?: string;
  providers?: unknown[];
  update?: Mock;
  saveSettings?: Mock;
}): ReturnType<typeof createMockApiClient> {
  const connection = connectionWith(options.config ?? {});
  return createMockApiClient({
    connections: {
      getById: vi.fn().mockResolvedValue(connection),
      update: (options.update ??
        vi.fn().mockResolvedValue(connection)) as ApiClient['connections']['update'],
    },
    giftDocuments: {
      getSettings: vi.fn().mockResolvedValue({
        giftDocumentForm: options.globalForm ?? 'technical-cent',
        giftDocumentFormSource: options.globalForm ? 'setting' : 'default',
        updatedAt: null,
      }),
      getProviders: vi.fn().mockResolvedValue({ providers: options.providers ?? ACCEPTS_ZERO }),
      ...(options.saveSettings ? { saveSettings: options.saveSettings } : {}),
    },
  });
}

function renderConnection(
  apiClient: ReturnType<typeof createMockApiClient>,
  permissions?: string[],
): void {
  renderWithProviders(<GiftsOnDocumentsPanel connectionId="alg_1" />, {
    apiClient,
    sessionAdapter:
      permissions === undefined
        ? createAuthenticatedSessionAdapter()
        : createAuthenticatedSessionAdapter({
            id: 'u',
            username: 'v',
            email: 'v@example.com',
            role: 'viewer',
            permissions: permissions as never,
            analyticsConsent: true,
          }),
  });
}

describe('GiftsOnDocumentsPanel', () => {
  afterEach(cleanup);

  it('should default to "as in OpenLinker" naming the OpenLinker default form', async () => {
    renderConnection(buildApi({}));
    const inherit = await screen.findByTestId('doc-gift-set-option-inherit');
    expect(inherit).toBeChecked();
    expect(screen.getByText(/As in OpenLinker \(0\.01, from the most expensive\)/)).toBeInTheDocument();
  });

  it('should not name the default form while the OpenLinker-wide setting could not be read', async () => {
    const api = buildApi({});
    (api.giftDocuments.getSettings as Mock).mockRejectedValue(new Error('403'));
    renderConnection(api);

    const inherit = await screen.findByTestId('doc-gift-set-option-inherit');
    expect(inherit).toBeChecked();
    expect(screen.getByText(/As in OpenLinker \(not known yet\)/)).toBeInTheDocument();
    expect(screen.queryByText(/As in OpenLinker \(0\.01/)).not.toBeInTheDocument();
  });

  it('should show the receipt total equal to what was paid', async () => {
    renderConnection(buildApi({}));
    expect(await screen.findByTestId('doc-gift-set-preview-sum')).toBeInTheDocument();
    expect(screen.getByTestId('doc-gift-set-receipt')).toHaveTextContent('100.00 PLN');
  });

  it('should disable "Shown at 0.00" with a reason when no provider accepts a zero line', async () => {
    renderConnection(buildApi({ providers: RECEIPT_ONLY }));
    const zero = await screen.findByTestId('doc-gift-set-option-zero');
    expect(zero).toBeDisabled();
    expect(screen.getByTestId('doc-gift-set-option-zero-badge')).toBeInTheDocument();
    expect(screen.getByTestId('doc-gift-set-zero-note')).toHaveTextContent('eparagony.pl');
  });

  it('should offer "Shown at 0.00" where a provider accepts it', async () => {
    renderConnection(buildApi({}));
    expect(await screen.findByTestId('doc-gift-set-option-zero')).toBeEnabled();
  });

  it('should keep other config keys and write only the form when an override is saved', async () => {
    const update = vi.fn().mockResolvedValue(connectionWith({}));
    renderConnection(buildApi({ config: { rateLimit: { maxConcurrent: 2 } }, update }));
    fireEvent.click(await screen.findByTestId('doc-gift-set-option-priced-in'));
    fireEvent.click(screen.getByTestId('doc-gift-set-save'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toEqual({
      config: { rateLimit: { maxConcurrent: 2 }, giftOnDocuments: { form: 'priced-in' } },
    });
  });

  it('should drop the key when the channel goes back to inheriting', async () => {
    const update = vi.fn().mockResolvedValue(connectionWith({}));
    renderConnection(buildApi({ config: { giftOnDocuments: { form: 'omit' } }, update }));
    fireEvent.click(await screen.findByTestId('doc-gift-set-option-inherit'));
    fireEvent.click(screen.getByTestId('doc-gift-set-save'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toEqual({ config: {} });
  });

  it('should be read-only for a role without connection write access', async () => {
    renderConnection(buildApi({}), []);
    expect(await screen.findByTestId('doc-gift-set-readonly-notice')).toBeInTheDocument();
    expect(screen.getByTestId('doc-gift-set-option-priced-in')).toBeDisabled();
    expect(screen.queryByTestId('doc-gift-set-save')).not.toBeInTheDocument();
  });
});

describe('GiftDocumentsDefaultPanel', () => {
  afterEach(cleanup);

  it('should show technical-cent as the default and the bundle info line', async () => {
    renderWithProviders(<GiftDocumentsDefaultPanel />, {
      apiClient: buildApi({}),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    expect(await screen.findByTestId('doc-gift-set-option-grosz')).toBeChecked();
    expect(screen.getByTestId('doc-gift-set-bundle-info')).toHaveTextContent(
      'one line when all items share a VAT rate',
    );
    expect(screen.getByTestId('doc-gift-set-example')).toBeInTheDocument();
  });

  it('should save the chosen default', async () => {
    const saveSettings = vi.fn().mockResolvedValue({
      giftDocumentForm: 'omit',
      giftDocumentFormSource: 'setting',
      updatedAt: null,
    });
    renderWithProviders(<GiftDocumentsDefaultPanel />, {
      apiClient: buildApi({ saveSettings }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    fireEvent.click(await screen.findByTestId('doc-gift-set-option-omit'));
    fireEvent.click(screen.getByTestId('doc-gift-set-save'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('omit'));
  });

  it('should be read-only for a viewer', async () => {
    renderWithProviders(<GiftDocumentsDefaultPanel />, {
      apiClient: buildApi({}),
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u',
        username: 'v',
        email: 'v@example.com',
        role: 'viewer',
        permissions: [],
        analyticsConsent: true,
      }),
    });
    expect(await screen.findByTestId('doc-gift-set-readonly-notice')).toBeInTheDocument();
    expect(screen.getByTestId('doc-gift-set-save')).toBeDisabled();
  });
});
