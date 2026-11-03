import { cleanup, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { useStoresPersonalData } from './use-stores-personal-data';
import { useSystemConfigQuery } from './use-system-config-query';

/** Renders `<query status>:<hook value>` so a test can wait for the config to settle. */
function Probe(): ReactElement {
  const { status } = useSystemConfigQuery();
  const value = useStoresPersonalData();
  return <output>{`${status}:${value === undefined ? 'unknown' : String(value)}`}</output>;
}

function renderWithConfig(config: unknown): void {
  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(config) },
    }),
  });
}

describe('useStoresPersonalData', () => {
  afterEach(cleanup);

  it('should return false when the API reports the install does not store personal data', async () => {
    renderWithConfig({ demoMode: false, storesPersonalData: false });

    expect(await screen.findByText('success:false')).toBeInTheDocument();
  });

  it('should return true when the API reports the install stores personal data', async () => {
    renderWithConfig({ demoMode: false, storesPersonalData: true });

    expect(await screen.findByText('success:true')).toBeInTheDocument();
  });

  it('should stay undefined rather than guess when an older API omits the field', async () => {
    renderWithConfig({ demoMode: false });

    expect(await screen.findByText('success:unknown')).toBeInTheDocument();
  });

  it('should stay undefined while the config is still loading', () => {
    renderWithProviders(<Probe />, {
      apiClient: createMockApiClient({
        system: { getConfig: vi.fn().mockReturnValue(new Promise(() => {})) },
      }),
    });

    expect(screen.getByText('pending:unknown')).toBeInTheDocument();
  });
});
