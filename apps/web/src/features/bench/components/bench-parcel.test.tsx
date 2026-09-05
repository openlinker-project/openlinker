/**
 * The open box (#2418, `W3b-5`, stories D2–D4, E1–E6)
 *
 * Four of these tests exist because the behaviour they pin is invisible to
 * review — an absence, an identity, a request that is NOT made, and an alarm
 * that must not fire for anything else. Each was verified red-first by breaking
 * the behaviour and watching the test fail.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type {
  BenchParcel,
  BenchParcelLine,
  BenchVerificationResult,
} from '../api/bench-parcel.types';
import { resetGestureLogForTests } from '../lib/scanner-gesture-log';
import { BenchParcelView } from './bench-parcel';

/** Type a barcode at scanner speed and terminate it, exactly as #2416's hook expects. */
function scan(value: string): void {
  act(() => {
    for (const char of value) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

/**
 * Force the next parcel read without waiting out the poll.
 *
 * The surface re-reads on an interval AND on focus (`refetchOnWindowFocus`);
 * this drives the second, so the interrupt tests exercise the real
 * previous-versus-next comparison rather than a fake-timer approximation of it.
 */
async function advancePastPoll(): Promise<void> {
  await act(async () => {
    // React Query listens on `window` for this; `document` is dispatched too so
    // the helper does not depend on which of the two a future version picks.
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}

function line(over: Partial<BenchParcelLine> = {}): BenchParcelLine {
  return {
    workLineId: 'wl-1',
    productVariantId: 'ol_variant_1',
    name: 'Ceramic mug, matte white, 350 ml',
    sku: 'MUG-WHT-350',
    ean: '5901234123457',
    gtin: null,
    requiredQuantity: 2,
    verifiedQuantity: 0,
    ...over,
  };
}

function parcel(over: Partial<BenchParcel> = {}): BenchParcel {
  return {
    workId: 'w-1',
    version: 4,
    orderReference: 'OL-4471',
    buyerName: 'Anna Nowak',
    parcelIndex: 1,
    parcelTotal: 2,
    refusal: null,
    holdReason: null,
    closedAt: null,
    packedByUserId: null,
    lines: [line()],
    ...over,
  };
}

const PACKER = {
  id: 'user_packer',
  username: 'Marta Kowalczyk',
  email: null,
  role: 'packer',
  permissions: [],
  analyticsConsent: true,
} as const;

function mount(
  data: BenchParcel,
  bench: Partial<Record<string, unknown>> = {},
  onClose: () => void = vi.fn()
) {
  const apiClient = createMockApiClient({
    bench: {
      getParcel: vi.fn().mockResolvedValue(data),
      verifyUnit: vi.fn(),
      reopenParcel: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue({
        workId: data.workId,
        invoice: {
          state: 'ready',
          invoiceId: 'inv-1',
          documentNumber: 'FV/2026/09/0412',
          issuedAt: '2026-09-01T09:14:00Z',
          blockReason: null,
          unresolvedReason: null,
        },
        label: {
          state: 'ready',
          shipmentId: 'ol_shipment_1',
          carrier: 'InPost',
          trackingNumber: '620012345678',
          providerCode: null,
          carrierMessage: null,
          failedAt: null,
          carrierMessageRedacted: false,
        },
      }),
      listUnlabelledParcels: vi.fn().mockResolvedValue({ parcels: [], total: 0, truncated: false }),
      downloadInvoice: vi.fn(),
      ...bench,
    },
  });

  return {
    apiClient,
    onClose,
    ...renderWithProviders(<BenchParcelView workId="w-1" onClose={onClose} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({ ...PACKER, permissions: [] }),
    }),
  };
}

function verified(over: Partial<BenchVerificationResult> = {}): BenchVerificationResult {
  return {
    outcome: 'verified',
    reason: null,
    parcel: parcel({ lines: [line({ verifiedQuantity: 1 })] }),
    ...over,
  };
}

describe('BenchParcelView (#2418)', () => {
  beforeEach(() => {
    resetGestureLogForTests();
  });

  // ── RULE 1 — there is no commit control (D18/E5) ────────────────────────
  it('should render NO control that could commit or close the box', async () => {
    mount(parcel());
    await screen.findByTestId('bench-parcel');

    // Asserts the PERMITTED set, not a denied word list (#2905 review). A grep
    // for `done|finish|commit` can only refuse the spellings somebody thought
    // of — "Seal the box", "Mark packed", "Ready for dispatch" all sail past
    // it — whereas an exhaustive set means ANY new control on this surface
    // fails here until it is decided against D18. Not "no enabled one": none at
    // all, since the API has no close route and a disabled control would be a
    // promise nothing keeps.
    const names = screen
      .queryAllByRole('button')
      .map((button) => (button.textContent ?? '').trim())
      .sort();
    expect(names).toEqual(
      [
        // The bench's only exit (C2).
        'Back to the list',
        // E4's hand-confirm — one per unverified line, and the fixture has one.
        'Confirm this line',
        // C4's sound toggle. Renders one of two labels; this is the muted-off one.
        'Turn the sound off',
      ].sort()
    );
  });

  it('should promise the packer that the box closes itself', async () => {
    mount(parcel());
    expect(
      await screen.findByText(/This box closes itself the moment the last line is verified/i)
    ).toBeInTheDocument();
  });

  // ── RULE 2 — a hand-confirmed line is indistinguishable from a scanned one ──
  it('should render a hand-confirmed line identically to a scanned one (D20)', async () => {
    const user = userEvent.setup();
    const after = verified();

    const scanned = mount(parcel(), { verifyUnit: vi.fn().mockResolvedValue(after) });
    await screen.findByTestId('bench-parcel');
    scan('5901234123457');
    await waitFor(() => {
      expect(screen.getByTestId('bench-parcel-line').textContent).toContain('1 of 2');
    });
    const scannedMarkup = screen.getByTestId('bench-parcel-line').outerHTML;
    const scannedRequest = (
      scanned.apiClient.bench.verifyUnit as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    scanned.unmount();

    resetGestureLogForTests();
    const confirmed = mount(parcel(), { verifyUnit: vi.fn().mockResolvedValue(after) });
    await screen.findByTestId('bench-parcel');
    await user.click(screen.getByRole('button', { name: /confirm this line/i }));
    await waitFor(() => {
      expect(screen.getByTestId('bench-parcel-line').textContent).toContain('1 of 2');
    });
    const confirmedMarkup = screen.getByTestId('bench-parcel-line').outerHTML;
    const confirmedRequest = (
      confirmed.apiClient.bench.verifyUnit as ReturnType<typeof vi.fn>
    ).mock.calls[0];

    // Byte-identical markup: no badge, no class, no attribute, no tooltip.
    expect(confirmedMarkup).toBe(scannedMarkup);
    // And the same request shape — the wire names a LINE, never how it was read.
    expect(Object.keys(confirmedRequest[1] as object).sort()).toEqual(['gestureId', 'workLineId']);
    expect((confirmedRequest[1] as { workLineId: string }).workLineId).toBe(
      (scannedRequest[1] as { workLineId: string }).workLineId
    );
  });

  // ── RULE 4 — the wrong item is refused in the browser, with no request ──
  it('should refuse a wrong item without sending anything, naming what it expected', async () => {
    const verifyUnit = vi.fn();
    mount(parcel(), { verifyUnit });
    await screen.findByTestId('bench-parcel');

    scan('4006381333931');

    expect(await screen.findByText(/does not belong in this box/i)).toBeInTheDocument();
    // What it expected, and what it got — both named, per E2.
    const refusal = screen.getByRole('alert');
    expect(refusal.textContent).toContain('5901234123457');
    expect(refusal.textContent).toContain('4006381333931');
    // Nothing recorded: no request at all.
    expect(verifyUnit).not.toHaveBeenCalled();
  });

  // ── RULE 6 — the interrupt fires ONLY when the box becomes unpackable ────
  it('should NOT interrupt while nothing that stops packing has changed', async () => {
    // A buyer-name edit and a fresh version: everything a poll can legitimately
    // move without the box becoming unpackable. An interruption here is the
    // failure D21 names — it trains people to dismiss interruptions, and then
    // the one that matters is dismissed too.
    let current = parcel();
    const getParcel = vi.fn().mockImplementation(() => Promise.resolve(current));

    mount(parcel(), { getParcel });
    await screen.findByTestId('bench-parcel');

    current = parcel({ buyerName: 'Anna Nowak-Kowalska', version: 5 });
    await advancePastPoll();
    // Waiting for the CHANGE to render, not merely for a second call: a
    // duplicated mount fetch would satisfy a call count while proving nothing.
    await screen.findByText('Anna Nowak-Kowalska');

    expect(screen.queryByText(/has just been put on hold/i)).toBeNull();
    expect(screen.queryByText(/has just been cancelled/i)).toBeNull();
    expect(screen.queryByText(/can no longer be packed/i)).toBeNull();
  });

  it('should interrupt, naming the change, when the box is put on hold underneath the packer', async () => {
    let current = parcel();
    const getParcel = vi.fn().mockImplementation(() => Promise.resolve(current));

    mount(parcel(), { getParcel });
    await screen.findByTestId('bench-parcel');

    current = parcel({ refusal: 'held', holdReason: 'payment_review', version: 5 });
    await advancePastPoll();

    await waitFor(() => {
      expect(screen.getByText(/has just been put on hold/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Stop scanning, put the tote back on the trolley/i)).toBeInTheDocument();
  });

  // ── D2 / D3 ─────────────────────────────────────────────────────────────
  it('should always say which parcel of the order this is', async () => {
    mount(parcel());
    expect(await screen.findByText('Parcel 1 of 2')).toBeInTheDocument();
    expect(screen.getByText(/belongs in this box only/i)).toBeInTheDocument();
  });

  it('should refuse a box that must not be packed, in the same words as the list', async () => {
    mount(parcel({ refusal: 'held', holdReason: 'payment_review' }));

    expect(await screen.findByText(/On hold — do not pack this box/i)).toBeInTheDocument();
    expect(screen.getByText(/payment_review/)).toBeInTheDocument();
    // And no confirm control while the box may not be packed.
    expect(screen.queryByRole('button', { name: /confirm this line/i })).toBeNull();
  });

  it('should say a refusal it does not recognise is still a refusal', async () => {
    mount(parcel({ refusal: 'quarantined-by-a-newer-build' }));
    expect(await screen.findByText(/This box must not be packed/i)).toBeInTheDocument();
  });

  // ── E3 ──────────────────────────────────────────────────────────────────
  it('should refuse an over-pack in the mockup words, with the count unmoved', async () => {
    const full = line({ verifiedQuantity: 2 });
    mount(parcel({ lines: [full] }));
    await screen.findByTestId('bench-parcel');

    scan('5901234123457');

    expect(
      await screen.findByText(/this box takes 2\. The count stayed at 2\. The bench beeped\./i)
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('bench-parcel-line')).getByText('2 of 2')).toBeInTheDocument();
  });

  it('should render a server-side over-pack refusal in the same words', async () => {
    const verifyUnit = vi.fn().mockResolvedValue({
      outcome: 'refused',
      reason: 'over-packed',
      parcel: parcel({ lines: [line({ verifiedQuantity: 2, requiredQuantity: 2 })] }),
    });
    mount(parcel({ lines: [line({ verifiedQuantity: 1 })] }), { verifyUnit });
    await screen.findByTestId('bench-parcel');

    scan('5901234123457');

    expect(
      await screen.findByText(/this box takes 2\. The count stayed at 2\./i)
    ).toBeInTheDocument();
  });

  // ── E5 / E6 ─────────────────────────────────────────────────────────────
  it('should show the closed box with no control that closed it', async () => {
    mount(
      parcel({
        closedAt: '2026-09-04T14:32:00Z',
        lines: [line({ verifiedQuantity: 2 })],
      })
    );

    expect(await screen.findByTestId('bench-parcel-closed')).toBeInTheDocument();
    expect(
      screen.getByText(/The last scan closed it — there was nothing to press\./i)
    ).toBeInTheDocument();
  });

  it('should offer a reopen on a closed box, sending the version it was shown', async () => {
    const user = userEvent.setup();
    const reopenParcel = vi.fn().mockResolvedValue({
      outcome: 'reopened',
      reason: null,
      parcel: parcel({ lines: [line({ verifiedQuantity: 0 })] }),
    });
    mount(parcel({ closedAt: '2026-09-04T14:32:00Z', version: 9 }), { reopenParcel });

    await user.click(await screen.findByRole('button', { name: /reopen this box/i }));

    await waitFor(() => {
      expect(reopenParcel).toHaveBeenCalledWith('w-1', 9);
    });
  });

  it('should say the box has gone when a reopen is refused as shipped', async () => {
    const user = userEvent.setup();
    const reopenParcel = vi.fn().mockResolvedValue({
      outcome: 'refused',
      reason: 'shipped',
      parcel: parcel({ closedAt: '2026-09-04T14:32:00Z' }),
    });
    mount(parcel({ closedAt: '2026-09-04T14:32:00Z' }), { reopenParcel });

    await user.click(await screen.findByRole('button', { name: /reopen this box/i }));

    expect(
      await screen.findByText(/the goods are not in the building any more/i)
    ).toBeInTheDocument();
  });

  it('should distinguish a not-closed refusal from a shipped one', async () => {
    const user = userEvent.setup();
    const reopenParcel = vi.fn().mockResolvedValue({
      outcome: 'refused',
      reason: 'not-closed',
      parcel: parcel({ closedAt: '2026-09-04T14:32:00Z' }),
    });
    mount(parcel({ closedAt: '2026-09-04T14:32:00Z' }), { reopenParcel });

    await user.click(await screen.findByRole('button', { name: /reopen this box/i }));

    expect(await screen.findByText(/there is nothing to reopen/i)).toBeInTheDocument();
  });
});
