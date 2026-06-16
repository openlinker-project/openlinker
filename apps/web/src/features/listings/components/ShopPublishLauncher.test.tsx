/**
 * ShopPublishLauncher Tests
 *
 * Covers the capability-shaped dispatch site (#1044):
 *   - empty state when no `ProductPublisher` connection exists
 *   - wizard rendered when exactly one eligible WooCommerce connection
 *     exists (picker auto-skipped)
 *   - unsupported-platform warning when the picked connection's platform
 *     ships no publish wizard
 *
 * Wizard-internal UX lives in `WoocommercePublishWizard.test.tsx`.
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ShopPublishLauncher } from './ShopPublishLauncher';
import type { Connection } from '../../connections';

const wooConnection: Connection = {
  id: 'conn_woo_1',
  name: 'Main WooCommerce store',
  platformType: 'woocommerce',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
  supportedCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// A connection that has the capability but a platform with no FE publish
// wizard — exercises the "unsupported platform" branch. We mark it the only
// eligible connection so the picker auto-skips straight to the wizard
// resolution.
const prestashopPublisher: Connection = {
  id: 'conn_ps_1',
  name: 'PrestaShop main',
  platformType: 'prestashop',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'prestashop.webservice.v1',
  enabledCapabilities: ['ProductPublisher'],
  supportedCapabilities: ['ProductPublisher'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function mocks(connections: Connection[]) {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue(connections) },
  });
}

describe('ShopPublishLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when closed', () => {
    renderWithProviders(
      <ShopPublishLauncher open={false} onOpenChange={vi.fn()} defaultVariantId="ol_variant_1" />,
      { apiClient: mocks([wooConnection]) },
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the empty state when no ProductPublisher connection exists', async () => {
    renderWithProviders(
      <ShopPublishLauncher open onOpenChange={vi.fn()} defaultVariantId="ol_variant_1" />,
      { apiClient: mocks([]) },
    );
    expect(await screen.findByText('No shop connection yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to integrations/i })).toBeInTheDocument();
  });

  it('renders the WooCommerce wizard when one eligible connection exists', async () => {
    renderWithProviders(
      <ShopPublishLauncher open onOpenChange={vi.fn()} defaultVariantId="ol_variant_1" />,
      { apiClient: mocks([wooConnection]) },
    );
    // The picker is auto-skipped (single eligible connection) and the wizard
    // content (Publish button) renders.
    expect(await screen.findByRole('button', { name: /^publish$/i })).toBeInTheDocument();
    expect(screen.getByText(/publish to main woocommerce store/i)).toBeInTheDocument();
  });

  it('shows the unsupported-platform warning when no plugin contributes a wizard', async () => {
    renderWithProviders(
      <ShopPublishLauncher open onOpenChange={vi.fn()} defaultVariantId="ol_variant_1" />,
      { apiClient: mocks([prestashopPublisher]) },
    );
    expect(await screen.findByText('No publish wizard for this platform')).toBeInTheDocument();
  });
});
