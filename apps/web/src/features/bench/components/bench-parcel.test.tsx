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
import { dispatchScannerBurst } from '../lib/scanner-burst.test-helper';
import { BenchParcelView } from './bench-parcel';

/** Type a barcode at scanner speed and terminate it, exactly as #2416's hook expects. */
function scan(value: string): void {
  act(() => {
    dispatchScannerBurst(value);
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

function parcel(over: Partial<BenchParcel> = {}): BenchParcel {
  return {
    workId: 'w-1',
    version: 4,
    orderReference: 'OL-4471',
    buyerName: 'Anna Nowak',
    totalAmount: null,
    currency: null,
    carrierName: null,
    dispatchByAt: null,
    parcelIndex: 1,
    parcelTotal: 2,
    refusal: null,
    holdReason: null,
    closedAt: null,
    packedByUserId: null,
    assignedToUserId: null,
    invoicePrintedAt: null,
    labelPrintedAt: null,
    completedAt: null,
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

  // ── RULE 1 — there is no commit control on an OPEN box (D18/E5) ─────────
  //
  // This fixture is OPEN (`closedAt: null`, the `parcel()` default), which is
  // the whole scope of the rule this test pins: D18 is about the box's
  // CONTENTS closing with nothing to press, not about what happens once it
  // already has. Pack-bench completion's "Mark as done here" is a genuine, later
  // write with a genuine control behind it (see `BenchCompletionPanel`'s own
  // docblock) and is rendered only once `closed` is true — so it can never
  // appear in THIS list, and this exhaustive assertion needs no exception for
  // it. The companion test below, in the "E5 / E6" block, asserts the mirror
  // image: on a CLOSED, not-yet-completed box, "Mark as done here" is exactly the
  // one NEW control the exhaustive set gains.
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
        // Two copy controls (mockup-parity epic #3401): the order reference on
        // the head, and the hero's barcode. They render a glyph, so their
        // `textContent` is that glyph rather than their accessible name — the
        // name is `aria-label`, which this assertion deliberately does not
        // read, since what it is guarding is the VISIBLE control inventory.
        // Neither commits anything: both write to the clipboard.
        '⧉',
        '⧉',
        // E4's hand-confirm — one per unverified line, and the fixture has one.
        'Confirm this item',
        // The hero card's own hand-confirm (mockup-parity epic #3401). The
        // SAME act as the row's, on the one line the box is waiting for next,
        // and it goes through the same `submit` — so it commits nothing the
        // row could not already commit. A deliberate addition to this
        // allowlist, not an oversight.
        'Confirm this item',
        // C4's sound toggle. Renders one of two labels; this is the muted-off one.
        'Turn the sound off',
        // #3405 (epic #3401) — the OPPOSITE of a commit: voids the single most
        // recent scan on an OPEN parcel, and cannot reach a closed box. A
        // deliberate addition to this allowlist, not an oversight.
        'Undo last scan',
      ].sort()
    );
  });

  // ── #3406 — someone else has this box open ──────────────────────────────
  describe('the collision banner (#3406)', () => {
    it('names the other packer, as the API masked them', async () => {
      mount(parcel(), {
        pingPresence: vi.fn().mockResolvedValue({
          collision: true,
          others: [{ displayName: 'P. Malinowski' }],
        }),
      });

      const banner = await screen.findByTestId('bench-collision');
      expect(banner.textContent).toContain('P. Malinowski');
      // The instruction is to CARRY ON. A packer's instinct on seeing a
      // colleague's name is to stop, and stopping is the wrong move.
      expect(banner.textContent).toContain('carry on');
    });

    it('renders nothing when the roster is empty', async () => {
      mount(parcel(), {
        pingPresence: vi.fn().mockResolvedValue({ collision: false, others: [] }),
      });

      await screen.findByTestId('bench-parcel');
      expect(screen.queryByTestId('bench-collision')).not.toBeInTheDocument();
    });

    it('renders NOTHING when the read fails — no banner and no reassurance', async () => {
      // The harness default rejects, which is the point: a read that did not
      // happen has no standing to say the box is this packer's alone, so the
      // surface must not draw the banner AND must not draw its opposite.
      mount(parcel());

      const surface = await screen.findByTestId('bench-parcel');
      expect(screen.queryByTestId('bench-collision')).not.toBeInTheDocument();
      expect(surface.textContent).not.toContain('open too');
    });
  });

  // ── #3405 — undo the most recent scan ───────────────────────────────────
  it('should report which line was undone', async () => {
    const user = userEvent.setup();
    const undoLastScan = vi.fn().mockResolvedValue({
      outcome: 'voided',
      reason: null,
      workLineId: 'wl-1',
      parcel: parcel({ lines: [line({ verifiedQuantity: 0 })] }),
    });
    mount(parcel(), { undoLastScan });

    await user.click(await screen.findByRole('button', { name: 'Undo last scan' }));

    expect(undoLastScan).toHaveBeenCalledWith('w-1');
    expect(await screen.findByTestId('bench-parcel-undo-notice')).toHaveTextContent(
      /Ceramic mug, matte white, 350 ml/
    );
  });

  it('should name the refusal reason without changing the box', async () => {
    const user = userEvent.setup();
    const undoLastScan = vi.fn().mockResolvedValue({
      outcome: 'refused',
      reason: 'nothing-to-undo',
      workLineId: null,
      parcel: parcel(),
    });
    mount(parcel(), { undoLastScan });

    await user.click(await screen.findByRole('button', { name: 'Undo last scan' }));

    expect(await screen.findByTestId('bench-parcel-undo-notice')).toHaveTextContent(
      'Nothing to undo yet.'
    );
  });

  it('should promise the packer that the box closes itself', async () => {
    mount(parcel());
    expect(
      await screen.findByText(/This box closes itself the moment the last item is verified/i)
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
    await user.click(screen.getByRole('button', { name: /confirm this item/i }));
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

  // ── "C" hand-confirms the first open line (#3339) ────────────────────────
  describe('the "c" keyboard shortcut', () => {
    it('should send the exact same request a click on "Confirm this item" would', async () => {
      const verifyUnit = vi.fn().mockResolvedValue(verified());
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      // Dispatched on `document.body`, not `document` itself: the shortcut
      // listener is registered `{ capture: true }` precisely so it answers
      // the burst check against the buffer as it stood BEFORE the scanner
      // hook's own bubble-phase listener processes this keystroke. That
      // capture-before-bubble ordering only exists when `document` is a
      // genuine ANCESTOR of the event target — which it is for every real
      // keydown (the currently-focused element, defaulting to `<body>`, per
      // `useScannerInput`'s own module docblock), but is NOT true of an
      // event dispatched directly on `document`, where capture and bubble
      // listeners on the target itself run in plain registration order.
      await act(async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
        await Promise.resolve();
      });

      expect(verifyUnit).toHaveBeenCalledTimes(1);
      const request = verifyUnit.mock.calls[0][1] as { workLineId: string; gestureId: string };
      expect(request.workLineId).toBe('wl-1');
      expect(Object.keys(request).sort()).toEqual(['gestureId', 'workLineId']);
    });

    it('should do nothing while typing in an editable element', async () => {
      const verifyUnit = vi.fn();
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
        await Promise.resolve();
      });

      expect(verifyUnit).not.toHaveBeenCalled();
      input.remove();
    });

    it('should ignore Ctrl+C so copying still works', async () => {
      const verifyUnit = vi.fn();
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })
        );
        await Promise.resolve();
      });

      expect(verifyUnit).not.toHaveBeenCalled();
    });

    it('should do nothing once every line is already verified', async () => {
      const verifyUnit = vi.fn();
      mount(parcel({ lines: [line({ verifiedQuantity: 2, requiredQuantity: 2 })] }), {
        verifyUnit,
      });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
        await Promise.resolve();
      });

      expect(verifyUnit).not.toHaveBeenCalled();
    });

    // Review finding (#3339): the scanner listener is on `document` with no
    // focused element required, so during a scan every keystroke — including
    // this handler's own — passes through the SAME stream. A barcode
    // containing a "c"/"C" anywhere past its first character must be read as
    // scan data ONLY, never as this shortcut hand-confirming a line nobody
    // scanned. Before the burst guard, the embedded "C" here fired the
    // shortcut in addition to (or instead of) the scan being refused.
    it('should treat a "c" embedded in a scanner burst as scan data, never as the shortcut', async () => {
      const verifyUnit = vi.fn();
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        // `document.body` for the same reason as the test above — real
        // capture-before-bubble ordering requires `document` to be a genuine
        // ancestor of the dispatch target, not the target itself.
        //
        // The burst does NOT match the mounted line's SKU/EAN, so ANY
        // verifyUnit call recorded here could only have come from the "C"
        // mid-burst being misread as the shortcut, not from a legitimate
        // scan match (which would raise a "wrong item" notice instead).
        dispatchScannerBurst('XYZC1234', document.body);
        await Promise.resolve();
      });

      expect(verifyUnit).not.toHaveBeenCalled();
    });
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

  // ── #3418 (epic #3401) — the order-head status pill ────────────────────
  describe('the order-head status pill', () => {
    it('reads "In progress" for an open, un-refused box', async () => {
      mount(parcel({ refusal: null, closedAt: null }));
      expect(await screen.findByText('In progress')).toBeInTheDocument();
    });

    it('reads "On hold" for a held box', async () => {
      mount(parcel({ refusal: 'held', holdReason: 'payment_review', closedAt: null }));
      expect(await screen.findByText('On hold')).toBeInTheDocument();
    });

    it('reads "Cancelled" for a cancelled box', async () => {
      mount(parcel({ refusal: 'cancelled', closedAt: null }));
      expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    });

    it('reads "Packed" for a closed, un-refused box', async () => {
      mount(parcel({ refusal: null, closedAt: '2026-09-04T14:36:00Z' }));
      expect(await screen.findByText('Packed')).toBeInTheDocument();
    });
  });

  it('should refuse a box that must not be packed, in the same words as the list', async () => {
    mount(parcel({ refusal: 'held', holdReason: 'payment_review' }));

    expect(await screen.findByText(/On hold — do not pack this box/i)).toBeInTheDocument();
    expect(screen.getByText(/payment_review/)).toBeInTheDocument();
    // And no confirm control while the box may not be packed.
    expect(screen.queryByRole('button', { name: /confirm this item/i })).toBeNull();
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

  // ── Pack-bench completion — the second, explicit act after a box closes ──
  describe('pack-bench completion', () => {
    /**
     * The other half of RULE 1's story. That test pins the OPEN surface's
     * exhaustive control set and needs no exception for this control, because
     * it can never render there. This one pins the mirror fact: once the box
     * is CLOSED, "Mark as done here" is a real, offered control — a commit-sounding
     * name that is correct here precisely because it is a genuine write
     * (pack-bench completion), not the box's contents auto-closing.
     */
    it('should offer "Mark as done here" on a closed, not-yet-completed box', async () => {
      mount(parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: null }));

      expect(
        await screen.findByRole('button', { name: /mark as done here/i })
      ).toBeInTheDocument();
    });

    it('should NOT offer "Mark as done here" on an open box', async () => {
      mount(parcel());
      await screen.findByTestId('bench-parcel');

      expect(screen.queryByRole('button', { name: /mark as done here/i })).not.toBeInTheDocument();
    });

    it('should show it was already marked sent, with no button left to press', async () => {
      mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          completedAt: '2026-09-04T14:40:00Z',
        })
      );

      expect(await screen.findByTestId('bench-parcel-completed')).toBeInTheDocument();
      expect(screen.getByText(/Marked done at/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark as done here/i })).not.toBeInTheDocument();
    });

    it('should complete straight through when both papers were already printed, and STAY on the parcel', async () => {
      const user = userEvent.setup();
      const completeParcel = vi.fn().mockResolvedValue({
        outcome: 'completed',
        reason: null,
        parcel: parcel({
          closedAt: '2026-09-04T14:32:00Z',
          completedAt: '2026-09-04T14:40:00Z',
        }),
      });
      const { onClose } = mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          version: 9,
          invoicePrintedAt: '2026-09-04T14:33:00Z',
          labelPrintedAt: '2026-09-04T14:34:00Z',
        }),
        { completeParcel }
      );

      await user.click(await screen.findByRole('button', { name: /mark as done here/i }));

      // No dialog: nothing was left unprinted, so pressing it went straight
      // through rather than asking first.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(completeParcel).toHaveBeenCalledWith('w-1', 9);
      });
      await waitFor(() => {
        // STAYS OPEN, deliberately (#3415). Closing here shut the pane on the
        // very success that renders "Take this back", and there is no second
        // route in: a completed row is dropped from both rail sections and
        // "Packed today" is a read-only log. The undo was unreachable.
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    it('should ask first when the label was never printed, naming what is missing', async () => {
      const user = userEvent.setup();
      const completeParcel = vi.fn();
      mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          invoicePrintedAt: '2026-09-04T14:33:00Z',
          labelPrintedAt: null,
        }),
        { completeParcel }
      );

      await user.click(await screen.findByRole('button', { name: /mark as done here/i }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/label.*has not been printed yet/i)).toBeInTheDocument();
      // Never says the invoice is missing when only the label is.
      expect(within(dialog).queryByText(/invoice.*has not been printed yet/i)).not.toBeInTheDocument();
      expect(completeParcel).not.toHaveBeenCalled();
    });

    // Regression (#3340): the label print used to go through
    // `apiClient.shipments.downloadLabel(shipmentId)`, the route any caller
    // with a shipment id can reach and which no longer stamps a print. It now
    // goes through `apiClient.bench.downloadLabel(workId)` — the ONLY route
    // that stamps `labelPrintedAt`, reachable only through the work.
    it('should print the label THROUGH THE WORK, not the shipment id, and let the packer go ahead anyway', async () => {
      const user = userEvent.setup();
      const downloadLabel = vi.fn().mockResolvedValue(new Blob(['%PDF']));
      const completeParcel = vi.fn().mockResolvedValue({
        outcome: 'completed',
        reason: null,
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' }),
      });
      const { apiClient } = mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          version: 9,
          invoicePrintedAt: '2026-09-04T14:33:00Z',
          labelPrintedAt: null,
        }),
        { completeParcel }
      );
      apiClient.bench.downloadLabel = downloadLabel;

      await user.click(await screen.findByRole('button', { name: /mark as done here/i }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: /print the label/i }));
      await waitFor(() => {
        expect(downloadLabel).toHaveBeenCalledWith('w-1');
      });

      // The packer goes ahead regardless — the dialog never blocks a
      // completion that the operator wants to make now.
      await user.click(within(dialog).getByRole('button', { name: /mark as done anyway/i }));
      await waitFor(() => {
        expect(completeParcel).toHaveBeenCalledWith('w-1', 9);
      });
    });

    it('should say a stale token means the screen has moved on, and NOT return to the list', async () => {
      const user = userEvent.setup();
      const completeParcel = vi.fn().mockResolvedValue({
        outcome: 'refused',
        reason: 'version-conflict',
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', version: 10 }),
      });
      const { onClose } = mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          version: 9,
          invoicePrintedAt: '2026-09-04T14:33:00Z',
          labelPrintedAt: '2026-09-04T14:34:00Z',
        }),
        { completeParcel }
      );

      await user.click(await screen.findByRole('button', { name: /mark as done here/i }));

      expect(await screen.findByText(/somebody else changed this box/i)).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('should treat "already-completed" as good news, not an error, and STAY on the parcel', async () => {
      const completeParcel = vi.fn().mockResolvedValue({
        outcome: 'refused',
        reason: 'already-completed',
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:31:00Z' }),
      });
      const { onClose } = mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          invoicePrintedAt: '2026-09-04T14:33:00Z',
          labelPrintedAt: '2026-09-04T14:34:00Z',
        }),
        { completeParcel }
      );
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: /mark as done here/i }));

      await waitFor(() => {
        // STAYS OPEN, deliberately (#3415). Closing here shut the pane on the
        // very success that renders "Take this back", and there is no second
        // route in: a completed row is dropped from both rail sections and
        // "Packed today" is a read-only log. The undo was unreachable.
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    /**
     * The live defect this feature shipped with: on a box the carrier refused
     * a label for, the completion hint claimed the box was "labelled, and on
     * the trolley" four lines under `BenchDocumentsPanel`'s own "this box
     * cannot go out". The copy must never assert a label exists, and the
     * control must still be offered — the packer really is finished with the
     * box, whatever the carrier did with it (see the completion copy's own
     * docblock).
     */
    it('should offer completion, honestly worded, on a box the carrier refused a label for', async () => {
      mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          invoicePrintedAt: '2026-09-04T14:33:00Z',
        }),
        {
          getDocuments: vi.fn().mockResolvedValue({
            workId: 'w-1',
            invoice: {
              state: 'ready',
              invoiceId: 'inv-1',
              documentNumber: 'FV/2026/09/0412',
              issuedAt: '2026-09-01T09:14:00Z',
              blockReason: null,
              unresolvedReason: null,
            },
            label: {
              state: 'unavailable',
              shipmentId: null,
              carrier: null,
              trackingNumber: null,
              providerCode: 'ADDR_INCOMPLETE',
              carrierMessage: null,
              carrierMessageRedacted: false,
              failedAt: '2026-09-04T14:20:00Z',
            },
          }),
        }
      );

      // The unlabelled panel's own claim: this box cannot go out.
      expect(await screen.findByTestId('bench-documents-unlabelled')).toBeInTheDocument();

      // The completion control is still offered — the packer's part is done —
      // and its hint never claims the box is labelled or sent.
      expect(screen.getByRole('button', { name: /mark as done here/i })).toBeInTheDocument();
      expect(screen.queryByText(/labelled/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/on the trolley/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/\bsent\b/i)).not.toBeInTheDocument();
      expect(screen.getByText(/off your bench now/i)).toBeInTheDocument();
    });
  });

  // ── Take back a completion (#3415) — the way back that is not a reopen ──
  describe('take back a completion', () => {
    it('should offer "Take this back" only once the parcel is completed', async () => {
      mount(parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: null }));
      await screen.findByRole('button', { name: /mark as done here/i });

      expect(
        screen.queryByRole('button', { name: /take this back/i })
      ).not.toBeInTheDocument();
    });

    it('should offer "Take this back" on a completed parcel', async () => {
      mount(
        parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' })
      );

      expect(
        await screen.findByRole('button', { name: /take this back/i })
      ).toBeInTheDocument();
    });

    it('should send the token read WITH the parcel', async () => {
      const user = userEvent.setup();
      const undoCompletion = vi.fn().mockResolvedValue({
        outcome: 'undone',
        reason: null,
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: null, version: 11 }),
      });
      mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          completedAt: '2026-09-04T14:40:00Z',
          version: 10,
        }),
        { undoCompletion }
      );

      await user.click(await screen.findByRole('button', { name: /take this back/i }));

      await waitFor(() => {
        expect(undoCompletion).toHaveBeenCalledWith('w-1', 10);
      });
    });

    it('should return to the ordinary completion action once undone', async () => {
      const user = userEvent.setup();
      const undoCompletion = vi.fn().mockResolvedValue({
        outcome: 'undone',
        reason: null,
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: null, version: 11 }),
      });
      mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          completedAt: '2026-09-04T14:40:00Z',
          version: 10,
        }),
        { undoCompletion }
      );

      await user.click(await screen.findByRole('button', { name: /take this back/i }));

      // The undo mutation's own `setQueryData` replaces the cache with the
      // fresh, un-completed parcel, so the panel falls back out of the
      // completed branch on the next render.
      expect(
        await screen.findByRole('button', { name: /mark as done here/i })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /take this back/i })).not.toBeInTheDocument();
    });

    it('should say a stale token means the screen has moved on', async () => {
      const user = userEvent.setup();
      const undoCompletion = vi.fn().mockResolvedValue({
        outcome: 'refused',
        reason: 'version-conflict',
        parcel: parcel({
          closedAt: '2026-09-04T14:32:00Z',
          completedAt: '2026-09-04T14:40:00Z',
          version: 11,
        }),
      });
      mount(
        parcel({
          closedAt: '2026-09-04T14:32:00Z',
          completedAt: '2026-09-04T14:40:00Z',
          version: 10,
        }),
        { undoCompletion }
      );

      await user.click(await screen.findByRole('button', { name: /take this back/i }));

      expect(await screen.findByText(/somebody else changed this box/i)).toBeInTheDocument();
    });

    /**
     * `not-completed` is only ever reached when the box was ALREADY un-done
     * by a peer — core's own comment on the guard states `completedAt` is
     * already `null` by the time this reason is reached. The parcel the
     * server returns therefore already carries the state the packer was
     * asking for, and the cache write that fact triggers takes the panel
     * straight back to its ordinary, not-yet-completed shape — the same good
     * ending as a genuine `undone`, reached by a different route.
     */
    it('should land on the ordinary completion action, when a race already undid it', async () => {
      const user = userEvent.setup();
      const undoCompletion = vi.fn().mockResolvedValue({
        outcome: 'refused',
        reason: 'not-completed',
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: null }),
      });
      mount(
        parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' }),
        { undoCompletion }
      );

      await user.click(await screen.findByRole('button', { name: /take this back/i }));

      expect(
        await screen.findByRole('button', { name: /mark as done here/i })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /take this back/i })).not.toBeInTheDocument();
    });

    /**
     * The ADR-074 lock, and it must NOT reuse the trolley-bound wording a held
     * or cancelled box gets (`verify.notPackable`) — this box is fine, it is
     * simply assigned to someone else right now, and sending a packer to the
     * trolley over it would be a real operational error rather than a
     * wording one.
     */
    it('should name the lock without sending the packer back to the trolley', async () => {
      const user = userEvent.setup();
      const undoCompletion = vi.fn().mockResolvedValue({
        outcome: 'refused',
        reason: 'not-claimable-by-viewer',
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' }),
      });
      mount(
        parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' }),
        { undoCompletion }
      );

      await user.click(await screen.findByRole('button', { name: /take this back/i }));

      expect(
        await screen.findByText(/assigned to someone else right now/i)
      ).toBeInTheDocument();
      expect(screen.queryByText(/trolley/i)).not.toBeInTheDocument();
    });

    it('should say something went through wrong, for a refusal this build does not recognise', async () => {
      const user = userEvent.setup();
      const undoCompletion = vi.fn().mockResolvedValue({
        outcome: 'refused',
        reason: 'something-newer',
        parcel: parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' }),
      });
      mount(
        parcel({ closedAt: '2026-09-04T14:32:00Z', completedAt: '2026-09-04T14:40:00Z' }),
        { undoCompletion }
      );

      await user.click(await screen.findByRole('button', { name: /take this back/i }));

      expect(
        await screen.findByText(/this bench cannot say why/i)
      ).toBeInTheDocument();
    });
  });
});
