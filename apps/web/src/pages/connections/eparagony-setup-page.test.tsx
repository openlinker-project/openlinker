/**
 * EparagonySetupPage Tests (#3769)
 *
 * The page header states what connecting does and does not do, and its chips
 * follow the document choice in the form below.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { EparagonySetupPage } from './eparagony-setup-page';

function chips(): string[] {
  const toolbar = document.querySelector('.page-summary');
  if (!(toolbar instanceof HTMLElement)) throw new Error('no page summary');
  return within(toolbar)
    .getAllByText(/./)
    .map((chip) => chip.textContent ?? '');
}

describe('EparagonySetupPage', () => {
  afterEach(cleanup);

  it('says connecting issues nothing by itself, for either document kind', () => {
    renderWithProviders(<EparagonySetupPage />);
    expect(screen.getByText(/Connecting does not issue anything by itself/)).toBeInTheDocument();
  });

  it('keeps the header chips in step with the document choice', () => {
    renderWithProviders(<EparagonySetupPage />);
    expect(chips()).toEqual(['Fiscalization', 'Guided setup']);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Invoices/ }));
    expect(chips()).toEqual(['Fiscalization', 'Invoicing', 'Guided setup']);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Fiscal e-receipts/ }));
    expect(chips()).toEqual(['Invoicing', 'Guided setup']);
  });
});
