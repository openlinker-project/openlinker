/**
 * Behaviour under failure (#2421, `W3b-8`, stories H1, H2, C4)
 *
 * A separate file from `bench-parcel.test.tsx` because the subject is
 * different: that one pins what the surface DOES, this one pins what it does
 * when the answer is late, absent or contradictory. Every assertion here was
 * verified red-first by breaking the behaviour it covers.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../shared/api/api-error';
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
import {
  resetBenchAudioForTests,
  SCAN_SOUND_PATTERNS,
  soundsDistinguishable,
} from '../lib/bench-scan-sound';
import { resetGestureLogForTests } from '../lib/scanner-gesture-log';
import { BenchParcelView } from './bench-parcel';

function scan(value: string): void {
  act(() => {
    for (const char of value) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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

function mount(data: BenchParcel, bench: Partial<Record<string, unknown>> = {}) {
  const apiClient = createMockApiClient({
    bench: {
      getParcel: vi.fn().mockResolvedValue(data),
      verifyUnit: vi.fn(),
      reopenParcel: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue({
        workId: data.workId,
        invoice: { state: 'missing', blockReason: null, unresolvedReason: null },
        label: { state: 'missing', failedAt: null, carrierMessageRedacted: false },
      }),
      listUnlabelledParcels: vi.fn().mockResolvedValue({ parcels: [], total: 0, truncated: false }),
      downloadInvoice: vi.fn(),
      ...bench,
    },
  });

  return {
    apiClient,
    ...renderWithProviders(<BenchParcelView workId="w-1" onClose={vi.fn()} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({ ...PACKER, permissions: [] }),
    }),
  };
}

/** A request that never reaches OpenLinker — the shape `fromNetworkFailure` mints. */
function networkFailure(): ApiError {
  return ApiError.fromNetworkFailure(new TypeError('Failed to fetch'));
}

/** A promise the test resolves by hand, so a gesture can be held IN FLIGHT. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function verified(over: Partial<BenchVerificationResult> = {}): BenchVerificationResult {
  return {
    outcome: 'verified',
    reason: null,
    parcel: parcel({ version: 5, lines: [line({ verifiedQuantity: 1 })] }),
    ...over,
  };
}

describe('bench under failure (#2421)', () => {
  beforeEach(() => {
    resetGestureLogForTests();
    resetBenchAudioForTests();
    window.localStorage.clear();
  });

  /**
   * Put the browser back online, and NOT merely for tidiness.
   *
   * React Query's `onlineManager` is a MODULE-LEVEL singleton, not per
   * `QueryClient`, and it listens on `window` for `offline`/`online`. A test
   * that dispatches `offline` therefore pauses every query in every LATER test
   * in this file — `fetchStatus: 'paused'`, so the parcel read never runs and
   * the surface sits on its loading state forever. That surfaces as a timeout
   * on `findByTestId('bench-parcel')` in a test that has nothing to do with
   * being offline, which is a long way from the cause. Restoring it here is
   * what keeps the leak from being rediscovered.
   */
  afterEach(() => {
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
  });

  // ── H2 — never claim a state the system has not confirmed ────────────────
  describe('H2 — the surface never claims a state it has not confirmed', () => {
    it('should NOT mark a line verified while the scan is still in flight', async () => {
      const pending = deferred<BenchVerificationResult>();
      mount(parcel({ lines: [line({ requiredQuantity: 1 })] }), {
        verifyUnit: vi.fn().mockReturnValue(pending.promise),
      });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');

      // The gesture is out and unanswered. The count is the SERVER's, so it has
      // not moved, and the badge still says the line is not scanned.
      await screen.findByTestId('bench-parcel-line-pending');
      const row = screen.getByTestId('bench-parcel-line');
      expect(within(row).getByText('0 of 1')).toBeInTheDocument();
      expect(row.textContent).toContain('Not scanned yet');
      expect(row.textContent).not.toContain('Verified');
    });

    it('should say plainly that the scan is on its way', async () => {
      const pending = deferred<BenchVerificationResult>();
      mount(parcel(), { verifyUnit: vi.fn().mockReturnValue(pending.promise) });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');

      // In WORDS, on the row and in the live region — the two places a packer
      // reads from. Neither is a spinner: a spinner says "busy", not "your last
      // scan is the thing that is busy".
      expect(await screen.findByTestId('bench-parcel-line-pending')).toHaveTextContent(
        /sent — waiting for the system/i
      );
      await waitFor(() => {
        expect(screen.getByTestId('bench-parcel-announcer').textContent).toMatch(
          /sent\. Waiting for the system\./i
        );
      });
    });

    it('should count TWO gestures out on one line, not merely "waiting"', async () => {
      const first = deferred<BenchVerificationResult>();
      const second = deferred<BenchVerificationResult>();
      const verifyUnit = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');
      scan('5901234123457');

      // A two-unit line legitimately has two gestures out at once; a boolean
      // would understate it and the packer could not tell whether their second
      // scan registered at all.
      await waitFor(() => {
        expect(screen.getByTestId('bench-parcel-line-pending').textContent).toContain('(2)');
      });
      expect(verifyUnit).toHaveBeenCalledTimes(2);
    });

    it('should tell the packer their scan counted, once the server said so', async () => {
      mount(parcel(), { verifyUnit: vi.fn().mockResolvedValue(verified()) });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');

      await waitFor(() => {
        expect(screen.getByTestId('bench-parcel-announcer').textContent).toMatch(
          /counted\. 1 of 2\./i
        );
      });
      // …and the in-flight marker is gone, so "waiting" and "counted" are never
      // both on screen for one gesture.
      expect(screen.queryByTestId('bench-parcel-line-pending')).toBeNull();
    });

    it('should still account for a gesture that a later one OVERTOOK', async () => {
      // The trap this test exists for, measured rather than assumed: one
      // `useMutation` observer serves every gesture, and a second `mutate` call
      // ORPHANS the first — TanStack Query drops the per-call callbacks of
      // every mutation but the latest. Bookkeeping placed there would leave the
      // overtaken gesture's "waiting" marker standing for ever, which is a
      // packer permanently unable to tell whether their scan counted.
      const first = deferred<BenchVerificationResult>();
      const second = deferred<BenchVerificationResult>();
      const verifyUnit = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');
      scan('5901234123457');
      await waitFor(() => {
        expect(screen.getByTestId('bench-parcel-line-pending').textContent).toContain('(2)');
      });

      // The LATER gesture answers first, so the earlier one is the orphan.
      await act(async () => {
        second.resolve(
          verified({ parcel: parcel({ version: 6, lines: [line({ verifiedQuantity: 2 })] }) })
        );
        await Promise.resolve();
      });
      await act(async () => {
        first.resolve(
          verified({ parcel: parcel({ version: 5, lines: [line({ verifiedQuantity: 1 })] }) })
        );
        await Promise.resolve();
      });

      // Both accounted for: nothing is still shown as waiting.
      await waitFor(() => {
        expect(screen.queryByTestId('bench-parcel-line-pending')).toBeNull();
      });
    });

    it('should show an overtaken gesture REFUSAL rather than losing it', async () => {
      // Same orphaning hazard, on the refusal. A packer whose over-pack refusal
      // is silently dropped because a later scan answered first believes a unit
      // went in that did not.
      const first = deferred<BenchVerificationResult>();
      const second = deferred<BenchVerificationResult>();
      const verifyUnit = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');
      scan('5901234123457');
      await waitFor(() => {
        expect(verifyUnit).toHaveBeenCalledTimes(2);
      });

      await act(async () => {
        second.resolve(verified());
        await Promise.resolve();
      });
      await act(async () => {
        first.resolve({
          outcome: 'refused',
          reason: 'over-packed',
          parcel: parcel({ version: 6, lines: [line({ verifiedQuantity: 2 })] }),
        });
        await Promise.resolve();
      });

      expect(await screen.findByText(/The count stayed at 2/i)).toBeInTheDocument();
    });

    it('should say a scan with NO answer is not counted, and name which one', async () => {
      mount(parcel(), { verifyUnit: vi.fn().mockRejectedValue(networkFailure()) });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');

      const alert = await screen.findByText(/That scan has no answer yet/i);
      expect(alert).toBeInTheDocument();
      // Names the ITEM. With several gestures in flight a bare "that did not go
      // through" leaves the packer unable to tell which — the state H2 forbids.
      expect(screen.getByRole('alert').textContent).toContain('Ceramic mug');
      expect(screen.getByRole('alert').textContent).toMatch(/It is not counted/i);
      expect(screen.getByRole('alert').textContent).toMatch(/never counted twice/i);
    });

    it('should NOT let an older answer lower a count a newer answer already raised', async () => {
      // The ordering hazard this whole guard exists for: two gestures out, and
      // the answer recording unit 1 lands AFTER the answer recording unit 2.
      // Unguarded, the surface would fall back to "1 of 2" for a box the server
      // holds at "2 of 2" — and under D18's auto-close nothing ever compares
      // the two, so the packer scans a third unit and is refused for a box that
      // is simply finished.
      const first = deferred<BenchVerificationResult>();
      const second = deferred<BenchVerificationResult>();
      const verifyUnit = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');
      scan('5901234123457');
      await waitFor(() => {
        expect(verifyUnit).toHaveBeenCalledTimes(2);
      });

      // The NEWER answer lands first.
      await act(async () => {
        second.resolve(
          verified({ parcel: parcel({ version: 6, lines: [line({ verifiedQuantity: 2 })] }) })
        );
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(within(screen.getByTestId('bench-parcel-line')).getByText('2 of 2')).toBeInTheDocument();
      });

      // …then the older one, carrying the lower version.
      await act(async () => {
        first.resolve(
          verified({ parcel: parcel({ version: 5, lines: [line({ verifiedQuantity: 1 })] }) })
        );
        await Promise.resolve();
      });

      expect(within(screen.getByTestId('bench-parcel-line')).getByText('2 of 2')).toBeInTheDocument();
      expect(within(screen.getByTestId('bench-parcel-line')).queryByText('1 of 2')).toBeNull();
    });

    it('should NOT let an older REFUSAL replace a newer one on screen', async () => {
      // The other half of the sequence guard. Two refusals, the older answering
      // last: the packer must be left reading the refusal for the item still in
      // their hand, not the one they already put down.
      const slowRefusal = deferred<BenchVerificationResult>();
      mount(parcel(), { verifyUnit: vi.fn().mockReturnValue(slowRefusal.promise) });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457'); // gesture 1 — will be refused, slowly
      scan('4006381333931'); // gesture 2 — wrong item, refused in the browser

      await screen.findByText(/does not belong in this box/i);

      await act(async () => {
        slowRefusal.resolve({
          outcome: 'refused',
          reason: 'over-packed',
          parcel: parcel({ version: 5, lines: [line({ verifiedQuantity: 2 })] }),
        });
        await Promise.resolve();
      });

      expect(screen.getByText(/does not belong in this box/i)).toBeInTheDocument();
      expect(screen.queryByText(/The count stayed at 2/i)).toBeNull();
    });

    it('should NOT let an older success erase a newer refusal', async () => {
      // Same hazard, on the notice rather than the count. A packer whose
      // wrong-item warning vanishes by itself carries on packing the wrong item.
      const slowAccept = deferred<BenchVerificationResult>();
      mount(parcel(), { verifyUnit: vi.fn().mockReturnValue(slowAccept.promise) });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457'); // gesture 1 — accepted, but slowly
      scan('4006381333931'); // gesture 2 — wrong item, refused in the browser

      await screen.findByText(/does not belong in this box/i);

      await act(async () => {
        slowAccept.resolve(verified());
        await Promise.resolve();
      });

      expect(screen.getByText(/does not belong in this box/i)).toBeInTheDocument();
    });
  });

  // ── H1 — a network blip does not cost work ───────────────────────────────
  describe('H1 — a network blip does not cost my work', () => {
    it('should keep every confirmed unit on screen when the bench loses touch', async () => {
      // "Already recorded" means already accepted by the server. Those units
      // must survive — this is the half of H1 that is about not losing work.
      const withOneIn = parcel({ lines: [line({ verifiedQuantity: 1 })] });
      const getParcel = vi
        .fn()
        .mockResolvedValueOnce(withOneIn)
        .mockRejectedValue(networkFailure());
      mount(withOneIn, { getParcel });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
      });

      expect(await screen.findByText(/cannot reach OpenLinker/i)).toBeInTheDocument();
      expect(within(screen.getByTestId('bench-parcel-line')).getByText('1 of 2')).toBeInTheDocument();
    });

    it('should say plainly that it cannot reach OpenLinker, and that nothing was lost', async () => {
      mount(parcel());
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
      });

      const banner = await screen.findByText(/This bench cannot reach OpenLinker/i);
      expect(banner).toBeInTheDocument();
      expect(screen.getByText(/nothing you scanned has been lost/i)).toBeInTheDocument();
      // Never "you are offline": one failed request establishes nothing about
      // the packer's own network.
      expect(document.body.textContent).not.toMatch(/you are offline/i);
    });

    it('should REFUSE a scan out loud rather than swallowing it', async () => {
      const verifyUnit = vi.fn();
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
      });
      await screen.findByText(/This bench cannot reach OpenLinker/i);

      scan('5901234123457');

      // Refused, said so, and nothing sent. The scanner stays ATTACHED while
      // out of touch precisely so this can happen — detaching the listener
      // would swallow the gesture instead of refusing it.
      expect(await screen.findByText(/Not counted — the bench cannot reach/i)).toBeInTheDocument();
      expect(verifyUnit).not.toHaveBeenCalled();
    });

    it('should refuse the hand-confirm too, saying why rather than hiding it', async () => {
      const user = userEvent.setup();
      mount(parcel());
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
      });
      await screen.findByText(/This bench cannot reach OpenLinker/i);

      // Shown-and-refused, not hidden: a control that vanishes reads as a
      // missing feature and the packer hunts for it.
      const confirm = await screen.findByRole('button', { name: /confirm this line/i });
      expect(confirm).toBeDisabled();
      expect(screen.getByText(/Not while the bench is out of touch/i)).toBeInTheDocument();
      await user.click(confirm);
    });

    it('should clear itself once the server answers again, WITHOUT the packer scanning', async () => {
      // The latch hazard: `navigator.onLine` never goes false when the SERVER
      // is unreachable over a working LAN, so an `online`-only recovery would
      // refuse work for the rest of the shift on a network that came back.
      let fail = true;
      const getParcel = vi
        .fn()
        .mockImplementation(() =>
          fail ? Promise.reject(networkFailure()) : Promise.resolve(parcel())
        );

      // First read succeeds so the surface mounts, then the poll starts failing.
      getParcel.mockResolvedValueOnce(parcel());
      mount(parcel(), { getParcel });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        window.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      await screen.findByText(/This bench cannot reach OpenLinker/i);

      fail = false;
      await act(async () => {
        window.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.queryByText(/This bench cannot reach OpenLinker/i)).toBeNull();
      });
    });

    it('should NOT store a refused scan anywhere — this is not an offline queue', async () => {
      const verifyUnit = vi.fn();
      mount(parcel(), { verifyUnit });
      await screen.findByTestId('bench-parcel');

      await act(async () => {
        window.dispatchEvent(new Event('offline'));
        await Promise.resolve();
      });
      await screen.findByText(/This bench cannot reach OpenLinker/i);
      scan('5901234123457');
      await screen.findByText(/Not counted — the bench cannot reach/i);

      // Coming back must not replay it. A queue would have to decide who a
      // replayed gesture is attributed to on a shared roaming terminal, and
      // could close a box on a count assembled after the packer walked away.
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(screen.queryByText(/This bench cannot reach OpenLinker/i)).toBeNull();
      });

      expect(verifyUnit).not.toHaveBeenCalled();
    });
  });

  // ── C4 — audible, and never audio-only ───────────────────────────────────
  describe('C4 — usable in the conditions of a floor', () => {
    it('should render an over-pack refusal identically with the sound off', async () => {
      // Silencing the bench must not silence the screen. Compared as markup
      // rather than by reading a flag, so a future tint or badge keyed on the
      // mute fails here.
      const full = parcel({ lines: [line({ verifiedQuantity: 2 })] });

      const loud = mount(full);
      await screen.findByTestId('bench-parcel');
      scan('5901234123457');
      await screen.findByText(/The count stayed at 2/i);
      const loudMarkup = screen.getByRole('alert').outerHTML;
      loud.unmount();

      resetGestureLogForTests();
      window.localStorage.setItem('ol.bench.audioMuted', 'true');

      mount(full);
      await screen.findByTestId('bench-parcel');
      scan('5901234123457');
      await screen.findByText(/The count stayed at 2/i);

      expect(screen.getByRole('alert').outerHTML).toBe(loudMarkup);
    });

    it('should offer a control that silences the sound and nothing else', async () => {
      const user = userEvent.setup();
      mount(parcel());
      await screen.findByTestId('bench-parcel');

      // The control's accessible name is the ACTION and the state is separate
      // text beside it. Deliberately not `aria-pressed` on an action-named
      // button — "Turn the sound off, toggle button, pressed" reads as though
      // off were already selected.
      expect(screen.getByText(/^Sound on$/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /turn the sound off/i }));

      expect(window.localStorage.getItem('ol.bench.audioMuted')).toBe('true');
      expect(screen.getByRole('button', { name: /turn the sound on/i })).toBeInTheDocument();
      expect(screen.getByText(/^Sound off$/)).toBeInTheDocument();
    });

    it('should NOT confirm the unmute with a sound that means a refusal', async () => {
      // Reusing the over-scan signature as a "sound is back on" chirp teaches
      // the packer that tone means the toggle worked — which is precisely the
      // association that stops it meaning "this box already has enough of
      // these" when it matters. `confirm` is the one non-refusal kind.
      expect(soundsDistinguishable('confirm', 'over-scan')).toBe(true);
      expect(soundsDistinguishable('confirm', 'wrong-item')).toBe(true);

      const user = userEvent.setup();
      window.localStorage.setItem('ol.bench.audioMuted', 'true');
      mount(parcel());
      await screen.findByTestId('bench-parcel');

      const played: string[] = [];
      class RecordingContext {
        currentTime = 0;
        destination = {};
        resume(): void {}
        createOscillator(): unknown {
          return {
            type: '',
            frequency: { value: 0 },
            connect: () => undefined,
            start: (at: number) => played.push(`start@${String(at)}`),
            stop: () => undefined,
          };
        }
        createGain(): unknown {
          return {
            gain: {
              setValueAtTime: () => undefined,
              exponentialRampToValueAtTime: () => undefined,
            },
            connect: () => undefined,
          };
        }
      }
      (window as unknown as { AudioContext: unknown }).AudioContext = RecordingContext;

      await user.click(screen.getByRole('button', { name: /turn the sound on/i }));

      // `confirm` is two pulses; `over-scan` is one. Counting them is how this
      // test tells which pattern was played without reaching into the module.
      expect(played).toHaveLength(SCAN_SOUND_PATTERNS.confirm.filter((t) => t.hz > 0).length);
      expect(played.length).not.toBe(
        SCAN_SOUND_PATTERNS['over-scan'].filter((t) => t.hz > 0).length
      );

      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    });

    it('should announce a refusal exactly ONCE', async () => {
      // `Alert tone="error"` already renders `role="alert"`, an assertive live
      // region. Putting refusals in the polite announcer too would say each one
      // twice to a screen-reader packer, so the announcer carries acceptance and
      // in-flight only — asserted here rather than only claimed in a docblock.
      mount(parcel({ lines: [line({ verifiedQuantity: 2 })] }));
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');
      await screen.findByText(/The count stayed at 2/i);

      const announcer = screen.getByTestId('bench-parcel-announcer');
      expect(announcer).toHaveAttribute('aria-live', 'polite');
      expect(announcer.textContent ?? '').not.toMatch(/count stayed|turned down|does not belong/i);
    });

    it('should carry the in-flight state in text, not in colour or motion alone', async () => {
      const pending = deferred<BenchVerificationResult>();
      mount(parcel(), { verifyUnit: vi.fn().mockReturnValue(pending.promise) });
      await screen.findByTestId('bench-parcel');

      scan('5901234123457');

      // Read from `textContent` alone: strip every stylesheet and the state is
      // still legible, which is what "signalled by more than colour" means.
      const row = await screen.findByTestId('bench-parcel-line');
      expect(row.textContent).toMatch(/sent — waiting for the system/i);
    });
  });
});
