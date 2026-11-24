/**
 * AgeStrip tests (#4289)
 *
 * The strip is the interaction centrepiece, so the contract pinned here is the
 * keyboard one (a handle is a slider with detent steps and a spoken value), the
 * erase-not-before-hide rule, and the honest states (loading, empty, failed).
 */
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { BuyerDataAgeHistogram } from '../api/buyer-data.types';
import { AgeStrip, type StripCounts } from './age-strip';

const HISTOGRAM: BuyerDataAgeHistogram = {
  bucketUnit: 'month',
  buckets: Array.from({ length: 24 }, (_, ageMonths) => ({
    ageMonths,
    visible: 10,
    hidden: 0,
    erased: 0,
  })),
  totalOrders: 240,
  oldestPlacedAt: '2024-01-01T00:00:00.000Z',
};
const COUNTS: StripCounts = {
  kept: 100,
  hidden: 80,
  erased: 60,
  estimated: false,
  calculating: false,
};

function Harness({
  initial = { hideAfterDays: 90, eraseAfterDays: 365 },
  histogram = HISTOGRAM,
  state = 'ready',
  counts = COUNTS,
}: {
  initial?: { hideAfterDays: number; eraseAfterDays: number };
  histogram?: BuyerDataAgeHistogram | undefined;
  state?: 'loading' | 'error' | 'ready';
  counts?: StripCounts | null;
}): ReactElement {
  const [cuts, setCuts] = useState(initial);
  return (
    <AgeStrip
      {...cuts}
      histogram={histogram}
      histogramState={state}
      counts={counts}
      onChange={setCuts}
      onActive={() => undefined}
    />
  );
}

afterEach(cleanup);

describe('AgeStrip (#4289)', () => {
  it('should expose each cut as a slider with a spoken value and step by detents', async () => {
    renderWithProviders(<Harness />);
    const hide = screen.getByTestId('age-strip-handle-hide');

    expect(hide).toHaveAttribute('role', 'slider');
    expect(hide).toHaveAttribute('aria-valuenow', '90');
    expect(hide).toHaveAttribute('aria-valuetext', expect.stringContaining('Hide after 3 mo'));
    expect(hide).toHaveAttribute('aria-valuetext', expect.stringContaining('about 140 orders'));

    hide.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(hide).toHaveAttribute('aria-valuenow', '180');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(hide).toHaveAttribute('aria-valuenow', '60');
    await userEvent.keyboard('{PageUp}');
    expect(hide).toHaveAttribute('aria-valuenow', '180');
    await userEvent.keyboard('{PageDown}');
    expect(hide).toHaveAttribute('aria-valuenow', '60');
  });

  it('should jump to the minimum on Home and to never on End', async () => {
    renderWithProviders(<Harness />);
    const hide = screen.getByTestId('age-strip-handle-hide');
    hide.focus();

    await userEvent.keyboard('{End}');
    expect(hide).toHaveAttribute('aria-valuenow', '3651');
    expect(hide).toHaveAttribute('aria-valuetext', 'Hiding is off');
    await userEvent.keyboard('{Home}');
    expect(hide).toHaveAttribute('aria-valuenow', '30');
  });

  it('should push the erase cut out when hide passes it and say so', async () => {
    renderWithProviders(<Harness initial={{ hideAfterDays: 180, eraseAfterDays: 365 }} />);
    const hide = screen.getByTestId('age-strip-handle-hide');
    hide.focus();

    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(hide).toHaveAttribute('aria-valuenow', '540');
    expect(screen.getByTestId('age-strip-handle-erase')).toHaveAttribute('aria-valuenow', '540');
    expect(screen.getByTestId('age-strip-note')).toHaveTextContent(/moved/);
  });

  it('should keep erase from going before hide', async () => {
    renderWithProviders(<Harness />);
    const erase = screen.getByTestId('age-strip-handle-erase');
    erase.focus();

    await userEvent.keyboard('{Home}');
    expect(erase).toHaveAttribute('aria-valuenow', '90');
    expect(screen.getByTestId('age-strip-note')).toBeInTheDocument();
  });

  it('should tint every bar by the zone its age falls in', () => {
    renderWithProviders(<Harness />);
    const zones = Array.from(document.querySelectorAll('.age-strip__bar')).map((el) =>
      el.getAttribute('data-zone')
    );
    expect(zones[0]).toBe('kept');
    expect(zones[2]).toBe('kept');
    expect(zones[3]).toBe('hidden');
    expect(zones[12]).toBe('hidden');
    expect(zones[13]).toBe('erased');
  });

  it('should offer the same data as a table', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText('Show as a table')).toBeInTheDocument();
    expect(screen.getByRole('table', { hidden: true })).toBeInTheDocument();
  });

  it('should show a calculating skeleton, never a zero, while there is no count', () => {
    renderWithProviders(<Harness counts={null} />);
    expect(screen.getAllByLabelText('calculating')).toHaveLength(3);
    expect(document.querySelector('.age-strip__zones')).not.toHaveTextContent('0');
  });

  it('should mark estimated counts as approximate', () => {
    renderWithProviders(<Harness counts={{ ...COUNTS, estimated: true }} />);
    expect(screen.getAllByText(/≈/).length).toBeGreaterThan(0);
  });

  it('should explain an empty shop and keep the handles out of it', () => {
    renderWithProviders(<Harness histogram={{ ...HISTOGRAM, buckets: [], totalOrders: 0 }} />);
    expect(screen.getByTestId('age-strip-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('age-strip-handle-hide')).not.toBeInTheDocument();
  });

  it('should say when the orders could not be loaded instead of drawing zeros', () => {
    renderWithProviders(<Harness histogram={undefined} state="error" />);
    expect(screen.getByTestId('age-strip-error')).toBeInTheDocument();
    expect(screen.queryByTestId('age-strip-track')).not.toBeInTheDocument();
  });

  it('should step a handle with the on-screen steppers too', async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide after: longer' }));
    expect(screen.getByTestId('age-strip-handle-hide')).toHaveAttribute('aria-valuenow', '180');
  });

  it('should follow a drag, and stop following once the pointer is released or lost', () => {
    renderWithProviders(<Harness initial={{ hideAfterDays: 90, eraseAfterDays: 0 }} />);
    const track = screen.getByTestId('age-strip-track');
    track.getBoundingClientRect = (): DOMRect =>
      ({
        left: 0,
        width: 1000,
        top: 0,
        height: 10,
        right: 1000,
        bottom: 10,
        x: 0,
        y: 0,
      }) as DOMRect;
    const handle = screen.getByTestId('age-strip-handle-hide');

    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', buttons: 1 });
    // 20% of the strip = 20/90 of ten years ~ 810 days, snaps to 730.
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 200 });
    expect(handle).toHaveAttribute('aria-valuenow', '730');

    // The release was lost (no pointerup): a later move with no button pressed must not drag.
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 800 });
    expect(handle).toHaveAttribute('aria-valuenow', '730');

    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', buttons: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 800 });
    expect(handle).toHaveAttribute('aria-valuenow', '730');
  });
});
