import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type ReactElement, useState } from 'react';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { IssueInvoiceOptions } from '../../../features/invoicing';
import { KsefInvoiceIssueOptions } from './ksef-invoice-issue-options';

afterEach(() => cleanup());

let latest: IssueInvoiceOptions = {};

function Harness(): ReactElement {
  const [value, setValue] = useState<IssueInvoiceOptions>({});
  latest = value;
  return (
    <KsefInvoiceIssueOptions
      connection={sampleConnection}
      lines={[
        { id: 'line-1', name: 'Kettle', quantity: 1 },
        { id: 'line-2', name: null, quantity: 2 },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

describe('KsefInvoiceIssueOptions', () => {
  it('should tick nothing by default', () => {
    renderWithProviders(<Harness />);
    expect(latest).toEqual({});
    const mpp = screen.getByRole<HTMLInputElement>('checkbox', { name: /Split payment/i });
    expect(mpp.checked).toBe(false);
  });

  it('should add and remove split payment without leaving an empty annotations object', () => {
    renderWithProviders(<Harness />);
    const mpp = screen.getByRole('checkbox', { name: /Split payment/i });
    fireEvent.click(mpp);
    expect(latest).toEqual({ annotations: { splitPayment: true } });
    fireEvent.click(mpp);
    expect(latest).toEqual({});
  });

  it('should key a GTU marker to the order line id', () => {
    renderWithProviders(<Harness />);
    fireEvent.change(screen.getByLabelText('GTU for Kettle'), { target: { value: 'GTU_06' } });
    expect(latest).toEqual({ lineClassifications: [{ orderLineId: 'line-1', gtuCode: 'GTU_06' }] });
    fireEvent.change(screen.getByLabelText('GTU for Kettle'), { target: { value: '' } });
    expect(latest).toEqual({});
  });

  it('should name an unnamed line by its position', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByLabelText('Procedure for Line 2')).toBeTruthy();
  });

  it('should add a public-sector party and attach a NIP to it', () => {
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a party' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gmina Testowo' } });
    fireEvent.change(screen.getByLabelText('NIP'), { target: { value: '1189981779' } });
    expect(latest.additionalParties).toEqual([
      { role: '8', name: 'Gmina Testowo', taxId: { scheme: 'pl-nip', value: '1189981779' } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this party' }));
    expect(latest).toEqual({});
  });
});
