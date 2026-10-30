/**
 * DeliveryOnDocumentsPanel tests (#3908)
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { ApiClient } from '../../../app/api/api-client';
import type { Connection } from '../../connections';
import { DeliveryOnDocumentsPanel } from './delivery-on-documents-panel';

const PL_ROW = {
  name: 'Koszt dostawy',
  rate: 'goods',
  freeDelivery: 'omit',
  rateFormat: 'plain',
} as const;
const PL_SUGGESTION = {
  country: 'PL',
  defaultName: 'Koszt dostawy',
  nameSuggestions: ['Koszt dostawy', 'Dostawa'],
  rateMode: 'goods' as const,
  omitFreeDelivery: true,
  sources: [{ term: 'VAT rate follows the goods', text: 'Art. 29a.' }],
  sourceLabel: 'Dz.U.',
  sourceUrl: 'https://example.test',
  disclaimer: 'Not legal advice.',
};
const PL_FACT = {
  country: 'PL',
  orders30d: 57,
  ratesSeen: ['23', '5'],
  currency: 'PLN',
  example: {
    lines: [
      { name: 'Kubek', gross: 60, rate: '23' },
      { name: 'Ksiazka', gross: 40, rate: '5' },
    ],
    delivery: 15,
  },
};

function connectionWith(config: Record<string, unknown>): Connection {
  return { ...sampleConnection, id: 'alg_1', config };
}

function buildApi(
  config: Record<string, unknown>,
  extras: { suggestions?: unknown[]; facts?: unknown[]; update?: Mock } = {},
): ReturnType<typeof createMockApiClient> {
  const connection = connectionWith(config);
  return createMockApiClient({
    connections: {
      getById: vi.fn().mockResolvedValue(connection),
      update: (extras.update ??
        vi.fn().mockResolvedValue(connection)) as ApiClient['connections']['update'],
    },
    deliveryOnDocuments: {
      getSuggestions: vi.fn().mockResolvedValue({ suggestions: extras.suggestions ?? [] }),
      getCountryFacts: vi.fn().mockResolvedValue({ windowDays: 30, countries: extras.facts ?? [] }),
    },
  });
}

function renderPanel(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(<DeliveryOnDocumentsPanel connectionId="alg_1" />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter(),
  });
}

describe('DeliveryOnDocumentsPanel', () => {
  afterEach(cleanup);

  it('should render a row per configured country and the other-countries row', async () => {
    renderPanel(buildApi({ deliveryOnDocuments: { countries: { PL: PL_ROW } } }));

    expect(await screen.findByText('Poland')).toBeInTheDocument();
    expect(screen.getByText('All other countries')).toBeInTheDocument();
    expect(screen.getAllByText('Same as the products').length).toBeGreaterThan(0);
  });

  it('should keep other config keys when a country is added', async () => {
    const update = vi.fn().mockResolvedValue(connectionWith({}));
    const api = buildApi({ rateLimit: { maxConcurrent: 2 } }, { update, facts: [PL_FACT] });
    renderPanel(api);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add a country' }));
    const combobox = await screen.findByRole('combobox');
    fireEvent.change(combobox, { target: { value: 'Pol' } });
    fireEvent.click(await screen.findByRole('option', { name: /Poland/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add country' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const body = update.mock.calls[0][1] as { config: Record<string, unknown> };
    expect(body.config.rateLimit).toEqual({ maxConcurrent: 2 });
    expect(body.config.deliveryOnDocuments).toMatchObject({
      countries: { PL: { name: 'Shipping' } },
    });
  });

  it('should fill the first-run strip from the suggestion when Use them is pressed', async () => {
    const update = vi.fn().mockResolvedValue(connectionWith({}));
    renderPanel(buildApi({}, { update, suggestions: [PL_SUGGESTION], facts: [PL_FACT] }));

    expect(await screen.findByText(/Most of your orders go to Poland/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use them' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const body = update.mock.calls[0][1] as {
      config: { deliveryOnDocuments: { countries: Record<string, unknown> } };
    };
    expect(body.config.deliveryOnDocuments.countries.PL).toMatchObject({
      name: 'Koszt dostawy',
      rate: 'goods',
      freeDelivery: 'omit',
    });
  });

  it('should remove a country and keep the rest of the config', async () => {
    const update = vi.fn().mockResolvedValue(connectionWith({}));
    renderPanel(
      buildApi(
        {
          salesDocument: { documentKind: 'invoice' },
          deliveryOnDocuments: { countries: { PL: PL_ROW } },
        },
        { update },
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Poland' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Poland' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const body = update.mock.calls[0][1] as { config: Record<string, unknown> };
    expect(body.config.salesDocument).toEqual({ documentKind: 'invoice' });
    expect(body.config.deliveryOnDocuments).toBeUndefined();
  });

  it('should still render the table when suggestions and country facts fail', async () => {
    const api = buildApi({ deliveryOnDocuments: { countries: { PL: PL_ROW } } });
    api.deliveryOnDocuments.getSuggestions = vi.fn().mockRejectedValue(new Error('boom'));
    api.deliveryOnDocuments.getCountryFacts = vi.fn().mockRejectedValue(new Error('boom'));
    renderPanel(api);

    expect(await screen.findByText('Poland')).toBeInTheDocument();
    expect(screen.queryByText(/Most of your orders go to/)).not.toBeInTheDocument();
  });
});
