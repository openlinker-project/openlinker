/**
 * BuyerDataWizardStep tests (#4289)
 */
import { useState, type ReactElement } from 'react';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { DEFAULT_BUYER_DATA_WIZARD_VALUE } from '../lib/buyer-data-config';
import type { BuyerDataWizardValue } from '../api/buyer-data.types';
import { BuyerDataWizardStep } from './buyer-data-wizard-step';

function Harness(): ReactElement {
  const [value, setValue] = useState<BuyerDataWizardValue>(DEFAULT_BUYER_DATA_WIZARD_VALUE);
  return (
    <>
      <BuyerDataWizardStep value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

afterEach(cleanup);

describe('BuyerDataWizardStep (#4289)', () => {
  it('should default to the recommended general settings and show no questions', async () => {
    renderWithProviders(<Harness />, { apiClient: createMockApiClient() });

    expect(
      await screen.findByRole('radio', { name: 'Use general settings (recommended)' })
    ).toBeChecked();
    expect(screen.getByText(/takes the rules from Settings > Buyer data/)).toBeInTheDocument();
    expect(screen.queryByTestId('buyer-data-rules-editor')).not.toBeInTheDocument();
  });

  it('should reveal the questions for own rules and keep them switched off', async () => {
    renderWithProviders(<Harness />, { apiClient: createMockApiClient() });

    await userEvent.click(await screen.findByRole('radio', { name: 'Set own' }));

    expect(screen.getByTestId('buyer-data-rules-editor')).toBeInTheDocument();
    expect(screen.getByText(/saved switched off/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '')).toMatchObject({
      choice: 'own',
      rules: { enabled: false },
    });
  });
});
