import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SalesDocumentMarketRow } from './sales-document-market-row';
import type { SalesDocumentMarketRow as MarketRowData } from '../api/sales-document-markets.types';

function makeRow(overrides: Partial<MarketRowData> = {}): MarketRowData {
  return {
    country: 'DE',
    orderCount: null,
    hasTemplate: false,
    ruleCount: 1,
    invoiceDefaultConnectionId: 'conn_1',
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
    outcome: { kind: 'route', documentKind: 'invoice', connectionId: 'conn_1' },
    ...overrides,
  };
}

function renderRow(row: MarketRowData, onSelect = vi.fn(), disabled = false): void {
  render(
    <ul>
      <SalesDocumentMarketRow row={row} onSelect={onSelect} disabled={disabled} />
    </ul>,
  );
}

describe('SalesDocumentMarketRow', () => {
  it('should label the action "Configure" for a settled row', () => {
    renderRow(makeRow());
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
  });

  it('should offer a plain "Set up" action for an unresolved row without a starter template', () => {
    renderRow(makeRow({ ruleCount: 0, invoiceDefaultConnectionId: null, outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' } }));
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('should offer "Use starter setup" when a template exists for an unresolved market', () => {
    renderRow(
      makeRow({
        hasTemplate: true,
        ruleCount: 0,
        invoiceDefaultConnectionId: null,
        outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
      }),
    );
    expect(screen.getByRole('button', { name: 'Use starter setup' })).toBeInTheDocument();
  });

  it('should call onSelect with the row country when the action is clicked', async () => {
    const onSelect = vi.fn();
    renderRow(makeRow({ country: 'AT' }), onSelect);
    await userEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(onSelect).toHaveBeenCalledWith('AT');
  });

  it('should disable the action while the section is busy', () => {
    renderRow(makeRow(), vi.fn(), true);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('should render the Rest of world pseudo-country with its display label', () => {
    renderRow(makeRow({ country: '*' }));
    expect(screen.getByText('★ Rest of world')).toBeInTheDocument();
  });
});
