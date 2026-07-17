/**
 * InpostSetupForm — component tests (#771)
 *
 * Covers the wizard's non-trivial logic: per-step validation gates Next, the
 * sender-address step renders after a valid account step, and a full walk
 * submits the mapped nested-config + credentials payload via connections.create.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InpostSetupForm } from './inpost-setup-form';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';

afterEach(cleanup);

function fillAccountStep(
  container: HTMLElement,
  values: { name: string; apiToken: string; organizationId: string },
): void {
  fireEvent.change(within(container).getByLabelText('Connection name'), { target: { value: values.name } });
  fireEvent.change(within(container).getByLabelText('API token'), { target: { value: values.apiToken } });
  fireEvent.change(within(container).getByLabelText('Organization ID'), {
    target: { value: values.organizationId },
  });
}

function fillSenderStep(container: HTMLElement): void {
  fireEvent.change(within(container).getByLabelText('Sender email'), { target: { value: 'magazyn@acme.pl' } });
  fireEvent.change(within(container).getByLabelText('Sender phone'), { target: { value: '+48111222333' } });
  fireEvent.change(within(container).getByLabelText('Street'), { target: { value: 'ul. Magazynowa' } });
  fireEvent.change(within(container).getByLabelText('Building number'), { target: { value: '1' } });
  fireEvent.change(within(container).getByLabelText('City'), { target: { value: 'Warszawa' } });
  fireEvent.change(within(container).getByLabelText('Postcode'), { target: { value: '00-001' } });
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

describe('InpostSetupForm', () => {
  it('blocks Next while the account step is invalid', async () => {
    const { container } = renderWithProviders(<InpostSetupForm />);

    fireEvent.click(within(container).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('API token is required')).toBeInTheDocument();
    expect(screen.queryByLabelText('Street')).toBeNull();
  });

  it('shows PLN as the only read-only COD currency on the account step (#1569)', () => {
    const { container } = renderWithProviders(<InpostSetupForm />);

    expect(screen.getByText('Supported COD currencies')).toBeInTheDocument();
    const support = container.querySelector('.cod-currency-support') as HTMLElement;
    expect(support).not.toBeNull();
    expect(within(support).getByText('PLN')).toBeInTheDocument();
    expect(within(support).queryByText('EUR')).toBeNull();
    expect(within(support).getAllByText(/^(?:PLN|EUR|RON|CZK)$/)).toHaveLength(1);
  });

  it('advances to the sender-address step once the account step is valid', async () => {
    const { container } = renderWithProviders(<InpostSetupForm />);
    fillAccountStep(container, { name: 'InPost — main', apiToken: 'shipx-token', organizationId: '123456' });

    await advanceOneStep(container);

    expect(screen.getByLabelText('Street')).toBeInTheDocument();
    expect(screen.getByLabelText('Postcode')).toBeInTheDocument();
  });

  it('submits the mapped nested config + credentials after walking every step', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const { container } = renderWithProviders(<InpostSetupForm />, { apiClient });

    fillAccountStep(container, { name: 'InPost — main', apiToken: 'shipx-token', organizationId: '123456' });
    await advanceOneStep(container);
    fillSenderStep(container);
    await advanceOneStep(container);

    fireEvent.click(within(container).getByRole('button', { name: 'Create connection' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        platformType: 'inpost',
        adapterKey: 'inpost.shipx.v1',
        credentials: { apiToken: 'shipx-token' },
        config: expect.objectContaining({
          environment: 'sandbox',
          organizationId: '123456',
          senderAddress: expect.objectContaining({
            email: 'magazyn@acme.pl',
            phone: '+48111222333',
            address: expect.objectContaining({
              street: 'ul. Magazynowa',
              buildingNumber: '1',
              city: 'Warszawa',
              postCode: '00-001',
              countryCode: 'PL',
            }),
          }),
        }),
      }),
    );
    expect((create.mock.calls[0][0] as { enabledCapabilities?: unknown }).enabledCapabilities).toBeUndefined();
  });
});
