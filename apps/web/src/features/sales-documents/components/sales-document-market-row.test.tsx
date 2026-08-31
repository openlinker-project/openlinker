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

function renderRow(
  row: MarketRowData,
  onSelect = vi.fn(),
  disabled = false,
  extra: { windowDays?: number; isSoleTemplatedMarket?: boolean } = {},
): void {
  render(
    <ul>
      <SalesDocumentMarketRow row={row} onSelect={onSelect} disabled={disabled} {...extra} />
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

  describe('detected markets (#2542)', () => {
    it('should render a detected market\'s order count with its discovery window', () => {
      renderRow(makeRow({ orderCount: 12 }), vi.fn(), false, { windowDays: 30 });
      expect(screen.getByText(/12 orders in the last 30 days/)).toBeInTheDocument();
    });

    it('should render only the order count when the window is not known', () => {
      renderRow(makeRow({ orderCount: 12 }));
      expect(screen.getByText(/12 orders/)).toBeInTheDocument();
      expect(screen.queryByText(/in the last/)).not.toBeInTheDocument();
    });

    it('should never render order counts for a configured-only market', () => {
      renderRow(makeRow({ orderCount: null }), vi.fn(), false, { windowDays: 30 });
      expect(screen.queryByText(/orders/)).not.toBeInTheDocument();
    });

    it('should name this market as the only one with guidance when it is the sole template', () => {
      renderRow(
        makeRow({
          hasTemplate: true,
          ruleCount: 0,
          invoiceDefaultConnectionId: null,
          outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
        }),
        vi.fn(),
        false,
        { isSoleTemplatedMarket: true },
      );
      expect(screen.getByText(/the only market with guidance so far/)).toBeInTheDocument();
    });

    it('should not claim exclusivity when several markets carry a template', () => {
      renderRow(
        makeRow({
          hasTemplate: true,
          ruleCount: 0,
          invoiceDefaultConnectionId: null,
          outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
        }),
        vi.fn(),
        false,
        { isSoleTemplatedMarket: false },
      );
      expect(screen.getByText(/Starter setup available/)).toBeInTheDocument();
      expect(screen.queryByText(/the only market with guidance/)).not.toBeInTheDocument();
    });

    it('should never render the sole-template caption for a market without a template', () => {
      renderRow(
        makeRow({
          hasTemplate: false,
          ruleCount: 0,
          invoiceDefaultConnectionId: null,
          outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
        }),
        vi.fn(),
        false,
        { isSoleTemplatedMarket: true },
      );
      expect(screen.queryByText(/Starter setup available/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    });
  });
});
