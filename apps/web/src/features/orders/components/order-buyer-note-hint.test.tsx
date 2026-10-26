/**
 * `OrderBuyerNoteHint` unit tests (#3539, mockup M2 `list`).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderBuyerNoteHint } from './order-buyer-note-hint';

afterEach(cleanup);

describe('OrderBuyerNoteHint (#3539)', () => {
  it('should show the indicator when the order has a buyer note', () => {
    render(<OrderBuyerNoteHint hasBuyerNote />);
    expect(screen.getByTestId('order-buyer-note-hint')).toHaveTextContent('Buyer note');
  });

  it('should show the one-line preview, with the label kept for assistive tech', () => {
    render(<OrderBuyerNoteHint hasBuyerNote preview="Proszę o kubki w kolorze czerwonym" />);

    const hint = screen.getByTestId('order-buyer-note-hint');
    expect(hint).toHaveTextContent('Proszę o kubki w kolorze czerwonym');
    expect(hint).toHaveAttribute('title', 'Proszę o kubki w kolorze czerwonym');
    expect(hint.querySelector('.sr-only')).toHaveTextContent('Buyer note:');
  });

  it('should fall back to the label when no preview is stored', () => {
    render(<OrderBuyerNoteHint hasBuyerNote preview={null} />);

    expect(screen.getByTestId('order-buyer-note-hint')).toHaveTextContent(/^Buyer note$/);
  });

  it('should render the card variant under its own test id', () => {
    render(<OrderBuyerNoteHint hasBuyerNote layout="card" />);
    expect(screen.getByTestId('order-buyer-note-hint-card')).toBeInTheDocument();
  });

  it.each([false, undefined])('should render nothing when hasBuyerNote is %s', (value) => {
    render(<OrderBuyerNoteHint hasBuyerNote={value} />);
    expect(screen.queryByTestId('order-buyer-note-hint')).not.toBeInTheDocument();
  });
});
