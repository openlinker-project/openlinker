/**
 * DpdSetupForm — component tests (#966)
 *
 * Covers the wizard's non-trivial logic: per-step validation gates Next, the
 * sender-address step renders after a valid account step, and a full walk
 * submits the mapped nested-config + credentials payload via connections.create.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DpdSetupForm } from './dpd-setup-form';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';

const captureDemoEvent = vi.fn();
vi.mock('../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

afterEach(cleanup);

function fillAccountStep(
  container: HTMLElement,
  values: { name: string; login: string; password: string; payerFid: string },
): void {
  fireEvent.change(within(container).getByLabelText('Connection name'), { target: { value: values.name } });
  fireEvent.change(within(container).getByLabelText('Login'), { target: { value: values.login } });
  fireEvent.change(within(container).getByLabelText('Password'), { target: { value: values.password } });
  fireEvent.change(within(container).getByLabelText('Payer FID'), { target: { value: values.payerFid } });
}

function fillSenderStep(container: HTMLElement): void {
  fireEvent.change(within(container).getByLabelText('Address'), { target: { value: 'ul. Magazynowa 1' } });
  fireEvent.change(within(container).getByLabelText('City'), { target: { value: 'Warszawa' } });
  fireEvent.change(within(container).getByLabelText('Postal code'), { target: { value: '00-001' } });
  fireEvent.change(within(container).getByLabelText('Country'), { target: { value: 'PL' } });
}

async function advanceOneStep(container: HTMLElement): Promise<void> {
  const before = container.querySelector('[aria-current="step"]')?.textContent ?? '';
  fireEvent.click(within(container).getByRole('button', { name: 'Next' }));
  await waitFor(() => {
    const after = container.querySelector('[aria-current="step"]')?.textContent ?? '';
    if (after === before) throw new Error('Step did not advance');
  });
}

describe('DpdSetupForm', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });

  it('captures demo_connection_wizard_step_advanced on each Next click (#1789)', async () => {
    const { container } = renderWithProviders(<DpdSetupForm />);

    fillAccountStep(container, {
      name: 'Main store',
      login: 'user1',
      password: 'pass1',
      payerFid: '123456',
    });
    await advanceOneStep(container);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_connection_wizard_step_advanced', {
      platform: 'dpd',
      step: 'Account & credentials',
    });
  });

  it('blocks Next while the account step is invalid', async () => {
    const { container } = renderWithProviders(<DpdSetupForm />);

    fireEvent.click(within(container).getByRole('button', { name: 'Next' }));

    // Per-step validation surfaces an inline error and keeps us on step 1 —
    // the sender-address field is never rendered.
    expect(await screen.findByText('Login is required')).toBeInTheDocument();
    expect(screen.queryByLabelText('Address')).toBeNull();
  });

  it('shows the DPD COD currencies as read-only info on the account step (#1569)', () => {
    const { container } = renderWithProviders(<DpdSetupForm />);

    expect(screen.getByText('Supported COD currencies')).toBeInTheDocument();
    const support = container.querySelector('.cod-currency-support') as HTMLElement;
    expect(support).not.toBeNull();
    expect(within(support).getByText('PLN')).toBeInTheDocument();
    expect(within(support).getByText('EUR')).toBeInTheDocument();
    expect(within(support).getByText('RON')).toBeInTheDocument();
    expect(within(support).getByText('CZK')).toBeInTheDocument();
  });

  it('advances to the sender-address step once the account step is valid', async () => {
    const { container } = renderWithProviders(<DpdSetupForm />);
    fillAccountStep(container, { name: 'DPD — main', login: 'ol_12345', password: 'secret', payerFid: '1495' });

    await advanceOneStep(container);

    expect(screen.getByLabelText('Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Postal code')).toBeInTheDocument();
  });

  it('submits the mapped nested config + credentials after walking every step', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const { container } = renderWithProviders(<DpdSetupForm />, { apiClient });

    fillAccountStep(container, { name: 'DPD — main', login: 'ol_12345', password: 'secret', payerFid: '1495' });
    await advanceOneStep(container);
    fillSenderStep(container);
    await advanceOneStep(container);

    fireEvent.click(within(container).getByRole('button', { name: 'Create connection' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        platformType: 'dpd',
        adapterKey: 'dpd.polska.rest.v1',
        credentials: { login: 'ol_12345', password: 'secret' },
        config: expect.objectContaining({
          environment: 'sandbox',
          payerFid: '1495',
          senderAddress: expect.objectContaining({
            address: 'ul. Magazynowa 1',
            city: 'Warszawa',
            postalCode: '00-001',
            countryCode: 'PL',
          }),
        }),
      }),
    );
    // enabledCapabilities omitted so the API defaults to the adapter's supported set.
    expect((create.mock.calls[0][0] as { enabledCapabilities?: unknown }).enabledCapabilities).toBeUndefined();
  });
});
