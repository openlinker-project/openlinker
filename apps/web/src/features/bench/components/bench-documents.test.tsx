/**
 * The paper that travels with the box (#2418, `W3b-5`, stories F1–F4)
 *
 * The load-bearing assertions here are the two absences: a missing invoice must
 * not block anything, and a label this bench cannot do anything about must not
 * offer a control that cannot succeed.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { BenchDocuments, BenchInvoice, BenchLabel } from '../api/bench-parcel.types';
import { BenchDocumentsPanel } from './bench-documents';

const PACKER = {
  id: 'user_packer',
  username: 'Marta Kowalczyk',
  email: null,
  role: 'packer',
  permissions: [],
  analyticsConsent: true,
} as const;

function invoice(over: Partial<BenchInvoice> = {}): BenchInvoice {
  return {
    state: 'ready',
    invoiceId: 'inv-1',
    documentNumber: 'FV/2026/09/0412',
    issuedAt: '2026-09-01T09:14:00Z',
    blockReason: null,
    unresolvedReason: null,
    ...over,
  };
}

function label(over: Partial<BenchLabel> = {}): BenchLabel {
  return {
    state: 'ready',
    shipmentId: 'ol_shipment_1',
    carrier: 'InPost',
    trackingNumber: '620012345678',
    providerCode: null,
    carrierMessage: null,
    failedAt: null,
    carrierMessageRedacted: false,
    ...over,
  };
}

function mount(documents: Partial<BenchDocuments> = {}, unlabelledTotal = 0) {
  const apiClient = createMockApiClient({
    bench: {
      getDocuments: vi.fn().mockResolvedValue({
        workId: 'w-1',
        invoice: invoice(),
        label: label(),
        ...documents,
      }),
      listUnlabelledParcels: vi
        .fn()
        .mockResolvedValue({ parcels: [], total: unlabelledTotal, truncated: false }),
      downloadInvoice: vi.fn().mockResolvedValue(new Blob(['%PDF'])),
    },
    shipments: {
      downloadLabel: vi.fn().mockResolvedValue(new Blob(['%PDF'])),
    },
  });

  return {
    apiClient,
    ...renderWithProviders(<BenchDocumentsPanel workId="w-1" unitsPacked={6} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({ ...PACKER, permissions: [] }),
    }),
  };
}

describe('BenchDocumentsPanel (#2418)', () => {
  // ── F1 ──────────────────────────────────────────────────────────────────
  it('should say both papers were made elsewhere, and offer only to print them', async () => {
    mount();

    expect(await screen.findByText(/Both papers are waiting to print/i)).toBeInTheDocument();
    expect(screen.getByText(/Printing them here does not create anything/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print invoice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print label/i })).toBeInTheDocument();
    // The bench never issues, so no control here may offer to make one.
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/issue|create|generate/i);
    }
  });

  it('should distinguish what goes inside the box from what goes on it', async () => {
    mount();
    expect(await screen.findByText('Goes INSIDE the box')).toBeInTheDocument();
    expect(screen.getByText('Goes ON the box')).toBeInTheDocument();
  });

  // ── F2 — named, never silently skipped, and it blocks nothing ────────────
  it('should name a missing invoice in the existing block vocabulary and block nothing', async () => {
    mount({
      invoice: invoice({
        state: 'missing',
        invoiceId: null,
        documentNumber: null,
        issuedAt: null,
        blockReason: 'missing-tax-rate',
        unresolvedReason: null,
      }),
    });

    expect(await screen.findByText(/Carry on packing — one paper is not coming/i)).toBeInTheDocument();
    expect(screen.getByText(/does not stop the box going out/i)).toBeInTheDocument();
    // The reason comes from the guarded sales-document map, not a second copy.
    expect(screen.getByText(/Tax rate missing/)).toBeInTheDocument();
    // The label still prints — nothing is gated on the missing document.
    expect(screen.getByRole('button', { name: /print label/i })).toBeInTheDocument();
    // And nothing offers to make the invoice here.
    expect(screen.queryByRole('button', { name: /print invoice/i })).toBeNull();
  });

  it('should say plainly when nothing recorded a reason, rather than leaving a gap', async () => {
    mount({
      invoice: invoice({
        state: 'missing',
        invoiceId: null,
        documentNumber: null,
        issuedAt: null,
        blockReason: null,
        unresolvedReason: null,
      }),
    });

    expect(await screen.findByText(/Nothing on this order says why/i)).toBeInTheDocument();
  });

  it('should say there is nothing to print when the document is not printable', async () => {
    mount({ invoice: invoice({ state: 'issued-not-printable' }) });

    expect(await screen.findByText(/There is nothing to print for this one/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /print invoice/i })).toBeNull();
  });

  // ── F3/F4 ───────────────────────────────────────────────────────────────
  it('should hold the packed-but-unlabelled state and tell the packer not to reopen it', async () => {
    mount(
      {
        label: label({
          state: 'unavailable',
          trackingNumber: null,
          providerCode: 'LOCKER_FULL',
        }),
      },
      3
    );

    expect(await screen.findByText(/Packed, but there is no label/i)).toBeInTheDocument();
    expect(screen.getByText(/Do not open it and do not check it again/i)).toBeInTheDocument();
    // NO retry control, ever, on this arm — a label that exists is reported
    // `ready` and its Print control re-fetches; this arm is reached only when
    // none was produced, which the bench cannot fix.
    expect(screen.queryByRole('button', { name: /try the label again/i })).toBeNull();
    // The counts line, from the one read dispatch also uses.
    expect(await screen.findByText('1 box waiting here · 2 in dispatch')).toBeInTheDocument();
  });

  it('should render the carrier code when the carrier prose is withheld from a packer', async () => {
    mount({
      label: label({
        state: 'unavailable',
        trackingNumber: null,
        providerCode: 'LOCKER_FULL',
        // `null` for anyone without `shipments:write` — the raw text may embed
        // address fragments. An empty quotation would read as the carrier having
        // said nothing.
        carrierMessage: null,
        carrierMessageRedacted: true,
      }),
    });

    expect(await screen.findByText(/turned it down with code LOCKER_FULL/i)).toBeInTheDocument();
    expect(screen.queryByText('“”')).toBeNull();
  });

  it('should say the carrier gave no reason rather than render an empty quotation', async () => {
    mount({
      label: label({
        state: 'unavailable',
        trackingNumber: null,
        providerCode: null,
        carrierMessage: null,
        carrierMessageRedacted: false,
      }),
    });

    expect(await screen.findByText(/The carrier did not say why/i)).toBeInTheDocument();
  });

  it('should not claim the carrier was silent when the reason is merely hidden', async () => {
    // A packer never sees the carrier's own words. Saying "the carrier did not
    // say why" when it did is this screen stating something false, so the two
    // facts get two sentences.
    mount({
      label: label({
        state: 'unavailable',
        trackingNumber: null,
        providerCode: null,
        carrierMessage: null,
        carrierMessageRedacted: true,
      }),
    });

    expect(await screen.findByText(/not shown at the bench/i)).toBeInTheDocument();
    expect(screen.queryByText(/The carrier did not say why/i)).toBeNull();
  });

  it('should offer no retry at all and say who owns buying a label', async () => {
    mount({
      label: label({
        state: 'unavailable',
        trackingNumber: null,
        providerCode: 'NO_LABEL',
      }),
    });

    expect(await screen.findByText(/Packed, but there is no label/i)).toBeInTheDocument();
    // A control that cannot succeed is worse than none — buying a label needs
    // the address and the box measurements, which are not on this screen.
    expect(screen.queryByRole('button', { name: /try the label again/i })).toBeNull();
    expect(screen.getByText(/dispatch does it/i)).toBeInTheDocument();
  });

  it('should still offer the invoice for inside the box while the label is outstanding', async () => {
    mount({
      label: label({ state: 'unavailable', trackingNumber: null }),
    });

    expect(await screen.findByRole('button', { name: /print invoice/i })).toBeInTheDocument();
    expect(screen.getByText(/it is not missing later/i)).toBeInTheDocument();
  });
});
