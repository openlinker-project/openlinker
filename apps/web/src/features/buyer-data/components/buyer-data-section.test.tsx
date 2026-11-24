/**
 * BuyerDataSection tests (#4289)
 */
import type { ReactElement } from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { EditConnectionFormValues } from '../../connections';
import type { BuyerDataOverride } from '../api/buyer-data.types';
import { BuyerDataSection } from './buyer-data-section';

function Harness({ initial }: { initial: BuyerDataOverride | null }): ReactElement {
  const form = useForm<EditConnectionFormValues>({
    defaultValues: { buyerDataRetention: initial } as Partial<EditConnectionFormValues>,
  });
  return <BuyerDataSection connectionId="conn 1" form={form} />;
}

function settings(enabled: boolean): unknown {
  return {
    buyerDataRetentionEnabled: { value: enabled, source: 'setting', workerMayDiffer: false },
    buyerDataHideAfterDays: { value: 90, source: 'setting', workerMayDiffer: false },
    buyerDataEraseAfterDays: { value: 365, source: 'setting', workerMayDiffer: false },
    buyerDataEraseMode: { value: 'personal-data', source: 'setting', workerMayDiffer: false },
  };
}

function render(initial: BuyerDataOverride | null, enabled = true): void {
  renderWithProviders(<Harness initial={initial} />, {
    apiClient: createMockApiClient({
      operationalSettings: { get: vi.fn().mockResolvedValue(settings(enabled)) },
    }),
    sessionAdapter: createAuthenticatedSessionAdapter({
      id: 'u1',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
      permissions: ['connections:write'],
      analyticsConsent: true,
    }),
  });
}

afterEach(cleanup);

describe('BuyerDataSection (#4289)', () => {
  it('should summarise the general rules it follows and offer no inputs', async () => {
    render(null);

    await waitFor(() =>
      expect(screen.getByText('Follows the default settings')).toBeInTheDocument()
    );
    expect(await screen.findByTestId('buyer-data-switch')).toHaveTextContent('The rules are on.');
    expect(screen.getByTestId('buyer-data-fact-hide')).toHaveTextContent('after 3 mo.');
    expect(screen.getByTestId('buyer-data-fact-erase')).toHaveTextContent('after 1 yr');
    expect(screen.getByTestId('buyer-data-switch')).toHaveTextContent('The rules are on.');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('should show own values, and never for a zero period', async () => {
    render({ hideAfterDays: 0, eraseAfterDays: 730, mode: 'personal-data' });

    await waitFor(() => expect(screen.getByText('Own rules')).toBeInTheDocument());
    expect(await screen.findByTestId('buyer-data-fact-hide')).toHaveTextContent('never');
    expect(screen.getByTestId('buyer-data-fact-erase')).toHaveTextContent('after 2 yrs');
  });

  it('should say the rules are switched off here when this connection opted out', async () => {
    render({ enabled: false, hideAfterDays: 90, eraseAfterDays: 365, mode: 'personal-data' });

    await waitFor(() =>
      expect(screen.getByText('Switched off for this connection.')).toBeInTheDocument()
    );
  });

  it('should say the rules are off when the general switch is off', async () => {
    render(null, false);

    await waitFor(() =>
      expect(screen.getByText('The rules are switched off.')).toBeInTheDocument()
    );
  });

  it('should link to the settings page on this connection scope', async () => {
    render(null);

    const cta = await screen.findByTestId('buyer-data-cta');
    expect(cta).toHaveAttribute('href', '/settings/buyer-data?scope=conn%201');
    expect(cta).toHaveTextContent('Set rules in settings');
  });
});
