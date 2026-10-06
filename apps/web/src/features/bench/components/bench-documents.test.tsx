/**
 * The paper that travels with the box (#2418, `W3b-5`, stories F1–F4)
 *
 * The load-bearing assertions here are the two absences: a missing invoice must
 * not block anything, and a label this bench cannot do anything about must not
 * offer a control that cannot succeed.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { OpenLinkerPlugin } from '../../../shared/plugins';
import { parseBenchReceiptLink } from '../api/bench-parcel.schema';
import type {
  BenchDocuments,
  BenchInvoice,
  BenchLabel,
  BenchSalesDocument,
} from '../api/bench-parcel.types';
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
    parcelTemplates: [],
    ...over,
  };
}

interface MountOptions {
  readonly unlabelledTotal?: number;
  readonly packStationLabel?: string | null;
  /** Open is the ordinary state while a packer works a box. */
  readonly closed?: boolean;
  readonly plugins?: readonly OpenLinkerPlugin[];
  readonly getReceiptLink?: (workId: string) => Promise<{ url: string }>;
}

/** F3/F4 is a closed-box state; every unlabelled-block test mounts one. */
const CLOSED: MountOptions = { closed: true };

function mount(
  documents: Partial<BenchDocuments> = {},
  {
    unlabelledTotal = 0,
    packStationLabel = null,
    closed = false,
    plugins,
    getReceiptLink,
  }: MountOptions = {}
) {
  const apiClient = createMockApiClient({
    bench: {
      getDocuments: vi.fn().mockResolvedValue({
        workId: 'w-1',
        invoice: invoice(),
        label: label(),
        ...documents,
      }),
      getReceiptLink:
        getReceiptLink ??
        vi.fn().mockResolvedValue({ url: 'https://receipts.example.test/r/16240' }),
      downloadReceipt: vi.fn().mockResolvedValue(new Blob(['%PDF'])),
      listUnlabelledParcels: vi
        .fn()
        .mockResolvedValue({ parcels: [], total: unlabelledTotal, truncated: false }),
      downloadInvoice: vi.fn().mockResolvedValue(new Blob(['%PDF'])),
      // #3340 — the label print goes through the work, not the shipment id.
      downloadLabel: vi.fn().mockResolvedValue(new Blob(['%PDF'])),
    },
  });

  return {
    apiClient,
    ...renderWithProviders(<BenchDocumentsPanel workId="w-1" unitsPacked={6} closed={closed} />, {
      apiClient,
      ...(plugins === undefined ? {} : { plugins }),
      sessionAdapter: createAuthenticatedSessionAdapter({
        ...PACKER,
        permissions: [],
        packStationLabel,
      }),
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

  // ── Who else knows (#3340 follow-up) ────────────────────────────────────
  //
  // The panel used to claim, for EVERY reason and for none, that the order was
  // "already on their list … you do not need to tell anyone". That is true of
  // exactly one of these three cases. The other two are the reassuring
  // direction of wrong: a packer told somebody knows does not mention it.
  describe('whether anyone else knows the invoice is missing', () => {
    const missingWith = (blockReason: string | null) =>
      invoice({
        state: 'missing',
        invoiceId: null,
        documentNumber: null,
        issuedAt: null,
        blockReason,
        unresolvedReason: null,
      });

    it('should say the office can see it when the reason really is counted', async () => {
      mount({ invoice: missingWith('missing-tax-rate') });

      expect(await screen.findByText(/The office can see this one/i)).toBeInTheDocument();
      expect(screen.getByText(/you do not need to write it down/i)).toBeInTheDocument();
    });

    it('should say nobody is told when the shop only invoices on request', async () => {
      mount({ invoice: missingWith('trigger-model-manual') });

      // `trigger-model-manual` is excluded from SalesDocumentAttentionReasonValues,
      // so it enters no count and matches no filter — nothing has been flagged.
      expect(await screen.findByText(/Nobody is told automatically/i)).toBeInTheDocument();
      expect(screen.getByText(/tell the office/i)).toBeInTheDocument();
      expect(screen.queryByText(/The office can see this one/i)).toBeNull();
    });

    it('should not claim anyone was told when nothing recorded a reason', async () => {
      mount({ invoice: missingWith(null) });

      expect(await screen.findByText(/Nobody has been told/i)).toBeInTheDocument();
      expect(screen.getByText(/not on any list OpenLinker keeps/i)).toBeInTheDocument();
    });

    it('should not claim anyone was told for a reason this build cannot place', async () => {
      // A reason added to the backend union and not yet mirrored here cannot be
      // matched by the filter's own `IN (…)` either, so it is not on a list.
      mount({ invoice: missingWith('some-future-reason') });

      expect(await screen.findByText(/Nobody has been told/i)).toBeInTheDocument();
    });
  });

  it('should say there is nothing to print when the document is not printable', async () => {
    mount({ invoice: invoice({ state: 'issued-not-printable' }) });

    // A neutral fact, not a warning: the invoice exists, it just cannot be
    // printed here - so the card names it and its number.
    expect(await screen.findByText('Issued, not printable')).toBeInTheDocument();
    expect(screen.getByText('Invoice FV/2026/09/0412')).toBeInTheDocument();
    expect(screen.getByText('Issued, but it cannot be printed here.')).toBeInTheDocument();
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
      { unlabelledTotal: 3, closed: true }
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
    }, CLOSED);

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
    }, CLOSED);

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
    }, CLOSED);

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
    }, CLOSED);

    expect(await screen.findByText(/Packed, but there is no label/i)).toBeInTheDocument();
    // A control that cannot succeed is worse than none — buying a label needs
    // the address and the box measurements, which are not on this screen.
    expect(screen.queryByRole('button', { name: /try the label again/i })).toBeNull();
    expect(screen.getByText(/dispatch does it/i)).toBeInTheDocument();
  });

  it('should still offer the invoice for inside the box while the label is outstanding', async () => {
    mount({
      label: label({ state: 'unavailable', trackingNumber: null }),
    }, CLOSED);

    expect(await screen.findByRole('button', { name: /print invoice/i })).toBeInTheDocument();
    expect(screen.getByText(/it is not missing later/i)).toBeInTheDocument();
  });

  // ── G03-6 — an OPEN box with no label yet is not "packed" ────────────────
  //
  // The unlabelled block says the box "is finished and correct … and it is
  // closed". G03-6 found it on a parcel at "0 of 1": the panel keyed on the
  // label state alone. The open arm must say the label is not ready and let
  // packing carry on — and must not ask dispatch's list while it is open.
  describe('a box that is still open while no label exists', () => {
    const unavailable = label({ state: 'unavailable', trackingNumber: null, shipmentId: null });

    it('should not render the unlabelled block when the box is open', async () => {
      const { apiClient } = mount({ label: unavailable });

      await screen.findByTestId('bench-documents-label-pending');
      expect(screen.queryByTestId('bench-documents-unlabelled')).not.toBeInTheDocument();
      expect(screen.queryByText(/This box cannot go out/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/it is closed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/it is not missing later/i)).not.toBeInTheDocument();
      expect(apiClient.bench.listUnlabelledParcels).not.toHaveBeenCalled();
    });

    it('should show a neutral label card that lets packing carry on when the box is open', async () => {
      mount({ label: unavailable });

      const card = await screen.findByTestId('bench-documents-label-pending');
      expect(card).toHaveTextContent('Goes ON the box');
      expect(card).toHaveTextContent('The label is not ready yet');
      expect(card).toHaveTextContent(/Carry on packing/);
      // Nothing to press: the label is dispatch's to buy, not this bench's.
      expect(within(card).queryByRole('button')).toBeNull();
      // The invoice card is unaffected.
      expect(screen.getByRole('button', { name: /print invoice/i })).toBeInTheDocument();
    });

    it('should render the unlabelled block, not the pending card, once the box is closed', async () => {
      mount({ label: unavailable }, CLOSED);

      expect(await screen.findByTestId('bench-documents-unlabelled')).toBeInTheDocument();
      expect(screen.queryByTestId('bench-documents-label-pending')).not.toBeInTheDocument();
    });

    it('should render no pending card when the label is ready', async () => {
      mount();

      await screen.findByTestId('bench-documents-label');
      expect(screen.queryByTestId('bench-documents-label-pending')).not.toBeInTheDocument();
    });
  });

  // #3420 was reverted: a control that does nothing is not rescued by a
  // disclaimer beside it. This asserts it stays gone — the panel's own rule
  // ("a control wired to nothing is worse than a missing one") has no
  // exception, and the button is the kind of thing a mockup pass re-adds.
  it('renders no camera control at all', async () => {
    mount();

    await screen.findByRole('button', { name: 'Print invoice' });
    expect(screen.queryByRole('button', { name: /camera/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/camera/i)).not.toBeInTheDocument();
  });

  // #3404 — the packer/printer binding made visible.
  describe('the printer-binding line', () => {
    it("should render the signed-in packer's own station label", async () => {
      mount({}, { packStationLabel: 'Zebra ZD420 · Bench 3' });

      const line = await screen.findByTestId('bench-documents-printer');
      expect(line).toHaveTextContent('Printing to Zebra ZD420 · Bench 3');
      // And NOT the mockup's trailing "this station's printer, always": the
      // label is stored on the USER, so it follows the packer to whichever
      // bench they sign in at. Asserted rather than merely omitted, because a
      // reassurance that is wrong about where the paper comes out is worse
      // than none, and this clause is exactly what a later parity pass
      // re-adds. See `benchParcelCopy.documents.printingTo`.
      expect(line).not.toHaveTextContent(/station/i);
      expect(line).not.toHaveTextContent(/always/i);
    });

    it('should render nothing when the packer has no station label set', async () => {
      mount({}, { packStationLabel: null });

      await screen.findByRole('button', { name: 'Print invoice' });
      expect(screen.queryByTestId('bench-documents-printer')).not.toBeInTheDocument();
      expect(screen.queryByText(/printing to/i)).not.toBeInTheDocument();
    });
  });
});

// ── #3647: every sales document, in every status ─────────────────────────────
function receiptDoc(over: Partial<BenchSalesDocument> = {}): BenchSalesDocument {
  return {
    kind: 'fiscal-receipt',
    recordId: 'fis-1',
    connectionId: 'conn-ep',
    platformType: 'eparagony',
    status: 'registered',
    failureMode: null,
    documentNumber: '16240',
    completedAt: '2026-09-30T09:00:00Z',
    printable: false,
    artefacts: [{ medium: 'link', disposition: 'send', label: 'Receipt', contentType: null }],
    ...over,
  };
}

function invoiceDoc(over: Partial<BenchSalesDocument> = {}): BenchSalesDocument {
  return {
    kind: 'invoice',
    recordId: 'inv-1',
    connectionId: 'conn-ksef',
    platformType: null,
    status: 'issued',
    failureMode: null,
    documentNumber: 'FV/2026/09/0412',
    completedAt: null,
    printable: true,
    artefacts: null,
    ...over,
  };
}

/** The shape the API sends since #3646: a `document` slot beside the legacy invoice. */
function withDocument(
  document: BenchSalesDocument | null,
  over: Partial<BenchDocuments> = {},
): Partial<BenchDocuments> {
  return {
    // The legacy slot says "missing" for every non-issued state; the card must
    // ignore it whenever `document` is present.
    invoice: invoice({ state: 'missing', invoiceId: null, blockReason: 'trigger-model-manual' }),
    document,
    documentKind: null,
    blockReason: null,
    unresolvedReason: null,
    ...over,
  };
}

describe('BenchDocumentsPanel - sales documents (#3647)', () => {
  it('should never say no invoice was made for an order with a registered receipt', async () => {
    mount(withDocument(receiptDoc()));

    expect(await screen.findByText('Receipt 16240')).toBeInTheDocument();
    expect(screen.getByText('Receipt made')).toBeInTheDocument();
    expect(screen.getByText('Receipt for this order')).toBeInTheDocument();
    expect(screen.queryByText(/No invoice was made/i)).toBeNull();
    expect(screen.queryByText(/Issued on request/i)).toBeNull();
    expect(screen.queryByText(/tell the office/i)).toBeNull();
  });

  it('should offer a link receipt as a plain new-tab link, and not as ready to print', async () => {
    mount(withDocument(receiptDoc()));

    const link = await screen.findByRole('link', { name: 'Open receipt' });
    expect(link).toHaveAttribute('href', 'https://receipts.example.test/r/16240');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Open with the link below.')).toBeInTheDocument();
    const card = screen.getByTestId('bench-documents-receipt');
    expect(within(card).queryByText('Ready to print')).toBeNull();
    expect(screen.queryByRole('button', { name: /print receipt/i })).toBeNull();
  });

  it('should say nothing about paper, the box, or the buyer receiving the receipt', async () => {
    mount(withDocument(receiptDoc()));

    const card = await screen.findByTestId('bench-documents-receipt');
    expect(card.textContent ?? '').not.toMatch(/paper|inside the box|in the box|sent|delivered|received/i);
  });

  it('should keep Open receipt disabled until the link arrives', async () => {
    mount(withDocument(receiptDoc()), {
      getReceiptLink: vi
        .fn<(workId: string) => Promise<{ url: string }>>()
        .mockReturnValue(new Promise(() => undefined)),
    });

    const button = await screen.findByRole('button', { name: 'Open receipt' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open receipt' })).toBeNull();
  });

  it('should say the link is on its way while it is fetched, never that there is nothing to open', async () => {
    mount(withDocument(receiptDoc()), {
      getReceiptLink: vi
        .fn<(workId: string) => Promise<{ url: string }>>()
        .mockReturnValue(new Promise(() => undefined)),
    });

    const pending = await screen.findByText('Getting the link. One moment.');
    expect(pending).toHaveAttribute('role', 'status');
    expect(screen.queryByText('There is no link to this receipt in OpenLinker.')).toBeNull();
    expect(screen.queryByText(/The link did not load/)).toBeNull();
  });

  it('should show the pending state, not the old failure, while a retry is in flight', async () => {
    const getReceiptLink = vi
      .fn<(workId: string) => Promise<{ url: string }>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValue(new Promise(() => undefined));
    mount(withDocument(receiptDoc()), { getReceiptLink });

    expect(await screen.findByText(/The link did not load/)).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    expect(await screen.findByText('Getting the link. One moment.')).toBeInTheDocument();
    expect(screen.queryByText(/The link did not load/)).toBeNull();
  });

  it.each(['javascript:alert(document.domain)', 'data:text/html,<script>alert(1)</script>'])(
    'should never render a %s receipt link as an href, and report the link as failed',
    async (url) => {
      mount(withDocument(receiptDoc()), {
        // Through the real boundary parser, which is where a hostile scheme is refused.
        getReceiptLink: () => Promise.resolve().then(() => parseBenchReceiptLink({ url })),
      });

      expect(await screen.findByText(/The link did not load/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open receipt' })).toBeNull();
    }
  );

  it('should offer a retry when the link fails to load', async () => {
    const getReceiptLink = vi
      .fn<(workId: string) => Promise<{ url: string }>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ url: 'https://receipts.example.test/r/16240' });
    mount(withDocument(receiptDoc()), { getReceiptLink });

    expect(await screen.findByText(/The link did not load/)).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    expect(await screen.findByRole('link', { name: 'Open receipt' })).toBeInTheDocument();
  });

  it('should print a receipt that came as a file', async () => {
    const { apiClient } = mount(
      withDocument(
        receiptDoc({
          artefacts: [
            { medium: 'document', disposition: 'print', label: 'Receipt', contentType: 'application/pdf' },
          ],
        })
      )
    );

    const button = await screen.findByRole('button', { name: 'Print receipt' });
    act(() => {
      button.click();
    });
    await waitFor(() => {
      expect(apiClient.bench.downloadReceipt).toHaveBeenCalledWith('w-1');
    });
  });

  it('should show a registered receipt with nothing attached as made, with no action', async () => {
    mount(withDocument(receiptDoc({ artefacts: [] })));

    expect(await screen.findByText('There is no link to this receipt in OpenLinker.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open receipt' })).toBeNull();
  });

  it('should show a receipt that is still being registered as on its way', async () => {
    mount(withDocument(receiptDoc({ status: 'registering', artefacts: null, documentNumber: null })));

    expect(await screen.findByText('Receipt on its way')).toBeInTheDocument();
    expect(screen.getByText('Being registered')).toBeInTheDocument();
    expect(screen.getByText('It does not stop the box going out.')).toBeInTheDocument();
  });

  it('should tell a rejected receipt apart from an unconfirmed one', async () => {
    mount(withDocument(receiptDoc({ status: 'failed', failureMode: 'rejected', artefacts: null })));
    expect(await screen.findByText('The receipt did not go through')).toBeInTheDocument();
    expect(screen.getByText(/Mention it to the office/)).toBeInTheDocument();
  });

  it('should not claim an in-doubt receipt did not go through', async () => {
    mount(withDocument(receiptDoc({ status: 'failed', failureMode: 'in-doubt', artefacts: null })));

    expect(await screen.findByText('Receipt not confirmed')).toBeInTheDocument();
    expect(screen.getByText(/OpenLinker does not know if this receipt was made/)).toBeInTheDocument();
    expect(screen.queryByText(/did not go through/)).toBeNull();
  });

  it.each([
    [{ status: 'issuing' }, 'Invoice on its way'],
    [{ status: 'failed', failureMode: 'rejected' }, 'The invoice did not go through'],
    [{ status: 'failed', failureMode: 'in-doubt' }, 'Invoice not confirmed'],
  ] as const)('should show an invoice %o as %s, never as missing', async (over, title) => {
    mount(withDocument(invoiceDoc({ ...over, printable: false })));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText(/No invoice was made/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /print invoice/i })).toBeNull();
  });

  it('should render an issued printable invoice exactly as before', async () => {
    mount(withDocument(invoiceDoc()));

    expect(await screen.findByText('Invoice FV/2026/09/0412')).toBeInTheDocument();
    expect(screen.getByText('Goes INSIDE the box')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print invoice/i })).toBeInTheDocument();
  });

  it('should report the block reason only when there is no document of any kind', async () => {
    mount(withDocument(null, { blockReason: 'trigger-model-manual' }));

    expect(await screen.findByText(/No invoice was made for this order/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody is told automatically/i)).toBeInTheDocument();
  });

  it('should render a neutral card for a document kind this build does not know', async () => {
    mount(withDocument(receiptDoc({ kind: 'credit-memo' })));

    expect(await screen.findByText('This screen cannot show this document')).toBeInTheDocument();
    expect(screen.queryByText(/No invoice was made/i)).toBeNull();
  });

  describe('the per-integration slot', () => {
    const slotPlugin = (platformType: string): OpenLinkerPlugin => ({
      id: `test-${platformType}`,
      platformType,
      platform: {
        displayName: platformType,
        benchReceiptSection: ({ documentReference, defaultBody }) => (
          <div data-testid="plugin-receipt-body">
            Plugin body for {documentReference}
            {defaultBody}
          </div>
        ),
      },
    });

    it('should let a registered plugin replace the body while the host keeps the frame', async () => {
      mount(withDocument(receiptDoc()), { plugins: [slotPlugin('eparagony')] });

      expect(await screen.findByTestId('plugin-receipt-body')).toHaveTextContent('Plugin body for 16240');
      // Badge, top line and title are the host's, never the plugin's.
      expect(screen.getByText('Receipt made')).toBeInTheDocument();
      expect(screen.getByText('Receipt for this order')).toBeInTheDocument();
      expect(screen.getByText('Receipt 16240')).toBeInTheDocument();
    });

    it('should use the host default when the receipt belongs to a different integration', async () => {
      mount(withDocument(receiptDoc()), { plugins: [slotPlugin('another-provider')] });

      expect(await screen.findByText('Open with the link below.')).toBeInTheDocument();
      expect(screen.queryByTestId('plugin-receipt-body')).toBeNull();
    });
  });

  describe('refreshing on its own', () => {
    it('should ask again while the receipt is being registered, and stop once it is made', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const getDocuments = vi
          .fn()
          .mockResolvedValueOnce({
            workId: 'w-1',
            label: label(),
            ...withDocument(receiptDoc({ status: 'registering', artefacts: null })),
          })
          .mockResolvedValue({ workId: 'w-1', label: label(), ...withDocument(receiptDoc()) });
        const apiClient = createMockApiClient({
          bench: {
            getDocuments,
            listUnlabelledParcels: vi.fn().mockResolvedValue({ parcels: [], total: 0, truncated: false }),
            getReceiptLink: vi.fn().mockResolvedValue({ url: 'https://receipts.example.test/r/16240' }),
          },
        });
        renderWithProviders(<BenchDocumentsPanel workId="w-1" unitsPacked={1} closed={false} />, {
          apiClient,
          sessionAdapter: createAuthenticatedSessionAdapter({
            ...PACKER,
            permissions: [],
            packStationLabel: null,
          }),
        });

        expect(await screen.findByText('Receipt on its way')).toBeInTheDocument();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
        expect(await screen.findByText('Receipt 16240')).toBeInTheDocument();

        const callsWhenMade = getDocuments.mock.calls.length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(getDocuments.mock.calls.length).toBe(callsWhenMade);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

