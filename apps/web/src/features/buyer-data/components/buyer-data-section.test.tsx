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

function renderAndReturn(
  initial: BuyerDataOverride | null,
  enabled = true
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<Harness initial={initial} />, {
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

function render(initial: BuyerDataOverride | null, enabled = true): void {
  renderAndReturn(initial, enabled);
}

afterEach(cleanup);

describe('BuyerDataSection (#4289)', () => {
  it('should summarise the general rules it follows and offer no inputs', async () => {
    render(null);

    expect(await screen.findByTestId('buyer-data-source')).toHaveTextContent('Active');
    expect(screen.getByTestId('buyer-data-hint')).toHaveTextContent('apply here too');
    expect(screen.getByTestId('buyer-data-fact-hide')).toHaveTextContent('after 3 mo.');
    expect(screen.getByTestId('buyer-data-fact-erase')).toHaveTextContent('after 1 yr');
    expect(screen.getByTestId('buyer-data-switch')).toHaveTextContent(
      'Orders leave the list after 3 mo. Personal data is erased after 1 yr.'
    );
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('should keep the track decorative and give its meaning in words', async () => {
    const { container } = renderAndReturn(null);

    const sentence = await screen.findByTestId('buyer-data-switch');
    expect(sentence).toBeVisible();
    expect(container.querySelector('.buyer-data-summary__track')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('should show own values, and never for a zero period', async () => {
    render({ hideAfterDays: 0, eraseAfterDays: 730, mode: 'personal-data' });

    expect(await screen.findByTestId('buyer-data-source')).toHaveTextContent('Own rules');
    expect(screen.getByTestId('buyer-data-fact-hide')).toHaveTextContent('never');
    expect(screen.getByTestId('buyer-data-fact-erase')).toHaveTextContent('after 2 yrs');
    expect(screen.getByTestId('buyer-data-switch')).toHaveTextContent('Orders are not hidden.');
  });

  it('should say orders and data are not removed when both periods are never', async () => {
    render({ hideAfterDays: 0, eraseAfterDays: 0, mode: 'personal-data' });

    expect(await screen.findByTestId('buyer-data-switch')).toHaveTextContent(
      'Orders and buyer data are not removed.'
    );
  });

  it('should say the rules are switched off here when this connection opted out', async () => {
    render({ enabled: false, hideAfterDays: 90, eraseAfterDays: 365, mode: 'personal-data' });

    expect(await screen.findByTestId('buyer-data-source')).toHaveTextContent(
      'Off for this connection'
    );
    expect(screen.getByTestId('buyer-data-hint')).toHaveTextContent('switched off here');
  });

  it('should say the rules are off when the general switch is off', async () => {
    render(null, false);

    expect(await screen.findByTestId('buyer-data-source')).toHaveTextContent('Switched off');
    expect(screen.getByTestId('buyer-data-hint')).toHaveTextContent('Turn them on in settings');
  });

  it('should keep only the link when the general rules are not readable', async () => {
    renderWithProviders(<Harness initial={null} />, {
      apiClient: createMockApiClient({
        operationalSettings: { get: vi.fn().mockRejectedValue(new Error('forbidden')) },
      }),
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'op',
        email: 'op@example.com',
        role: 'operator',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    expect(await screen.findByTestId('buyer-data-cta')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('buyer-data-switch')).not.toBeInTheDocument());
    expect(screen.queryByTestId('buyer-data-source')).not.toBeInTheDocument();
  });

  it('should link to the settings page on this connection scope', async () => {
    render(null);

    const cta = await screen.findByTestId('buyer-data-cta');
    expect(cta).toHaveAttribute('href', '/settings/buyer-data?scope=conn%201');
    expect(cta).toHaveTextContent('Set rules in settings');
  });
});
