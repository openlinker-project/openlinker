/**
 * OfferCreationLauncher Tests
 *
 * Covers the capability-shaped dispatch site (#608):
 *   - picker shown when no defaultConnectionId
 *   - auto-skip when defaultConnectionId resolves against active connections
 *   - falls back to picker when defaultConnectionId doesn't resolve
 *   - loading state while connections fetch
 *   - unsupported-platform alert when no plugin registers a wizard
 *   - wizard rendered on Continue (Allegro plugin contribution exercised)
 *   - Cancel / Close fire onClose
 *   - empty marketplace list shows a "no connections" alert
 *
 * Tests for the wizard's own UX (variant pick, step navigation, submit,
 * idempotency) live in `AllegroCreateOfferWizard.test.tsx`. This spec
 * stays focused on the dispatch surface.
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { OfferCreationLauncher } from './OfferCreationLauncher';
import type { Connection } from '../../connections';

const allegroConnection: Connection = {
  id: 'conn_allegro_1',
  name: 'Allegro sandbox',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const prestashopConnection: Connection = {
  id: 'conn_ps_1',
  name: 'PrestaShop main',
  platformType: 'prestashop',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'prestashop.webservice.v1',
  enabledCapabilities: ['OfferManager'],
  // This fixture deliberately advertises OfferManager so the launcher
  // surfaces it in the picker — exercising the "unsupported platform"
  // branch when the operator picks it (no FE plugin registers Prestashop).
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function defaultMocks(connections: Connection[] = [allegroConnection]) {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue(connections) },
    products: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 }),
    },
    listings: {
      getSellerPolicies: vi.fn().mockResolvedValue({
        deliveryPolicies: [],
        returnPolicies: [],
        warranties: [],
        impliedWarranties: [],
      }),
      getCategoryParameters: vi.fn().mockResolvedValue({ parameters: [] }),
    },
    mappings: {
      getAllegroCategories: vi.fn().mockResolvedValue([]),
    },
  });
}

describe('OfferCreationLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when isOpen is false', () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={false}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the connection picker when no defaultConnectionId is supplied', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    expect(await screen.findByLabelText(/marketplace connection/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('auto-skips the picker when defaultConnectionId resolves to an active connection', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId={allegroConnection.id}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    // Allegro plugin contributes the wizard — the picker is bypassed and
    // the wizard mounts immediately with the resolved connection.
    expect(await screen.findByLabelText(/search products/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/marketplace connection/i)).not.toBeInTheDocument();
  });

  it('falls back to the picker when defaultConnectionId does not match any active connection', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        defaultConnectionId="conn_does_not_exist"
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    expect(await screen.findByLabelText(/marketplace connection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/search products/i)).not.toBeInTheDocument();
  });

  it('renders the wizard after the operator picks a connection and clicks Continue', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    const select = await screen.findByLabelText<HTMLSelectElement>(/marketplace connection/i);
    fireEvent.change(select, { target: { value: allegroConnection.id } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByLabelText(/search products/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/marketplace connection/i)).not.toBeInTheDocument();
  });

  it('shows an unsupported-platform alert when the picked connection has no registered wizard', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks([allegroConnection, prestashopConnection]) },
    );

    const select = await screen.findByLabelText<HTMLSelectElement>(/marketplace connection/i);
    fireEvent.change(select, { target: { value: prestashopConnection.id } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(
      await screen.findByText(/offer creation isn't supported for this marketplace yet/i),
    ).toBeInTheDocument();
  });

  it('fires onClose when the picker Cancel is pressed', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={onClose}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the "no marketplace connections" alert when the loaded list is empty', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks([]) },
    );

    expect(
      await screen.findByText(/no marketplace connections available/i),
    ).toBeInTheDocument();
  });

  it('Continue is disabled until a connection is chosen', async () => {
    renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks() },
    );

    const continueBtn = await screen.findByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();
  });

  it('resets picker state when the dialog closes and reopens', async () => {
    const { rerender } = renderWithProviders(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: defaultMocks([allegroConnection, prestashopConnection]) },
    );

    // Pick prestashop, advance into the unsupported branch.
    const select = await screen.findByLabelText<HTMLSelectElement>(/marketplace connection/i);
    fireEvent.change(select, { target: { value: prestashopConnection.id } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/offer creation isn't supported/i);

    // Close — picker state should reset.
    rerender(
      <OfferCreationLauncher
        isOpen={false}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
    );

    // Reopen — should see the picker (not the unsupported alert).
    rerender(
      <OfferCreationLauncher
        isOpen={true}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/marketplace connection/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/offer creation isn't supported/i)).not.toBeInTheDocument();
  });
});
