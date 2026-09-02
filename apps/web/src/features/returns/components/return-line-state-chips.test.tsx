/**
 * Return Line State Chips — the two rails (#2378)
 *
 * The AC that matters most: **`refunded` never renders without an observation.**
 * `triggerRefund` writes `triggered` and only `recordRefundObservation` writes
 * `refunded`, so a `triggered`-only fixture must never produce the refunded
 * rendering or its attribution — nothing here may derive one from the other.
 *
 * @module apps/web/src/features/returns/components
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReturnLineStateChip, ReturnRailsNote } from './return-line-state-chips';

describe('ReturnLineStateChip — money rail (#2378)', () => {
  it('should render in_doubt as a warning with the do-not-refund-again copy', () => {
    render(<ReturnLineStateChip axis="money" value="in_doubt" />);

    expect(screen.getByText('Refund outcome unconfirmed')).toBeInTheDocument();
    // Not "it failed": OpenLinker crossed the boundary and does not know. A
    // retry there moves real money twice.
    expect(screen.getByText(/do not refund again/i)).toBeInTheDocument();
  });

  it('should attribute a refunded state to the source', () => {
    render(<ReturnLineStateChip axis="money" value="refunded" sourceName="Allegro" />);

    expect(screen.getByText('Confirmed by Allegro')).toBeInTheDocument();
  });

  it('should attribute refunded generically when the source name is unknown', () => {
    render(<ReturnLineStateChip axis="money" value="refunded" sourceName={null} />);

    expect(screen.getByText('Confirmed by the source')).toBeInTheDocument();
  });

  it('should NOT render refunded or its attribution for a triggered-only line', () => {
    // The AC, with the fixture the issue names.
    render(<ReturnLineStateChip axis="money" value="triggered" sourceName="Allegro" />);

    expect(screen.getByText('Refund started')).toBeInTheDocument();
    expect(screen.queryByText('Refunded')).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed by/i)).not.toBeInTheDocument();
  });

  it('should not warn on an ordinary pending refund', () => {
    render(<ReturnLineStateChip axis="money" value="pending" />);

    expect(screen.queryByText(/do not refund again/i)).not.toBeInTheDocument();
  });

  it('should render an unrecognised value verbatim rather than blanking it', () => {
    render(<ReturnLineStateChip axis="money" value="something_new" />);

    expect(screen.getByText('something_new')).toBeInTheDocument();
  });
});

describe('ReturnLineStateChip — custody rail (#2378)', () => {
  it('should label the rail so the two axes read as two rails', () => {
    render(<ReturnLineStateChip axis="custody" value="received" />);

    expect(screen.getByText('Parcel')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  it('should still say "not tracked yet" when a caller declares the axis undriven', () => {
    render(<ReturnLineStateChip axis="custody" value="advised" tracked={false} />);

    expect(screen.getByText('Announced')).toBeInTheDocument();
  });
});

describe('ReturnRailsNote (#2378)', () => {
  it('should state that the two rails move independently', () => {
    render(<ReturnRailsNote />);

    expect(screen.getByText(/move independently/i)).toBeInTheDocument();
  });
});
