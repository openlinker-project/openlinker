/**
 * PrestashopSetupSummary tests
 *
 * Covers identity-row rendering (unset → em-dash placeholder; set →
 * mono-text), per-step supplemental content (step-1 note, step-2+
 * capability list), and the derived webservice endpoint.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PRESTASHOP_SETUP_DEFAULT_VALUES } from './prestashop-setup.schema';
import { PrestashopSetupSummary } from './prestashop-setup-summary';

describe('PrestashopSetupSummary', () => {
  afterEach(cleanup);

  it('renders em-dash placeholders when identity fields are unset', () => {
    render(<PrestashopSetupSummary values={PRESTASHOP_SETUP_DEFAULT_VALUES} stepIndex={0} />);
    // Five identity rows × empty = five em-dashes.
    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  it('renders the derived webservice endpoint with mono-text on step 0', () => {
    render(
      <PrestashopSetupSummary
        values={{ ...PRESTASHOP_SETUP_DEFAULT_VALUES, baseUrl: 'https://shop.example.com' }}
        stepIndex={0}
      />
    );
    const endpoint = screen.getByText('https://shop.example.com/api');
    expect(endpoint).toHaveClass('mono-text');
  });

  it('renders the verify note only on step 1', () => {
    const { rerender } = render(
      <PrestashopSetupSummary values={PRESTASHOP_SETUP_DEFAULT_VALUES} stepIndex={0} />
    );
    expect(screen.queryByText(/Live test available after/)).toBeNull();
    rerender(<PrestashopSetupSummary values={PRESTASHOP_SETUP_DEFAULT_VALUES} stepIndex={1} />);
    expect(screen.getByText(/Live test available after/)).toBeInTheDocument();
  });

  it('renders the capability list on step 2+', () => {
    render(
      <PrestashopSetupSummary
        values={{
          ...PRESTASHOP_SETUP_DEFAULT_VALUES,
          enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
        }}
        stepIndex={2}
      />
    );
    expect(screen.getByText('ProductMaster')).toBeInTheDocument();
    expect(screen.getByText('InventoryMaster')).toBeInTheDocument();
  });
});
