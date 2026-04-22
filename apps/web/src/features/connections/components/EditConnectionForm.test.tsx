import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../api/connections.types';
import { EditConnectionForm } from './EditConnectionForm';

const PRESTASHOP_UUID_1 = '11111111-1111-4111-8111-111111111111';
const PRESTASHOP_UUID_2 = '22222222-2222-4222-8222-222222222222';
const ALLEGRO_UUID = '33333333-3333-4333-8333-333333333333';

// UUID-shaped candidate fixtures — the Zod schema rejects non-UUIDs, so the
// shared `sampleConnection.id = 'conn_1'` can't be used directly once the
// marketplace branch mounts.
const candidatePrestashop: Connection = {
  ...sampleConnection,
  id: PRESTASHOP_UUID_1,
  name: 'Main PrestaShop Store',
};

const secondPrestashop: Connection = {
  ...sampleConnection,
  id: PRESTASHOP_UUID_2,
  name: 'Second PrestaShop',
};

const allegroConnection: Connection = {
  ...sampleConnection,
  id: ALLEGRO_UUID,
  name: 'Allegro sandbox',
  platformType: 'allegro',
  config: { environment: 'sandbox' },
  enabledCapabilities: ['OfferManager', 'OrderProcessorManager'],
  supportedCapabilities: ['OfferManager', 'OrderProcessorManager'],
  adapterKey: 'allegro.publicapi.v1',
};

/**
 * Build an api client mock where `connections.list` returns the given set of
 * candidates (shapes the ProductMaster dropdown in the marketplace branch).
 */
function apiClientWithCandidates(
  candidates: Connection[],
  overrides: Parameters<typeof createMockApiClient>[0] = {},
): ReturnType<typeof createMockApiClient> {
  // Helper's `list` mock wins over any `overrides.connections.list` — the
  // helper's purpose is to inject candidates, so callers pass overrides for
  // other endpoints (`update`, etc.) and don't expect them to silently replace
  // the candidate list.
  return createMockApiClient({
    ...overrides,
    connections: {
      ...overrides.connections,
      list: vi.fn().mockResolvedValue(candidates),
    },
  });
}

describe('EditConnectionForm', () => {
  afterEach(cleanup);

  it('renders pre-filled form fields from the connection', () => {
    renderWithProviders(<EditConnectionForm connection={sampleConnection} />);

    expect(screen.getByDisplayValue(sampleConnection.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(sampleConnection.platformType)).toBeInTheDocument();
    expect(screen.getByText('Rotate webservice key')).toBeInTheDocument();
  });

  it('shows platform type as disabled and credentials behind a rotate button', () => {
    renderWithProviders(<EditConnectionForm connection={sampleConnection} />);

    const platformInput = screen.getByDisplayValue(sampleConnection.platformType);
    expect(platformInput).toBeDisabled();
    expect(screen.getByText('Rotate webservice key')).toBeInTheDocument();
    // The internal credential reference must not be exposed in the UI.
    expect(screen.queryByDisplayValue('db:')).not.toBeInTheDocument();
  });

  it('submits the update with changed values', async () => {
    const updateFn = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({
      connections: { update: updateFn, getById: vi.fn().mockResolvedValue(sampleConnection) },
    });

    renderWithProviders(<EditConnectionForm connection={sampleConnection} />, { apiClient });

    const nameInput = screen.getByDisplayValue(sampleConnection.name);
    fireEvent.change(nameInput, { target: { value: 'Updated Store' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateFn).toHaveBeenCalledWith(sampleConnection.id, expect.objectContaining({
        name: 'Updated Store',
      }));
    });
  });

  it('shows validation errors in summary after submit attempt', async () => {
    const connectionWithBadConfig = { ...sampleConnection, config: {}, name: '' };
    renderWithProviders(<EditConnectionForm connection={connectionWithBadConfig} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const errors = await screen.findAllByText('Connection name is required');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('shows API error when update fails', async () => {
    const apiClient = createMockApiClient({
      connections: {
        update: vi.fn().mockRejectedValue(new Error('Server error')),
        getById: vi.fn().mockResolvedValue(sampleConnection),
      },
    });

    renderWithProviders(<EditConnectionForm connection={sampleConnection} />, { apiClient });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Server error')).toBeInTheDocument();
  });

  describe('structured PrestaShop inputs + raw JSON toggle', () => {
    it('renders Shop URL / Storefront URL / Shop ID inputs for a PrestaShop connection', () => {
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />);
      expect(screen.getByLabelText('Shop URL')).toHaveValue('https://example.com');
      expect(screen.getByLabelText('Storefront URL (optional)')).toHaveValue('');
      expect(screen.getByLabelText('Shop ID (optional)')).toHaveValue('');
    });

    it('keeps the raw JSON textarea hidden by default and reveals it via the toggle', () => {
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />);
      expect(screen.queryByLabelText('Config JSON')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Show raw config JSON' }));

      expect(screen.getByLabelText('Config JSON')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide raw config JSON' })).toBeInTheDocument();
    });

    it('syncs structured Storefront URL edits into the underlying Config JSON payload', async () => {
      const connectionWithStorefront: Connection = {
        ...sampleConnection,
        config: { baseUrl: 'https://api.example.com', storefrontBaseUrl: 'https://example.com' },
      };
      const updateFn = vi.fn().mockResolvedValue(connectionWithStorefront);
      const apiClient = createMockApiClient({ connections: { update: updateFn } });
      renderWithProviders(<EditConnectionForm connection={connectionWithStorefront} />, { apiClient });

      expect(screen.getByLabelText('Storefront URL (optional)')).toHaveValue('https://example.com');

      fireEvent.change(screen.getByLabelText('Storefront URL (optional)'), {
        target: { value: 'https://new-storefront.example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalledWith(
          connectionWithStorefront.id,
          expect.objectContaining({
            config: {
              baseUrl: 'https://api.example.com',
              storefrontBaseUrl: 'https://new-storefront.example.com',
            },
          }),
        );
      });
    });

    it('removes storefrontBaseUrl from config when the field is cleared', async () => {
      const connectionWithStorefront: Connection = {
        ...sampleConnection,
        config: { baseUrl: 'https://api.example.com', storefrontBaseUrl: 'https://example.com' },
      };
      const updateFn = vi.fn().mockResolvedValue(connectionWithStorefront);
      const apiClient = createMockApiClient({ connections: { update: updateFn } });
      renderWithProviders(<EditConnectionForm connection={connectionWithStorefront} />, { apiClient });

      fireEvent.change(screen.getByLabelText('Storefront URL (optional)'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalled();
      });
      const [, payload] = updateFn.mock.calls[0] as [string, { config: Record<string, unknown> }];
      expect(payload.config).toEqual({ baseUrl: 'https://api.example.com' });
      expect('storefrontBaseUrl' in payload.config).toBe(false);
    });

    it('syncs structured Shop URL edits into the underlying Config JSON payload', async () => {
      const updateFn = vi.fn().mockResolvedValue(sampleConnection);
      const apiClient = createMockApiClient({ connections: { update: updateFn } });
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />, { apiClient });

      fireEvent.change(screen.getByLabelText('Shop URL'), {
        target: { value: 'https://new.example.com' },
      });
      fireEvent.change(screen.getByLabelText('Shop ID (optional)'), {
        target: { value: '7' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalledWith(
          sampleConnection.id,
          expect.objectContaining({
            config: { baseUrl: 'https://new.example.com', shopId: '7' },
          }),
        );
      });
    });

    it('preserves unknown config keys when structured inputs are edited', async () => {
      const connectionWithExtras = {
        ...sampleConnection,
        config: { baseUrl: 'https://example.com', customFlag: true, nested: { ok: 1 } },
      };
      const updateFn = vi.fn().mockResolvedValue(connectionWithExtras);
      const apiClient = createMockApiClient({ connections: { update: updateFn } });
      renderWithProviders(<EditConnectionForm connection={connectionWithExtras} />, { apiClient });

      fireEvent.change(screen.getByLabelText('Shop URL'), {
        target: { value: 'https://rotated.example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalledWith(
          sampleConnection.id,
          expect.objectContaining({
            config: {
              baseUrl: 'https://rotated.example.com',
              customFlag: true,
              nested: { ok: 1 },
            },
          }),
        );
      });
    });

    it('locks the structured inputs and surfaces a warning when raw JSON is invalid', () => {
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show raw config JSON' }));

      fireEvent.change(screen.getByLabelText('Config JSON'), {
        target: { value: '{ not: valid json' },
      });

      expect(screen.getByText('Raw JSON is invalid')).toBeInTheDocument();
      expect(screen.getByLabelText('Shop URL')).toBeDisabled();
      expect(screen.getByLabelText('Storefront URL (optional)')).toBeDisabled();
      expect(screen.getByLabelText('Shop ID (optional)')).toBeDisabled();
    });
  });

  describe('marketplace branch — Product catalog connection picker', () => {
    it('renders the catalog picker for an Allegro connection and hides it for PrestaShop', async () => {
      const apiClient = apiClientWithCandidates([candidatePrestashop]);
      const { rerender } = renderWithProviders(
        <EditConnectionForm connection={allegroConnection} />,
        { apiClient },
      );

      expect(await screen.findByLabelText('Product catalog connection')).toBeInTheDocument();
      expect(screen.queryByLabelText('Shop URL')).toBeNull();

      rerender(<EditConnectionForm connection={sampleConnection} />);
      expect(screen.queryByLabelText('Product catalog connection')).toBeNull();
      expect(screen.getByLabelText('Shop URL')).toBeInTheDocument();
    });

    it('auto-selects the only ProductMaster candidate when config has no stored value', async () => {
      const apiClient = apiClientWithCandidates([candidatePrestashop]);
      renderWithProviders(<EditConnectionForm connection={allegroConnection} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      await waitFor(() => {
        expect(picker.value).toBe(candidatePrestashop.id);
      });
    });

    it('does NOT auto-select when config has an explicit "" opt-out', async () => {
      const apiClient = apiClientWithCandidates([candidatePrestashop]);
      const optedOut: Connection = {
        ...allegroConnection,
        config: { environment: 'sandbox', masterCatalogConnectionId: '' },
      };
      renderWithProviders(<EditConnectionForm connection={optedOut} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      // Give the auto-select effect a chance to fire if it incorrectly would.
      await waitFor(() => {
        expect(picker).toBeInTheDocument();
      });
      expect(picker.value).toBe('');
    });

    it('does NOT auto-select when 2+ ProductMaster candidates exist', async () => {
      const apiClient = apiClientWithCandidates([candidatePrestashop, secondPrestashop]);
      renderWithProviders(<EditConnectionForm connection={allegroConnection} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      // Both candidates should be rendered as options, but none pre-selected.
      await waitFor(() => {
        expect(picker.querySelectorAll('option').length).toBeGreaterThanOrEqual(3); // None + 2 candidates
      });
      expect(picker.value).toBe('');
    });

    it('auto-select runs at most once: operator clearing after auto-fill stays cleared', async () => {
      // Realistic operator-override path — the Select is disabled during
      // `isLoading`, so interaction before candidates resolve isn't physically
      // possible. The guard we care about is: after auto-select fires once, the
      // operator can pick "None" (matching the default) and the effect must NOT
      // re-fire. This exercises both the run-once ref AND the operator-touched
      // ref, since RHF's `dirtyFields` would clear once value == default.
      const apiClient = apiClientWithCandidates([candidatePrestashop]);
      renderWithProviders(<EditConnectionForm connection={allegroConnection} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      // Wait for the auto-fill to land.
      await waitFor(() => {
        expect(picker.value).toBe(candidatePrestashop.id);
      });
      // Operator clears the selection.
      fireEvent.change(picker, { target: { value: '' } });
      await waitFor(() => {
        expect(picker.value).toBe('');
      });
      // Give any trailing effects a render cycle.
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Auto-select MUST NOT re-fire.
      expect(picker.value).toBe('');
    });

    it('auto-select does not flip form dirty state (Save changes submits unchanged config)', async () => {
      const updateFn = vi.fn().mockResolvedValue(allegroConnection);
      const apiClient = apiClientWithCandidates([candidatePrestashop], {
        connections: { update: updateFn },
      });
      renderWithProviders(<EditConnectionForm connection={allegroConnection} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      await waitFor(() => {
        expect(picker.value).toBe(candidatePrestashop.id);
      });

      // The Save button stays enabled (not gated on dirty), and the submit handler
      // fires with the auto-filled value — proving the form committed the value
      // WITHOUT relying on dirty state being flipped.
      const saveButton = screen.getByRole('button', { name: 'Save changes' });
      expect(saveButton).not.toBeDisabled();
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalled();
      });
      const [, payload] = updateFn.mock.calls[0] as [string, { config: Record<string, unknown> }];
      expect(payload.config).toEqual({
        environment: 'sandbox',
        masterCatalogConnectionId: candidatePrestashop.id,
      });
    });

    it('renders a stale-pointer error when config references a missing ProductMaster', async () => {
      const apiClient = apiClientWithCandidates([]); // No candidates — stored UUID is stale.
      const staleId = '00000000-0000-4000-8000-000000000000';
      const stale: Connection = {
        ...allegroConnection,
        config: { environment: 'sandbox', masterCatalogConnectionId: staleId },
      };
      renderWithProviders(<EditConnectionForm connection={stale} />, { apiClient });

      expect(await screen.findByText('Linked catalog is missing')).toBeInTheDocument();
      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      const missingOption = picker.querySelector(`option[value="${staleId}"]`);
      expect(missingOption).not.toBeNull();
      expect(missingOption?.hasAttribute('disabled')).toBe(true);
    });

    it('locks the Select when raw JSON is unparseable', async () => {
      const apiClient = apiClientWithCandidates([candidatePrestashop]);
      renderWithProviders(<EditConnectionForm connection={allegroConnection} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      await waitFor(() => {
        expect(picker.value).toBe(candidatePrestashop.id);
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show raw config JSON' }));
      fireEvent.change(screen.getByLabelText('Config JSON'), {
        target: { value: '{ not: valid json' },
      });

      expect(screen.getByText('Raw JSON is invalid')).toBeInTheDocument();
      expect(picker).toBeDisabled();
    });

    it('submits the picked value and preserves other config keys', async () => {
      const updateFn = vi.fn().mockResolvedValue(allegroConnection);
      const apiClient = apiClientWithCandidates([candidatePrestashop, secondPrestashop], {
        connections: { update: updateFn },
      });
      renderWithProviders(<EditConnectionForm connection={allegroConnection} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      await waitFor(() => {
        expect(picker.querySelectorAll('option').length).toBeGreaterThanOrEqual(3);
      });
      fireEvent.change(picker, { target: { value: secondPrestashop.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalledWith(
          allegroConnection.id,
          expect.objectContaining({
            config: {
              environment: 'sandbox',
              masterCatalogConnectionId: secondPrestashop.id,
            },
          }),
        );
      });
    });

    it('persists "" when the operator picks None (preserves explicit opt-out, does not delete the key)', async () => {
      const updateFn = vi.fn().mockResolvedValue(allegroConnection);
      const apiClient = apiClientWithCandidates([candidatePrestashop, secondPrestashop], {
        connections: { update: updateFn },
      });
      const linked: Connection = {
        ...allegroConnection,
        config: { environment: 'sandbox', masterCatalogConnectionId: candidatePrestashop.id },
      };
      renderWithProviders(<EditConnectionForm connection={linked} />, { apiClient });

      const picker = await screen.findByLabelText<HTMLSelectElement>(
        'Product catalog connection',
      );
      // Wait for candidates to render so the None option can actually be picked
      // against a controlled select whose DOM value is the stored UUID.
      await waitFor(() => {
        expect(picker.querySelectorAll('option').length).toBeGreaterThanOrEqual(3);
      });
      fireEvent.change(picker, { target: { value: '' } });
      await waitFor(() => {
        expect(picker.value).toBe('');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalled();
      });
      const [, payload] = updateFn.mock.calls[0] as [string, { config: Record<string, unknown> }];
      expect(payload.config).toEqual({
        environment: 'sandbox',
        masterCatalogConnectionId: '',
      });
    });
  });
});
