/**
 * `BenchBuyerNote` unit tests (#3539, D12, mockup M2 `bench` / `bench-ack` / `multi`).
 *
 * The card is read only and never gates a scan: the tests pin what saving does
 * (asks the server for THIS parcel, collapses once the server holds it), what a
 * failure says, and that a split order shows the note on each parcel with the
 * other packer's reading as context only.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type {
  BenchBuyerNoteAcknowledgementResult,
  BenchParcel,
} from '../api/bench-parcel.types';
import { BenchBuyerNote } from './bench-buyer-note';

const NOTE = 'Proszę o kubki w kolorze czerwonym. Nie wkładać paragonu do paczki.';
const LONG = `${'Dzień dobry, mam kilka próśb dotyczących tej paczki.\n'.repeat(6)}Anna`;

function parcel(over: Partial<BenchParcel> = {}): BenchParcel {
  return {
    workId: 'w-1',
    version: 1,
    orderReference: 'OL-1',
    buyerName: null,
    totalAmount: null,
    currency: null,
    carrierName: null,
    dispatchByAt: null,
    parcelIndex: 1,
    parcelTotal: 1,
    refusal: null,
    holdReason: null,
    closedAt: null,
    packedByUserId: null,
    assignedToUserId: null,
    invoicePrintedAt: null,
    labelPrintedAt: null,
    completedAt: null,
    lines: [],
    packerNotes: [],
    buyerNote: NOTE,
    buyerNoteAcknowledgedAt: null,
    buyerNoteAcknowledgedByUserId: null,
    otherParcelBuyerNoteAcknowledgements: [],
    ...over,
  };
}

function renderNote(
  p: BenchParcel,
  acknowledge = vi.fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>(),
  canAcknowledge = true,
  textNotStored = false,
) {
  const api = createMockApiClient({ bench: { acknowledgeBuyerNote: acknowledge } });
  const utils = renderWithProviders(<BenchBuyerNote parcel={p} canAcknowledge={canAcknowledge} textNotStored={textNotStored} />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter({
      id: 'user_packer',
      username: 'packer',
      email: null,
      role: 'packer',
      permissions: ['bench:write'],
      analyticsConsent: true,
    }),
  });
  return { acknowledge, ...utils };
}


/**
 * jsdom does no layout, so `scrollHeight` / `clientHeight` are always 0. This
 * stands in for a browser whose clamp IS cutting the text off: the hook under
 * test measures, so the measurement is what gets mocked.
 */
function mockClampOverflow(testId: string): () => void {
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('data-testid') === testId ? 200 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('data-testid') === testId ? 80 : 0;
    },
  });
  return () => {
    if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scroll);
    if (client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', client);
  };
}

afterEach(cleanup);

describe('BenchBuyerNote (#3539)', () => {
  it('should show the note with an "I have read the note" action when it is not yet acknowledged', () => {
    renderNote(parcel());

    expect(screen.getByTestId('bench-buyer-note')).toHaveAttribute('data-state', 'unread');
    expect(screen.getByTestId('bench-buyer-note-text')).toHaveTextContent(NOTE);
    expect(screen.getByRole('button', { name: 'I have read the note' })).toBeEnabled();
    expect(screen.getByText(/Scanning works either way/)).toBeInTheDocument();
  });

  it('should render nothing when the parcel carries no note text', () => {
    renderNote(parcel({ buyerNote: null }));

    expect(screen.queryByTestId('bench-buyer-note')).not.toBeInTheDocument();
  });

  it('should ask the server to acknowledge THIS parcel when the packer presses the button', async () => {
    const acknowledge = vi
      .fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>()
      .mockResolvedValue({ outcome: 'acknowledged', reason: null, parcel: parcel() });
    renderNote(parcel(), acknowledge);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'I have read the note' }));

    await waitFor(() => {
      expect(acknowledge).toHaveBeenCalledWith('w-1');
    });
  });

  it('should show Saving... while the write is in flight', async () => {
    let resolve: (value: BenchBuyerNoteAcknowledgementResult) => void = () => undefined;
    const acknowledge = vi
      .fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>()
      .mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    renderNote(parcel(), acknowledge);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'I have read the note' }));

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolve({ outcome: 'acknowledged', reason: null, parcel: parcel() });
  });

  it('should collapse to "Read by you at HH:MM" with a way to show the whole note once acknowledged', async () => {
    const restore = mockClampOverflow('bench-buyer-note-text');
    const at = new Date(2026, 8, 25, 14, 31).toISOString();
    renderNote(
      parcel({ buyerNoteAcknowledgedAt: at, buyerNoteAcknowledgedByUserId: 'user_packer', buyerNote: LONG }),
    );
    const user = userEvent.setup();

    expect(screen.getByTestId('bench-buyer-note')).toHaveAttribute('data-state', 'read');
    expect(screen.getByTestId('bench-buyer-note-read-badge')).toHaveTextContent(/Read by you at/);
    expect(screen.queryByRole('button', { name: 'I have read the note' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the whole note' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    restore();
  });

  it('should keep the note open and say so when the save fails', async () => {
    const acknowledge = vi
      .fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>()
      .mockRejectedValue(new Error('network'));
    renderNote(parcel(), acknowledge);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'I have read the note' }));

    expect(await screen.findByTestId('bench-buyer-note-error')).toHaveTextContent(
      'That did not save. The note stays open - press it again.',
    );
    expect(screen.getByTestId('bench-buyer-note')).toHaveAttribute('data-state', 'unread');
    expect(screen.getByRole('button', { name: 'I have read the note' })).toBeEnabled();
  });

  it('should say the box is assigned elsewhere when the server refuses the reading', async () => {
    const acknowledge = vi
      .fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>()
      .mockResolvedValue({ outcome: 'refused', reason: 'not-claimable-by-viewer', parcel: parcel() });
    renderNote(parcel(), acknowledge);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'I have read the note' }));

    expect(await screen.findByTestId('bench-buyer-note-error')).toHaveTextContent(
      /assigned to another packer/,
    );
  });

  it('should offer no acknowledge action to a session that cannot write at the bench', () => {
    renderNote(parcel(), undefined, false);

    expect(screen.getByTestId('bench-buyer-note-text')).toBeInTheDocument();
    expect(screen.queryByTestId('bench-buyer-note-acknowledge')).not.toBeInTheDocument();
  });

  it('should offer to show the whole note on an open box only when the clamp cuts text off', async () => {
    const restore = mockClampOverflow('bench-buyer-note-text');
    try {
      renderNote(parcel({ buyerNote: LONG }));
      const user = userEvent.setup();

      await user.click(await screen.findByTestId('bench-buyer-note-expand'));

      expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('should offer no expand control on an open box when everything fits', () => {
    renderNote(parcel({ buyerNote: LONG }));

    expect(screen.queryByTestId('bench-buyer-note-expand')).not.toBeInTheDocument();
  });

  it('should show the note on a split parcel as about the whole order, with the other packer as context only', () => {
    renderNote(
      parcel({
        parcelIndex: 2,
        parcelTotal: 2,
        buyerNote: LONG,
        otherParcelBuyerNoteAcknowledgements: [
          {
            workId: 'w-0',
            parcelIndex: 1,
            acknowledgedAt: new Date(2026, 8, 25, 14, 31).toISOString(),
            acknowledgedByUserId: 'user_kasia',
          },
        ],
      }),
    );

    expect(screen.getByText(/It is about the whole order/)).toBeInTheDocument();
    expect(screen.getByTestId('bench-buyer-note-others')).toHaveTextContent(
      /Another packer read it on parcel 1 of 2 at .*Each box records its own reading\./,
    );
    // The other packer's reading does NOT satisfy this box.
    expect(screen.getByTestId('bench-buyer-note')).toHaveAttribute('data-state', 'unread');
    expect(screen.getByRole('button', { name: 'I have read the note' })).toBeEnabled();
  });

  it('should say the text is not stored and still offer the acknowledgement (B-12)', async () => {
    const acknowledge = vi
      .fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>()
      .mockResolvedValue({ outcome: 'acknowledged', reason: null, parcel: parcel() });
    renderNote(parcel({ buyerNote: null }), acknowledge, true, true);
    const user = userEvent.setup();

    expect(screen.getByTestId('bench-buyer-note-text-not-stored')).toHaveTextContent(
      'does not store its text',
    );
    await user.click(screen.getByRole('button', { name: 'I have read the note' }));
    await waitFor(() => {
      expect(acknowledge).toHaveBeenCalledWith('w-1');
    });
  });

  it('should not offer "Show the whole note" on the read view when nothing is clamped (B-14)', () => {
    renderNote(
      parcel({
        buyerNoteAcknowledgedAt: new Date(2026, 8, 25, 14, 31).toISOString(),
        buyerNoteAcknowledgedByUserId: 'user_packer',
      }),
    );

    expect(screen.queryByTestId('bench-buyer-note-expand')).not.toBeInTheDocument();
  });

  it('should say the box was cancelled when the server refuses with work-cancelled (B-12)', async () => {
    const acknowledge = vi
      .fn<(workId: string) => Promise<BenchBuyerNoteAcknowledgementResult>>()
      .mockResolvedValue({ outcome: 'refused', reason: 'work-cancelled', parcel: parcel() });
    renderNote(parcel(), acknowledge);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'I have read the note' }));

    expect(await screen.findByTestId('bench-buyer-note-error')).toHaveTextContent(/cancelled/);
  });
});
