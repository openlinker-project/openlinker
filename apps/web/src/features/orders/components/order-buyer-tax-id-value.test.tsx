/**
 * `OrderBuyerTaxIdValue` unit tests (#3180).
 *
 * Three distinct states, three distinct `data-testid`s — never one hook whose
 * text varies. The middle test is the one that matters most: a bare
 * `IS NOT NULL` / truthiness read collapses "asserted none" into "present",
 * which is exactly the bug the three-state column exists to prevent.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { OrderBuyerTaxIdValue } from './order-buyer-tax-id-value';

afterEach(cleanup);

describe('OrderBuyerTaxIdValue (#3180)', () => {
  it('should render the id verbatim when the source asserted a value', () => {
    renderWithProviders(<OrderBuyerTaxIdValue buyerTaxId="5213796333" />);

    const el = screen.getByTestId('order-buyer-tax-id');
    expect(el).toHaveTextContent('5213796333');
    // No other state's hook renders alongside this one.
    expect(screen.queryByTestId('order-buyer-tax-id-none')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-buyer-tax-id-unknown')).not.toBeInTheDocument();
  });

  it('should render a distinct pill for the asserted-none state (null), never the present state', () => {
    renderWithProviders(<OrderBuyerTaxIdValue buyerTaxId={null} />);

    expect(screen.getByTestId('order-buyer-tax-id-none')).toHaveTextContent('None — asserted');
    expect(screen.queryByTestId('order-buyer-tax-id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-buyer-tax-id-unknown')).not.toBeInTheDocument();
  });

  it('should render muted "not asserted" copy for the unknown state (absent), never a pill', () => {
    renderWithProviders(<OrderBuyerTaxIdValue buyerTaxId={undefined} />);

    const el = screen.getByTestId('order-buyer-tax-id-unknown');
    expect(el).toHaveTextContent('Not asserted by the source');
    expect(screen.queryByTestId('order-buyer-tax-id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-buyer-tax-id-none')).not.toBeInTheDocument();
  });

  it('should carry an operator-visible explanation of the OL_STORE_PII degradation on the unknown state', async () => {
    renderWithProviders(<OrderBuyerTaxIdValue buyerTaxId={undefined} />);

    const user = userEvent.setup();
    await user.hover(screen.getByTestId('order-buyer-tax-id-unknown'));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(/OL_STORE_PII=false/);
  });
});
