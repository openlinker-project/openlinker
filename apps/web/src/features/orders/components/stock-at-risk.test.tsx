/**
 * Stock-at-risk badge + callout unit tests (#2350).
 *
 * Two properties carry the slice and both are easy to regress silently:
 *
 * 1. **An empty or absent list renders NOTHING, and never a reassurance.** Both
 *    the detail loader and the list's batched read catch to empty on failure,
 *    so "no shortfalls" would be a claim the data cannot support. A future
 *    contributor adding a friendly "all good" line breaks this test.
 * 2. **The badge title and the callout title are the same string**, which is
 *    AC1 — byte-identity with `W2-19`'s attention table, guaranteed by both
 *    reading one builder.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockAtRiskBadge } from './stock-at-risk-badge';
import { StockAtRiskCallout } from './stock-at-risk-callout';
import { stockAtRiskTitle } from '../lib/stock-at-risk-copy';
import type { OrderReservationShortfall } from '../api/orders.types';

function shortfall(over: Partial<OrderReservationShortfall> = {}): OrderReservationShortfall {
  return {
    episodeId: 'ep-1',
    inventoryItemId: 'ol_inventoryitem_1',
    productVariantId: 'ol_variant_1',
    sku: 'SKU-1',
    shortQuantity: 2,
    positionShortfall: 3,
    openedAt: '2026-08-27T10:00:00.000Z',
    ...over,
  };
}

describe('StockAtRiskBadge', () => {
  it('should name the quantity and the sku when one episode is open', () => {
    render(<StockAtRiskBadge shortfalls={[shortfall()]} />);

    expect(screen.getAllByText('Short 2 × SKU-1').length).toBeGreaterThan(0);
  });

  it('should summarise when several episodes are open', () => {
    render(
      <StockAtRiskBadge
        shortfalls={[shortfall(), shortfall({ episodeId: 'ep-2', sku: 'SKU-2' })]}
      />
    );

    expect(screen.getAllByText('Short stock on 2 items').length).toBeGreaterThan(0);
  });

  it('should fall back to the variant id when the sku is null, never a blank', () => {
    render(<StockAtRiskBadge shortfalls={[shortfall({ sku: null })]} />);

    expect(screen.getAllByText('Short 2 × ol_variant_1').length).toBeGreaterThan(0);
  });

  it('should carry the body sentence for assistive tech, not only in a title', () => {
    render(<StockAtRiskBadge shortfalls={[shortfall()]} />);

    // `title` alone is unreachable by keyboard and absent on touch, so the
    // sentence is restated in a visually-hidden span.
    expect(screen.getByText(/Nothing was silently reduced/)).toBeInTheDocument();
  });

  it('should render nothing for an empty list', () => {
    const { container } = render(<StockAtRiskBadge shortfalls={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should render nothing when the field is absent', () => {
    // Absence is what a FAILED projection also looks like — so it must never
    // become a positive "this order is fine".
    const { container } = render(<StockAtRiskBadge shortfalls={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should render the caller-supplied fallback when there is nothing to report', () => {
    // A prop, not a call-site ternary: "when is there nothing to show" is the
    // copy module's rule, and a page restating it can silently disagree.
    render(<StockAtRiskBadge shortfalls={[]} emptyFallback="—" />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('should announce the body once, not repeat the label', () => {
    render(<StockAtRiskBadge shortfalls={[shortfall()]} />);

    // The label is already rendered visibly; repeating the whole title in the
    // sr-only span would make assistive tech read it twice.
    expect(screen.getAllByText('Short 2 × SKU-1')).toHaveLength(1);
  });

  it('should say the same thing in both layouts', () => {
    const stack = render(<StockAtRiskBadge shortfalls={[shortfall()]} layout="stack" />);
    const stackText = stack.container.textContent;
    stack.unmount();

    const row = render(<StockAtRiskBadge shortfalls={[shortfall()]} layout="row" />);

    // `layout` is layout only — the desktop cell and the mobile card are the
    // same renderer precisely so they cannot drift again.
    expect(row.container.textContent).toBe(stackText);
  });
});

describe('StockAtRiskCallout', () => {
  it('should state the spec body copy', () => {
    render(<StockAtRiskCallout shortfalls={[shortfall()]} />);

    expect(
      screen.getByText(
        /The stock master dropped below what this order was promised\. Nothing was silently reduced — this order is the one at risk\./
      )
    ).toBeInTheDocument();
  });

  it('should list every short item with its share and the total exposure', () => {
    render(
      <StockAtRiskCallout
        shortfalls={[shortfall(), shortfall({ episodeId: 'ep-2', sku: 'SKU-2', shortQuantity: 1 })]}
      />
    );

    expect(screen.getByText('SKU-1 — short 2 of 3 across all orders')).toBeInTheDocument();
    expect(screen.getByText('SKU-2 — short 1 of 3 across all orders')).toBeInTheDocument();
  });

  it('should render nothing for an empty list, and no reassurance', () => {
    const { container } = render(<StockAtRiskCallout shortfalls={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should render nothing when the field is absent', () => {
    const { container } = render(<StockAtRiskCallout shortfalls={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should share one title with the badge (AC1 byte-identity)', () => {
    const list = [shortfall()];
    const expected = stockAtRiskTitle(list);

    const badge = render(<StockAtRiskBadge shortfalls={list} />);
    expect(badge.container.textContent).toContain(expected as string);
    badge.unmount();

    const callout = render(<StockAtRiskCallout shortfalls={list} />);
    expect(callout.container.textContent).toContain(expected as string);
  });
});
