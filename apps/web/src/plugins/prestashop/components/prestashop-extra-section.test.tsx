/**
 * PrestashopExtraSection — component tests (#1810 rebase of #1815)
 *
 * The slot always mounts the readout now — the readout itself renders the
 * "not rate-limited" empty state when neither an explicit `config.rateLimit`
 * nor the adapter's manifest default is in effect, so this slot no longer
 * inspects `connection.config` to decide whether to render at all.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import type { ReactElement } from 'react';

import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { PrestashopExtraSection } from './prestashop-extra-section';
import type { Connection } from '../../../features/connections';
import type { ExtraConfigSectionProps } from '../../../shared/plugins';

afterEach(cleanup);

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-prestashop-1',
    platformType: 'prestashop',
    name: 'PrestaShop Main',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function Harness({ connection }: { connection: Connection }): ReactElement {
  const form = useForm();
  return (
    <PrestashopExtraSection
      connection={connection}
      form={form as unknown as ExtraConfigSectionProps['form']}
      configIsParseable
      syncSellerDefaultsToJson={vi.fn()}
    />
  );
}

describe('PrestashopExtraSection', () => {
  it('renders the disabled readout copy when no cap is in effect', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getRateLimitStatus: vi.fn().mockResolvedValue({ enabled: false }),
      },
    });

    renderWithProviders(<Harness connection={makeConnection()} />, { apiClient });

    expect(
      await screen.findByText(
        'No outbound limit configured — requests to this connection are not paced.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the enabled readout copy when a cap is in effect', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getRateLimitStatus: vi.fn().mockResolvedValue({
          enabled: true,
          requestsPerMinute: 60,
          inFlight: 0,
          queued: 0,
          lastAcquiredAt: null,
        }),
      },
    });

    renderWithProviders(
      <Harness connection={makeConnection({ config: { rateLimit: { requestsPerMinute: 60 } } })} />,
      { apiClient },
    );

    expect(await screen.findByText('Cap: 60/min')).toBeInTheDocument();
  });
});
