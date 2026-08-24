/**
 * CatalogTrustPanel tests (#2258)
 *
 * @module features/connections/components
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { CatalogTrustPanel } from './catalog-trust-panel';
import type { CatalogTrust } from '../api/connections.types';

function renderPanel(overrides: Partial<CatalogTrust> = {}): void {
  const trust: CatalogTrust = {
    connectionId: 'conn_1',
    rung: 'full-enumeration',
    deltaPassEnabled: false,
    lastReconcileCompletedAt: null,
    reconcileCycleOpen: false,
    ...overrides,
  };
  const apiClient = createMockApiClient({
    connections: { getCatalogTrust: vi.fn().mockResolvedValue(trust) },
  });
  renderWithProviders(<CatalogTrustPanel connectionId="conn_1" />, { apiClient });
}

afterEach(() => {
  cleanup();
});

describe('CatalogTrustPanel', () => {
  it('renders the full-enumeration rung as a declared state with its capability copy', async () => {
    renderPanel({ rung: 'full-enumeration' });

    expect(await screen.findByText('Full enumeration')).toBeInTheDocument();
    expect(
      screen.getByText(/cannot report changes since a point in time/),
    ).toBeInTheDocument();
    // Not a modified-since master — the delta-pass row would be noise.
    expect(screen.queryByText('Delta pass')).not.toBeInTheDocument();
  });

  it('renders the modified-since rung with the dormant-delta hint when the pass is disabled', async () => {
    renderPanel({ rung: 'modified-since', deltaPassEnabled: false });

    expect(await screen.findByText('Modified-since')).toBeInTheDocument();
    expect(screen.getByText('Delta pass')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText(/full\s*re-enumeration still applies in practice/)).toBeInTheDocument();
  });

  it('omits the dormant-delta hint when the delta pass is enabled', async () => {
    renderPanel({ rung: 'modified-since', deltaPassEnabled: true });

    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(
      screen.queryByText(/full\s*re-enumeration still applies in practice/),
    ).not.toBeInTheDocument();
  });

  it('renders unknown as a resolution failure, never asserting a rung', async () => {
    renderPanel({ rung: 'unknown' });

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/Could not resolve this connection's adapter/)).toBeInTheDocument();
  });

  it('renders never-completed reconciliation honestly', async () => {
    renderPanel({ lastReconcileCompletedAt: null });

    expect(await screen.findByText('No cycle completed yet')).toBeInTheDocument();
    expect(screen.getByText('None open')).toBeInTheDocument();
  });

  it('renders an open cycle as open-resuming, never as running', async () => {
    renderPanel({
      lastReconcileCompletedAt: '2026-08-20T12:00:00.000Z',
      reconcileCycleOpen: true,
    });

    expect(await screen.findByText('Open — resumes on the next hourly tick')).toBeInTheDocument();
    expect(screen.queryByText(/running/i)).not.toBeInTheDocument();
  });
});
