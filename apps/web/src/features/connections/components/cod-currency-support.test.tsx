/**
 * CodCurrencySupport — component tests (#1569)
 *
 * Renders the read-only per-carrier COD currency chip list. DPD carries the
 * full set (PLN/EUR/RON/CZK); InPost is PLN-only.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CodCurrencySupport } from './cod-currency-support';

afterEach(cleanup);

describe('CodCurrencySupport', () => {
  it('should render the full DPD currency set as list items', () => {
    render(<CodCurrencySupport platformType="dpd" />);

    const list = screen.getByRole('list', { name: 'Supported COD currencies' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items.map((el) => el.textContent)).toEqual(['PLN', 'EUR', 'RON', 'CZK']);
  });

  it('should render only PLN for InPost', () => {
    render(<CodCurrencySupport platformType="inpost" />);

    const list = screen.getByRole('list', { name: 'Supported COD currencies' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe('PLN');
  });
});
