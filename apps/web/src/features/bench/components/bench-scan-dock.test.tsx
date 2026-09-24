/**
 * The compact bench's scan dock (mobile-first rebuild, epic #3401)
 *
 * Three of these pin behaviour that is invisible to review: that a camera the
 * browser cannot run is REPORTED rather than silently absent, that picking an
 * item off the accordion changes what the dock counts into, and that the
 * typed field goes through the same callback a scan does.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { BenchScanDock } from './bench-scan-dock';

function line(over: Partial<BenchParcelLine> = {}): BenchParcelLine {
  return {
    workLineId: 'wl-1',
    productVariantId: 'ol_variant_1',
    name: 'Ceramic mug',
    sku: 'MUG-WHT-350',
    ean: '5901234123457',
    gtin: null,
    requiredQuantity: 2,
    verifiedQuantity: 0,
    imageUrl: null,
    attributes: null,
    binCode: null,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    ...over,
  };
}

const LINES = [
  line(),
  line({ workLineId: 'wl-2', name: 'Linen tea towel', sku: 'TWL-SND-5070', ean: '5901234199999' }),
];

function mount(over: Partial<React.ComponentProps<typeof BenchScanDock>> = {}) {
  const props = {
    layout: 'phone' as const,
    lines: LINES,
    activeLine: LINES[0],
    open: true,
    unreachable: false,
    pendingCount: 0,
    onSelectLine: vi.fn(),
    onScanValue: vi.fn(),
    onConfirm: vi.fn(),
    ...over,
  };
  return { props, ...renderWithProviders(<BenchScanDock {...props} />) };
}

describe('BenchScanDock (#3401)', () => {
  it('reports a camera this browser cannot run, rather than hiding the control', async () => {
    // happy-dom has no `BarcodeDetector`, which is exactly the Safari case the
    // hook resolves as `no-detector`. The dock must SAY so: a button that is
    // simply missing reads as a feature that is broken, and the packer's next
    // move is to hunt for it instead of typing.
    mount();

    const note = await screen.findByTestId('bench-dock-camera-problem');
    expect(note.textContent).toContain('Type the code instead');
    expect(screen.queryByRole('button', { name: /scan with camera/i })).not.toBeInTheDocument();
  });

  it('counts into the item the packer picks off the switcher', async () => {
    const user = userEvent.setup();
    const onSelectLine = vi.fn();
    mount({ onSelectLine });

    // The handle names the active item before it is opened, so opening it is a
    // choice rather than the only way to know where you are.
    const handle = screen.getByRole('button', { expanded: false });
    expect(handle.textContent).toContain('Item 1 of 2');

    await user.click(handle);
    const list = await screen.findByTestId('bench-dock-items');
    await user.click(within(list).getByText('Linen tea towel'));

    expect(onSelectLine).toHaveBeenCalledWith(expect.objectContaining({ workLineId: 'wl-2' }));
  });

  it('sends a typed code through the SAME callback a scan uses', async () => {
    const user = userEvent.setup();
    const onScanValue = vi.fn();
    mount({ onScanValue });

    await user.type(screen.getByLabelText('Scan this item'), '5901234123457{Enter}');

    // Not `onConfirm`: typing a code is a SCAN that arrived by another route,
    // and it must be matched against the box like any other (E2). `onConfirm`
    // is the hand-confirm, which is a different act.
    expect(onScanValue).toHaveBeenCalledWith('5901234123457');
  });

  it('offers no scanning at all on a closed box', () => {
    mount({ open: false });

    expect(screen.queryByLabelText('Scan this item')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm this item' })).not.toBeInTheDocument();
  });

  it('carries the work-list sheet only when the page offers one', async () => {
    const user = userEvent.setup();
    const onSwitchParcel = vi.fn();
    mount({ onSwitchParcel });

    await user.click(screen.getByRole('button', { expanded: false }));
    await user.click(await screen.findByRole('button', { name: /switch to another parcel/i }));

    expect(onSwitchParcel).toHaveBeenCalled();
  });
});
