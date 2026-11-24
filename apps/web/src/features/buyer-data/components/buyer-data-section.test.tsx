/**
 * BuyerDataSection tests (#4289)
 */
import type { ReactElement } from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { EditConnectionFormValues } from '../../connections';
import type { BuyerDataOverride } from '../api/buyer-data.types';
import { BuyerDataSection } from './buyer-data-section';

function Harness({
  initial,
  sync,
  canWrite = true,
}: {
  initial: BuyerDataOverride | null;
  sync: () => void;
  canWrite?: boolean;
}): ReactElement {
  const form = useForm<EditConnectionFormValues>({
    defaultValues: { buyerDataRetention: initial } as Partial<EditConnectionFormValues>,
  });
  return (
    <>
      <BuyerDataSection
        connectionId="conn-1"
        form={form}
        configIsParseable
        canWrite={canWrite}
        syncBuyerDataToJson={sync}
      />
      <output data-testid="value">
        {JSON.stringify(form.watch('buyerDataRetention') ?? null)}
      </output>
    </>
  );
}

afterEach(cleanup);

describe('BuyerDataSection (#4289)', () => {
  it('should inherit by default, say so and show no questions', async () => {
    renderWithProviders(<Harness initial={null} sync={vi.fn()} />, {
      apiClient: createMockApiClient(),
    });

    expect(await screen.findByText(/Inherited from the general settings/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Same as general' })).toBeChecked();
    expect(screen.queryByTestId('buyer-data-period-connection-hide')).not.toBeInTheDocument();
  });

  it('should start own rules switched off and write them after setValue', async () => {
    const sync = vi.fn();
    renderWithProviders(<Harness initial={null} sync={sync} />, {
      apiClient: createMockApiClient(),
    });

    await userEvent.click(await screen.findByRole('radio', { name: 'Set own' }));

    expect(JSON.parse(screen.getByTestId('value').textContent ?? '')).toMatchObject({
      enabled: false,
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('buyer-data-period-connection-hide')).toBeInTheDocument();
    expect(screen.getByTestId('buyer-data-enabled')).toBeDisabled();
  });

  it('should write inherit back as an explicit null', async () => {
    renderWithProviders(
      <Harness
        initial={{ enabled: false, hideAfterDays: 90, eraseAfterDays: 0, mode: 'personal-data' }}
        sync={vi.fn()}
      />,
      { apiClient: createMockApiClient() }
    );

    await userEvent.click(await screen.findByRole('radio', { name: 'Same as general' }));

    expect(screen.getByTestId('value')).toHaveTextContent('null');
  });

  it('should unlock the switch only after a trial run and send the connection id', async () => {
    const preview = vi.fn().mockResolvedValue({
      toHide: 12,
      toErase: 3,
      total: 100,
      skippedProtected: 0,
      samples: [{ orderRef: 'OL-1', placedAt: '2024-12-01T10:00:00.000Z', maskedBuyer: 'J. K.' }],
    });
    renderWithProviders(
      <Harness
        initial={{ enabled: false, hideAfterDays: 90, eraseAfterDays: 365, mode: 'personal-data' }}
        sync={vi.fn()}
      />,
      { apiClient: createMockApiClient({ buyerData: { preview } }) }
    );

    const toggle = await screen.findByTestId('buyer-data-enabled');
    expect(toggle).toBeDisabled();

    await userEvent.click(screen.getByTestId('buyer-data-trial-run'));

    expect(await screen.findByTestId('buyer-data-trial-result')).toHaveTextContent(
      'Nothing was changed'
    );
    expect(preview).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      hideAfterDays: 90,
      eraseAfterDays: 365,
      mode: 'personal-data',
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '')).toMatchObject({
      enabled: true,
    });
  });

  it('should refuse an erase period shorter than the hide period and not run the trial', async () => {
    renderWithProviders(
      <Harness
        initial={{ enabled: false, hideAfterDays: 365, eraseAfterDays: 90, mode: 'personal-data' }}
        sync={vi.fn()}
      />,
      { apiClient: createMockApiClient() }
    );

    expect(
      await screen.findByText('Personal data cannot be erased before the order is hidden.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('buyer-data-trial-run')).toBeDisabled();
  });

  it('should disable every control for a session that cannot write', async () => {
    renderWithProviders(<Harness initial={null} sync={vi.fn()} canWrite={false} />, {
      apiClient: createMockApiClient(),
    });
    expect(await screen.findByRole('radio', { name: 'Set own' })).toBeDisabled();
  });
});
