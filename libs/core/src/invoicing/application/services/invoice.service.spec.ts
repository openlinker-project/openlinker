/**
 * InvoiceService — unit tests (#1224 W1+W2)
 *
 * Mocks `InvoiceRecordRepositoryPort`, `IIntegrationsService`, and an
 * `InvoicingPort` adapter. `getCapabilityAdapter` resolves the adapter mock.
 * Covers the five issueInvoice behaviors (idempotency read-gate, persist-pending,
 * per-connection adapter resolution, issued/failed updateOutcome, Duplicate
 * create-race re-read) plus documentType pass-through, sanitization, and the
 * accepted-risk paths (R1 keyless, R2/R3 failed-row retry).
 * W2: content snapshot tests — issued-document content captured at issue time.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { InvoiceNumberingSeriesRepositoryPort } from '../../domain/ports/invoice-numbering-series-repository.port';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { DuplicateInvoiceRecordException } from '../../domain/exceptions/duplicate-invoice-record.exception';
import { MissingNumberingSeriesException } from '../../domain/exceptions/missing-numbering-series.exception';
import type {
  InvoiceLine,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  IssuedDocumentContent,
  IssuedDocumentSeller,
  OriginalDocumentSnapshot,
} from '../../domain/types/invoicing.types';
import type { CorrectionIssuer } from '../../domain/ports/capabilities/correction-issuer.capability';
import { BuyerProfile } from '../../domain/entities/buyer-profile.entity';
import {
  InvoiceService,
  ISSUING_LEASE_MS,
  MAX_SUPPORTED_PROVIDER_TIMEOUT_MS,
} from './invoice.service';

const CONNECTION = 'conn-1';
const ORDER = 'order-1';
const KEY = 'idem-key-1';

// W2 SELLER constant used in content-snapshot tests.
const SELLER: IssuedDocumentSeller = {
  name: 'Acme Sp. z o.o.',
  taxId: { scheme: 'pl-nip', value: '1234567890' },
  address: { line1: 'ul. Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
};

function makeBuyer(): BuyerProfile {
  return new BuyerProfile(
    'ACME Sp. z o.o.',
    { scheme: 'pl-nip', value: '1234567890' },
    { line1: 'ul. X 1', line2: null, city: 'Poznań', postalCode: '60-001', countryIso2: 'PL' },
    'company',
  );
}

function makeCmd(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: CONNECTION,
    orderId: ORDER,
    buyer: makeBuyer(),
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 12.3, taxRate: '23' }],
    idempotencyKey: KEY,
    ...overrides,
  };
}

// W2 buyer() — private buyer with no tax id, multi-line order used in content-snapshot tests.
function buyer(): BuyerProfile {
  return new BuyerProfile(
    'Jan Kowalski',
    null,
    { line1: 'ul. Kupna 2', line2: null, city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
    'private',
  );
}

// W2 command() — multi-line order used in content-snapshot tests.
function command(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_123',
    buyer: buyer(),
    currency: 'PLN',
    lines: [
      { name: 'Widget', quantity: 2, unitPriceGross: 123, taxRate: '23' },
      { name: 'Gadget', quantity: 1, unitPriceGross: 50, taxRate: '23' },
      { name: 'Book', quantity: 1, unitPriceGross: 105, taxRate: '5' },
    ],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return new InvoiceRecord(
    overrides.id ?? 'rec-1',
    overrides.connectionId ?? CONNECTION,
    overrides.orderId ?? ORDER,
    overrides.providerType ?? 'subiekt',
    overrides.documentType ?? '',
    (overrides.status ?? 'pending'),
    overrides.providerInvoiceId === undefined ? null : overrides.providerInvoiceId,
    overrides.providerInvoiceNumber === undefined ? null : overrides.providerInvoiceNumber,
    overrides.regulatoryStatus ?? 'not-applicable',
    overrides.clearanceReference === undefined ? null : overrides.clearanceReference,
    overrides.idempotencyKey === undefined ? KEY : overrides.idempotencyKey,
    overrides.pdfUrl === undefined ? null : overrides.pdfUrl,
    overrides.issuedAt === undefined ? null : overrides.issuedAt,
    overrides.errorMessage === undefined ? null : overrides.errorMessage,
    overrides.createdAt ?? new Date('2026-06-22T10:00:00.000Z'),
    overrides.updatedAt ?? new Date('2026-06-22T10:00:00.000Z'),
    overrides.failureMode === undefined ? null : overrides.failureMode,
    overrides.failureCode === undefined ? null : overrides.failureCode,
    overrides.failureReason === undefined ? null : overrides.failureReason,
    overrides.leaseExpiresAt === undefined ? null : overrides.leaseExpiresAt,
    overrides.hasBuyerTaxId,
    overrides.documentContent === undefined ? null : overrides.documentContent,
    overrides.sourceDocument === undefined ? null : overrides.sourceDocument,
    overrides.issuedLineSnapshot === undefined ? null : overrides.issuedLineSnapshot,
    overrides.paymentStatus ?? 'unknown',
    overrides.numberingSeriesId === undefined ? null : overrides.numberingSeriesId,
    overrides.documentNumber === undefined ? null : overrides.documentNumber,
  );
}

/** A fully-populated `issued` projection the adapter returns. */
function makeIssuedFromAdapter(): IssueInvoiceResult {
  return {
    record: makeRecord({
      id: 'adapter-rec',
      status: 'issued',
      // Authoritative values the adapter owns: a concrete provider and a derived
      // documentType the keyless caller omitted. The service must backfill both
      // onto the projection (it created the pending row with providerType '' and
      // documentType '').
      providerType: 'subiekt',
      documentType: 'invoice',
      providerInvoiceId: 'PROV-123',
      providerInvoiceNumber: 'FV/2026/1',
      regulatoryStatus: 'cleared',
      clearanceReference: 'KSEF-XYZ',
      pdfUrl: 'https://prov/inv.pdf',
      issuedAt: new Date('2026-06-22T11:00:00.000Z'),
    }),
  };
}

// W2 adapterRecord() — minimal issued record used in content-snapshot tests.
function adapterRecord(): InvoiceRecord {
  const issuedAt = new Date('2026-04-01T12:00:00Z');
  return new InvoiceRecord(
    '',
    'conn-1',
    'ol_order_123',
    'ksef',
    'invoice',
    'issued',
    'SESSION:INVOICE',
    null,
    'submitted',
    null,
    null,
    null,
    issuedAt,
    null,
    issuedAt,
    issuedAt,
  );
}

describe('InvoiceService', () => {
  let repo: jest.Mocked<InvoiceRecordRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let numberingRepo: jest.Mocked<InvoiceNumberingSeriesRepositoryPort>;
  let adapter: jest.Mocked<InvoicingPort>;
  let service: InvoiceService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findBySeriesId: jest.fn(),
      findLatestByOrderId: jest.fn(),
      findByProviderInvoiceId: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      updateOutcome: jest.fn(),
      claimForIssue: jest.fn(),
      findMany: jest.fn(),
      findIssuedNonTerminal: jest.fn(),
    };
    // Default: every claim succeeds (returns a record with the live lease). Tests
    // that exercise a contended/lost claim override this per-case.
    repo.claimForIssue.mockImplementation((id: string) =>
      Promise.resolve(makeRecord({ id, status: 'issuing' })),
    );
    adapter = {
      issueInvoice: jest.fn(),
      getInvoice: jest.fn(),
      upsertCustomer: jest.fn(),
      getSupportedDocumentTypes: jest.fn(),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    numberingRepo = {
      createSeries: jest.fn(),
      findSeriesById: jest.fn(),
      listSeries: jest.fn(),
      listUnassignedSeries: jest.fn(),
      updateSeries: jest.fn(),
      findSeriesIdForDocument: jest.fn(),
      findRoutesByConnectionId: jest.fn(),
      upsertRoute: jest.fn(),
      deleteRoute: jest.fn(),
      allocateNumber: jest.fn(),
    };

    service = new InvoiceService(repo, integrations, numberingRepo);
  });

  describe('issueInvoice', () => {
    it('(a) happy path: ONE pending create, resolves "Invoicing" adapter with original cmd, updateOutcome(issued + six fields)', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      const pending = makeRecord({ id: 'rec-1', status: 'pending' });
      repo.create.mockResolvedValue(pending);
      const adapterResult = makeIssuedFromAdapter();
      adapter.issueInvoice.mockResolvedValue(adapterResult);
      const finalRecord = makeRecord({ id: 'rec-1', status: 'issued' });
      repo.updateOutcome.mockResolvedValue(finalRecord);

      const cmd = makeCmd();
      const result = await service.issueInvoice(cmd);

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: CONNECTION,
          orderId: ORDER,
          status: 'pending',
          idempotencyKey: KEY,
          documentType: '',
          // Buyer carries a tax id -> denormalized presence flag is true (#1202).
          hasBuyerTaxId: true,
        }),
      );
      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(CONNECTION, 'Invoicing');
      // The command is threaded verbatim PLUS the single issuance instant (#1692),
      // which every adapter now receives (a non-consumer provider ignores it).
      expect(adapter.issueInvoice).toHaveBeenCalledWith({ ...cmd, issuedAt: expect.any(Date) });
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-1', expect.objectContaining({
        status: 'issued',
        providerType: 'subiekt',
        documentType: 'invoice',
        providerInvoiceId: 'PROV-123',
        providerInvoiceNumber: 'FV/2026/1',
        regulatoryStatus: 'cleared',
        clearanceReference: 'KSEF-XYZ',
        pdfUrl: 'https://prov/inv.pdf',
        issuedAt: adapterResult.record.issuedAt,
        // A successful issue clears the failure mode/code/reason + releases the
        // lease (#1200 / W1).
        errorMessage: null,
        failureMode: null,
        failureCode: null,
        failureReason: null,
        leaseExpiresAt: null,
        // W3: source document persisted from adapter result (#1224).
        sourceDocument: null,
      }));
      expect(result).toBe(finalRecord);
    });

    it('(a3) #1297: snapshots the issue-command buyer/currency/lines verbatim on the issued patch', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));

      const cmd = makeCmd();
      await service.issueInvoice(cmd);

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          issuedLineSnapshot: { buyer: cmd.buyer, currency: cmd.currency, lines: cmd.lines },
        }),
      );
    });

    it('(a2) backfills authoritative providerType + adapter-derived documentType onto the projection (keyless / no documentType)', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      // Pending row created with providerType '' and documentType '' (caller
      // omitted documentType; SVC does not know the connection's provider).
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending', documentType: '' }));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));

      await service.issueInvoice(makeCmd({ documentType: undefined }));

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ providerType: 'subiekt', documentType: 'invoice' }),
      );
    });

    it('(a3) should set hasBuyerTaxId=false on the pending row when the buyer has no tax id (#1202)', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));

      const noTaxBuyer = new BuyerProfile(
        'Jan Kowalski',
        null,
        { line1: 'ul. Y 2', line2: null, city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
        'private',
      );
      await service.issueInvoice(makeCmd({ buyer: noTaxBuyer }));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ hasBuyerTaxId: false }),
      );
    });

    it('(a4) should set hasBuyerTaxId=false on the pending row when the buyer tax id value is blank (#1202)', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));

      const blankTaxBuyer = new BuyerProfile(
        'ACME Sp. z o.o.',
        { scheme: 'pl-nip', value: '' },
        { line1: 'ul. X 1', line2: null, city: 'Poznań', postalCode: '60-001', countryIso2: 'PL' },
        'company',
      );
      await service.issueInvoice(makeCmd({ buyer: blankTaxBuyer }));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ hasBuyerTaxId: false }),
      );
    });

    it('(b) idempotent replay (issued): returns the issued row as-is, adapter NEVER called, NO second create', async () => {
      const issued = makeRecord({ status: 'issued' });
      repo.findByIdempotencyKey.mockResolvedValue(issued);

      const result = await service.issueInvoice(makeCmd());

      expect(result).toBe(issued);
      expect(repo.create).not.toHaveBeenCalled();
      expect(adapter.issueInvoice).not.toHaveBeenCalled();
    });

    it('(c) create-race: create throws Duplicate -> re-read returns the winner, issues on the winner row', async () => {
      repo.findByIdempotencyKey
        .mockResolvedValueOnce(null) // read-gate miss
        .mockResolvedValueOnce(makeRecord({ id: 'winner', status: 'pending' })); // re-read
      repo.create.mockRejectedValue(new DuplicateInvoiceRecordException(CONNECTION, KEY));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      const finalRecord = makeRecord({ id: 'winner', status: 'issued' });
      repo.updateOutcome.mockResolvedValue(finalRecord);

      const result = await service.issueInvoice(makeCmd());

      expect(repo.findByIdempotencyKey).toHaveBeenCalledTimes(2);
      expect(repo.updateOutcome).toHaveBeenCalledWith('winner', expect.objectContaining({ status: 'issued' }));
      expect(result).toBe(finalRecord);
    });

    it('(c-issued) create-race where winner already issued -> returns winner, adapter NOT called', async () => {
      repo.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeRecord({ id: 'winner', status: 'issued' }));
      repo.create.mockRejectedValue(new DuplicateInvoiceRecordException(CONNECTION, KEY));

      const result = await service.issueInvoice(makeCmd());

      expect(result.status).toBe('issued');
      expect(adapter.issueInvoice).not.toHaveBeenCalled();
    });

    it('(c2) create-race guard: a non-Duplicate create error propagates untouched', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      const boom = new Error('db down');
      repo.create.mockRejectedValue(boom);

      await expect(service.issueInvoice(makeCmd())).rejects.toBe(boom);
      expect(repo.findByIdempotencyKey).toHaveBeenCalledTimes(1); // no re-read
    });

    it('(d) terminal rejection: adapter throws -> updateOutcome(failed + errorMessage) then rethrow', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      const rejection = new Error('provider rejected: invalid tax rate');
      adapter.issueInvoice.mockRejectedValue(rejection);
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'failed' }));

      await expect(service.issueInvoice(makeCmd())).rejects.toBe(rejection);
      // A plain Error carries no neutral failureMode, so it collapses to the
      // fiscal-safe 'in-doubt' (#1200) and the lease is released. An in-doubt
      // failure maps to the neutral 'transport-timeout' code (W1).
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-1', {
        status: 'failed',
        errorMessage: 'provider rejected: invalid tax rate',
        failureMode: 'in-doubt',
        failureCode: 'transport-timeout',
        failureReason:
          'The invoicing request timed out; the document may or may not have been created.',
        leaseExpiresAt: null,
      });
    });

    it("(d2) failureMode discriminator: a 'rejected'-marked throwable persists failureMode 'rejected'", async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      const rejection = Object.assign(new Error('provider rejected: invalid tax rate'), {
        failureMode: 'rejected' as const,
      });
      adapter.issueInvoice.mockRejectedValue(rejection);
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'failed' }));

      await expect(service.issueInvoice(makeCmd())).rejects.toBe(rejection);
      // A 'rejected' throwable whose reason text does NOT mention a tax id maps to
      // the generic neutral 'provider-rejected' code (W1).
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          status: 'failed',
          failureMode: 'rejected',
          failureCode: 'provider-rejected',
          failureReason: 'The invoicing provider rejected the request.',
        }),
      );
    });

    it("(d3) failureCode: a 'rejected' throwable whose reason mentions a tax id maps to 'buyer-tax-id-invalid'", async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      // Structural `reason` field (Subiekt's SubiektInvoiceRejectedError shape) —
      // read duck-typed, never value-imported (#1200/W1).
      const rejection = Object.assign(new Error('rejected'), {
        failureMode: 'rejected' as const,
        reason: 'Buyer tax id is malformed',
      });
      adapter.issueInvoice.mockRejectedValue(rejection);
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'failed' }));

      await expect(service.issueInvoice(makeCmd())).rejects.toBe(rejection);
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          status: 'failed',
          failureMode: 'rejected',
          failureCode: 'buyer-tax-id-invalid',
          failureReason: 'The buyer tax identifier was rejected as invalid.',
        }),
      );
    });

    it('(e) unreachable transport: adapter throws -> failed + rethrow (per-design propagation)', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      const transport = new Error('ECONNREFUSED');
      adapter.issueInvoice.mockRejectedValue(transport);
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'failed' }));

      await expect(service.issueInvoice(makeCmd())).rejects.toBe(transport);
      expect(repo.updateOutcome).toHaveBeenCalledWith('rec-1', expect.objectContaining({ status: 'failed' }));
    });

    it('(g) documentType pass-through: persisted verbatim on create AND rides the cmd to the adapter', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));

      const cmd = makeCmd({ documentType: 'credit-note' });
      await service.issueInvoice(cmd);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'credit-note' }));
      expect(adapter.issueInvoice).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'credit-note' }));
    });

    it("(h) retry-after-terminal-rejection: a 'rejected' failed hit IS re-attempted (claim, re-call adapter, updateOutcome issued + errorMessage:null)", async () => {
      const failedHit = makeRecord({
        id: 'failed-rec',
        status: 'failed',
        failureMode: 'rejected',
        errorMessage: 'stale boom',
      });
      repo.findByIdempotencyKey.mockResolvedValue(failedHit);
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'failed-rec', status: 'issued' }));

      await service.issueInvoice(makeCmd());

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.claimForIssue).toHaveBeenCalledWith('failed-rec', expect.any(Date));
      expect(adapter.issueInvoice).toHaveBeenCalledTimes(1);
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'failed-rec',
        expect.objectContaining({ status: 'issued', errorMessage: null }),
      );
    });

    it('(h2) pending hit (no live lease) is re-attempted via an atomic claim, then issued on the existing row', async () => {
      const pendingHit = makeRecord({ id: 'pending-rec', status: 'pending' });
      repo.findByIdempotencyKey.mockResolvedValue(pendingHit);
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'pending-rec', status: 'issued' }));

      await service.issueInvoice(makeCmd());

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.claimForIssue).toHaveBeenCalledWith('pending-rec', expect.any(Date));
      expect(repo.updateOutcome).toHaveBeenCalledWith('pending-rec', expect.objectContaining({ status: 'issued' }));
    });

    it('(i) keyless no-dedup (R1): no findByIdempotencyKey, create with idempotencyKey:null, normal issue', async () => {
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending', idempotencyKey: null }));
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));

      await service.issueInvoice(makeCmd({ idempotencyKey: undefined }));

      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: null }));
      expect(adapter.issueInvoice).toHaveBeenCalledTimes(1);
    });

    it('(j) R3: an in-doubt failed hit is NOT re-attempted — surfaced for manual reconciliation, NO provider call', async () => {
      const inDoubtHit = makeRecord({
        id: 'f',
        status: 'failed',
        failureMode: 'in-doubt',
        errorMessage: 'transport timeout — document may exist',
      });
      repo.findByIdempotencyKey.mockResolvedValue(inDoubtHit);

      const result = await service.issueInvoice(makeCmd());

      // Fiscal-safety invariant: a document MAY already exist, so the SVC must NOT
      // re-cross the boundary. It returns the stuck row untouched.
      expect(result).toBe(inDoubtHit);
      expect(repo.claimForIssue).not.toHaveBeenCalled();
      expect(adapter.issueInvoice).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
    });

    it('(j2) R3: a failed hit with NO recorded failureMode is treated as in-doubt — NOT re-attempted', async () => {
      const unknownModeHit = makeRecord({ id: 'f', status: 'failed', failureMode: null });
      repo.findByIdempotencyKey.mockResolvedValue(unknownModeHit);

      const result = await service.issueInvoice(makeCmd());

      expect(result).toBe(unknownModeHit);
      expect(adapter.issueInvoice).not.toHaveBeenCalled();
    });

    it('(l) R2/R3 pending: a row under a LIVE issuing lease is NOT re-attempted (no claim, no provider call)', async () => {
      const liveLeaseHit = makeRecord({
        id: 'in-flight',
        status: 'issuing',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      });
      repo.findByIdempotencyKey.mockResolvedValue(liveLeaseHit);

      const result = await service.issueInvoice(makeCmd());

      // An original attempt is still in flight; never race a second provider call.
      expect(result).toBe(liveLeaseHit);
      expect(repo.claimForIssue).not.toHaveBeenCalled();
      expect(adapter.issueInvoice).not.toHaveBeenCalled();
    });

    it('(l2) R2: an EXPIRED issuing lease is re-claimable — claim then re-attempt', async () => {
      const expiredLeaseHit = makeRecord({
        id: 'stale',
        status: 'issuing',
        leaseExpiresAt: new Date(Date.now() - 60_000),
      });
      repo.findByIdempotencyKey.mockResolvedValue(expiredLeaseHit);
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'stale', status: 'issued' }));

      await service.issueInvoice(makeCmd());

      expect(repo.claimForIssue).toHaveBeenCalledWith('stale', expect.any(Date));
      expect(adapter.issueInvoice).toHaveBeenCalledTimes(1);
    });

    it('(m) R2 single-flight: a LOST claim (claimForIssue -> null) backs off WITHOUT calling the provider', async () => {
      const reattemptable = makeRecord({ id: 'contended', status: 'pending' });
      repo.findByIdempotencyKey.mockResolvedValue(reattemptable);
      // The CAS lost to a concurrent same-key retry: null = slot held / terminal.
      repo.claimForIssue.mockResolvedValue(null);
      // findById re-reads the current row to return to the caller.
      const currentRow = makeRecord({ id: 'contended', status: 'issuing' });
      repo.findById.mockResolvedValue(currentRow);

      const result = await service.issueInvoice(makeCmd());

      expect(adapter.issueInvoice).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(result).toBe(currentRow);
    });

    it('(m2) R2 concurrency: of two same-key attempts on one re-attemptable row, EXACTLY ONE crosses the provider boundary', async () => {
      const reattemptable = makeRecord({ id: 'race', status: 'pending' });
      repo.findByIdempotencyKey.mockResolvedValue(reattemptable);

      // Simulate the atomic CAS: only the FIRST claimer wins; the rest get null.
      let claimed = false;
      repo.claimForIssue.mockImplementation((id: string) => {
        if (claimed) {
          return Promise.resolve(null);
        }
        claimed = true;
        return Promise.resolve(makeRecord({ id, status: 'issuing' }));
      });
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'race', status: 'issued' }));
      repo.findById.mockResolvedValue(makeRecord({ id: 'race', status: 'issuing' }));

      await Promise.all([service.issueInvoice(makeCmd()), service.issueInvoice(makeCmd())]);

      // The provider boundary is crossed exactly once despite two concurrent retries.
      expect(adapter.issueInvoice).toHaveBeenCalledTimes(1);
    });

    it('(k) errorMessage sanitization: a >500-char adapter message is length-bounded before persistence', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      const huge = 'x'.repeat(2000);
      adapter.issueInvoice.mockRejectedValue(new Error(huge));
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'failed' }));

      await expect(service.issueInvoice(makeCmd())).rejects.toThrow();

      const patch = repo.updateOutcome.mock.calls[0][1];
      expect(patch.errorMessage).toBeDefined();
      expect(patch.errorMessage!.length).toBeLessThanOrEqual(500);
      expect(patch.errorMessage!.length).toBeLessThan(huge.length);
      expect(patch.errorMessage).toContain('[truncated]');
    });
  });

  describe('getInvoice', () => {
    it('(f) delegates to repo.findByOrderId(orderId, connectionId), never touches the adapter', async () => {
      const record = makeRecord({ status: 'issued' });
      repo.findByOrderId.mockResolvedValue(record);

      const result = await service.getInvoice({ orderId: ORDER, connectionId: CONNECTION });

      expect(repo.findByOrderId).toHaveBeenCalledWith(ORDER, CONNECTION);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(result).toBe(record);
    });

    it('(f2) returns null when no record holds the order on the connection', async () => {
      repo.findByOrderId.mockResolvedValue(null);

      const result = await service.getInvoice({ orderId: ORDER, connectionId: CONNECTION });

      expect(result).toBeNull();
    });
  });

  describe('getInvoiceById (#1245)', () => {
    it('should delegate to repo.findById and never touch the adapter', async () => {
      const record = makeRecord({ id: 'inv-1', status: 'failed' });
      repo.findById.mockResolvedValue(record);

      const result = await service.getInvoiceById('inv-1');

      expect(repo.findById).toHaveBeenCalledWith('inv-1');
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(result).toBe(record);
    });

    it('should return null when no record holds the id', async () => {
      repo.findById.mockResolvedValue(null);

      expect(await service.getInvoiceById('missing')).toBeNull();
    });
  });

  describe('fiscal-safety lease invariant (#1200)', () => {
    it('keeps the CAS lease strictly above the max supported provider timeout (enforced by construction, not by comment)', () => {
      // If this ever fails, an expired lease could be re-claimed while the
      // original provider call is still in flight → a double-issued fiscal
      // document. The module-load guard in invoice.service.ts throws on the same
      // condition; this test pins the contract so a regression is caught in unit
      // tests too, not only at boot.
      expect(ISSUING_LEASE_MS).toBeGreaterThan(MAX_SUPPORTED_PROVIDER_TIMEOUT_MS);
    });
  });

  // W2: content-snapshot tests — issued-document content captured at issue time.
  describe('issueInvoice content snapshot (W2)', () => {
    it('should resolve the Invoicing adapter for the connection', async () => {
      adapter.issueInvoice.mockResolvedValue({ record: adapterRecord(), seller: SELLER });
      repo.create.mockImplementation((input) =>
        Promise.resolve(new InvoiceRecord(
          'rec-1', input.connectionId, input.orderId, input.providerType, input.documentType,
          input.status, input.providerInvoiceId ?? null, input.providerInvoiceNumber ?? null,
          input.regulatoryStatus ?? 'not-applicable', input.clearanceReference ?? null,
          input.idempotencyKey, input.pdfUrl ?? null, input.issuedAt ?? null,
          input.errorMessage ?? null, new Date(), new Date(),
          null, null, null, null, input.hasBuyerTaxId ?? false,
        )),
      );

      await service.issueInvoice(command());

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'Invoicing');
    });

    it('should snapshot the issued-document content with computed VAT and the adapter seller', async () => {
      adapter.issueInvoice.mockResolvedValue({ record: adapterRecord(), seller: SELLER });
      repo.create.mockResolvedValue(adapterRecord());
      let patch: Record<string, unknown> | undefined;
      repo.updateOutcome.mockImplementation((_id, p) => {
        patch = p as Record<string, unknown>;
        return Promise.resolve(adapterRecord());
      });

      await service.issueInvoice(command());

      const snapshotContent = patch?.['documentContent'] as IssuedDocumentContent | null | undefined;
      expect(snapshotContent).toBeDefined();
      expect(snapshotContent?.seller).toEqual(SELLER);
      expect(snapshotContent?.buyer.name).toBe('Jan Kowalski');
      expect(snapshotContent?.currency).toBe('PLN');
      expect(snapshotContent?.issueDate).toBe('2026-04-01T12:00:00.000Z');

      // Line 1: 2 * 123 = 246 gross @23% → net 200, vat 46.
      expect(snapshotContent?.lines[0]).toEqual({
        name: 'Widget', quantity: 2, unitNet: 100, taxRate: '23', net: 200, tax: 46, gross: 246,
      });
      // Totals across all three lines (net 340.65 + vat 60.35 = gross 401).
      expect(snapshotContent?.totals).toEqual({ net: 340.65, tax: 60.35, gross: 401 });
      // VAT breakdown grouped by rate (23% bucket = lines 1+2; 5% bucket = line 3).
      const byRate = Object.fromEntries((snapshotContent?.taxBreakdown ?? []).map((b) => [b.rate, b]));
      expect(byRate['23']).toEqual({ rate: '23', net: 240.65, tax: 55.35, gross: 296 });
      expect(byRate['5']).toEqual({ rate: '5', net: 100, tax: 5, gross: 105 });
    });

    it('should persist seller:null when the adapter surfaces no seller block', async () => {
      adapter.issueInvoice.mockResolvedValue({ record: adapterRecord() });
      repo.create.mockResolvedValue(adapterRecord());
      let patch: Record<string, unknown> | undefined;
      repo.updateOutcome.mockImplementation((_id, p) => {
        patch = p as Record<string, unknown>;
        return Promise.resolve(adapterRecord());
      });

      await service.issueInvoice(command());

      const snapshotContent = patch?.['documentContent'] as IssuedDocumentContent | null | undefined;
      expect(snapshotContent?.seller).toBeNull();
    });

    it('should persist the adapter-supplied source document in updateOutcome when present', async () => {
      const sourceDocument = {
        contentType: 'application/xml',
        contentBase64: 'PERvY3VtZW50PmZha2U8L0RvY3VtZW50Pg==',
      };
      adapter.issueInvoice.mockResolvedValue({ record: adapterRecord(), seller: SELLER, sourceDocument });
      repo.create.mockResolvedValue(adapterRecord());
      repo.updateOutcome.mockResolvedValue(adapterRecord());

      await service.issueInvoice(command());

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sourceDocument }),
      );
    });

    it('should persist sourceDocument:null in updateOutcome when the adapter surfaces none', async () => {
      adapter.issueInvoice.mockResolvedValue({ record: adapterRecord(), seller: SELLER });
      repo.create.mockResolvedValue(adapterRecord());
      repo.updateOutcome.mockResolvedValue(adapterRecord());

      await service.issueInvoice(command());

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sourceDocument: null }),
      );
    });
  });

  // #1297 — the issued patch of a correction persists the correction's OWN
  // post-correction ("after") line snapshot, computed from the caller-assembled
  // original snapshot + the per-line deltas, so a correction-of-correction diffs
  // against it.
  describe('issueCorrection (#1297 snapshot)', () => {
    let correctionAdapter: jest.Mocked<InvoicingPort & CorrectionIssuer>;

    // "Before" lines of the original document, as issued.
    const originalLines: InvoiceLine[] = [
      { name: 'Widget', quantity: 2, unitPriceGross: 100, taxRate: '23' },
      { name: 'Gadget', quantity: 1, unitPriceGross: 50, taxRate: '23' },
    ];

    function makeOriginalDocument(): OriginalDocumentSnapshot {
      return {
        buyer: makeBuyer(),
        currency: 'PLN',
        documentType: 'invoice',
        lines: originalLines,
        clearanceReference: 'KSEF-ORIG',
        documentNumber: 'FV/2026/1',
        issueDate: '2026-06-22',
      };
    }

    function makeCorrectionCmd(
      overrides: Partial<IssueCorrectionCommand> = {},
    ): IssueCorrectionCommand {
      return {
        connectionId: CONNECTION,
        orderId: ORDER,
        originalProviderInvoiceId: 'PROV-123',
        documentType: 'corrected',
        reason: 'price adjustment',
        lines: [{ originalLineNumber: 1, newUnitPriceGross: 90 }],
        idempotencyKey: 'corr-key-1',
        originalDocument: makeOriginalDocument(),
        ...overrides,
      };
    }

    beforeEach(() => {
      correctionAdapter = {
        issueInvoice: jest.fn(),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn(),
        issueCorrection: jest.fn().mockResolvedValue({
          record: makeRecord({ id: 'corr-rec', status: 'issued', documentType: 'corrected' }),
        }),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(correctionAdapter);
      repo.create.mockResolvedValue(
        makeRecord({ id: 'corr-rec', status: 'pending', documentType: 'corrected' }),
      );
      repo.updateOutcome.mockResolvedValue(
        makeRecord({ id: 'corr-rec', status: 'issued', documentType: 'corrected' }),
      );
    });

    it('persists the post-correction "after" lines: matched delta overrides, unmatched line unchanged', async () => {
      await service.issueCorrection(makeCorrectionCmd());

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({
          status: 'issued',
          issuedLineSnapshot: {
            buyer: makeBuyer(),
            currency: 'PLN',
            lines: [
              // Line 1: unitPriceGross overridden 100 -> 90, quantity kept.
              { name: 'Widget', quantity: 2, unitPriceGross: 90, taxRate: '23' },
              // Line 2: no delta -> unchanged.
              { name: 'Gadget', quantity: 1, unitPriceGross: 50, taxRate: '23' },
            ],
          },
        }),
      );
    });

    it('applies a quantity delta and leaves price untouched', async () => {
      await service.issueCorrection(
        makeCorrectionCmd({ lines: [{ originalLineNumber: 2, newQuantity: 5 }] }),
      );

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({
          issuedLineSnapshot: expect.objectContaining({
            lines: [
              { name: 'Widget', quantity: 2, unitPriceGross: 100, taxRate: '23' },
              { name: 'Gadget', quantity: 5, unitPriceGross: 50, taxRate: '23' },
            ],
          }),
        }),
      );
    });

    it('ignores a delta whose originalLineNumber is out of range (never throws)', async () => {
      await service.issueCorrection(
        makeCorrectionCmd({ lines: [{ originalLineNumber: 99, newQuantity: 3 }] }),
      );

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({
          issuedLineSnapshot: expect.objectContaining({ lines: originalLines }),
        }),
      );
    });

    it('persists a null snapshot when the caller supplied no originalDocument', async () => {
      await service.issueCorrection(makeCorrectionCmd({ originalDocument: undefined }));

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({ issuedLineSnapshot: null }),
      );
    });

    // #1229 follow-up regression: a correction's source document (e.g. KSeF's
    // FA(3) XML) was previously discarded entirely — `issueCorrection` never
    // persisted `documentContent`/`sourceDocument` at all, so a corrected
    // invoice's "View"/"Preview" always 409'd with "no source document
    // available" even when the adapter had built and submitted a real one.
    it('persists the adapter-supplied source document for a correction, same as issueInvoice', async () => {
      const sourceDocument = {
        contentType: 'application/xml',
        contentBase64: 'PEZha3R1cmE+a29yZWtjamE8L0Zha3R1cmE+',
      };
      correctionAdapter.issueCorrection.mockResolvedValue({
        record: makeRecord({ id: 'corr-rec', status: 'issued', documentType: 'corrected' }),
        sourceDocument,
      });

      await service.issueCorrection(makeCorrectionCmd());

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({ sourceDocument }),
      );
    });

    it('persists sourceDocument:null for a correction when the adapter surfaces none', async () => {
      await service.issueCorrection(makeCorrectionCmd());

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({ sourceDocument: null }),
      );
    });

    it('snapshots documentContent from the corrected ("after") lines, not the original', async () => {
      await service.issueCorrection(
        makeCorrectionCmd({ lines: [{ originalLineNumber: 1, newUnitPriceGross: 90 }] }),
      );

      const [, patch] = repo.updateOutcome.mock.calls.at(-1) as [string, Record<string, unknown>];
      const content = patch['documentContent'] as { lines: { unitNet: number }[] } | null;
      expect(content).not.toBeNull();
      // Line 1's price was corrected 100 -> 90 gross; documentContent must
      // reflect the corrected value, not the original document's 100.
      expect(content?.lines[0].unitNet).toBeCloseTo(90 / 1.23, 2);
    });

    it('persists documentContent:null for a correction when the caller supplied no originalDocument', async () => {
      await service.issueCorrection(makeCorrectionCmd({ originalDocument: undefined }));

      expect(repo.updateOutcome).toHaveBeenLastCalledWith(
        'corr-rec',
        expect.objectContaining({ documentContent: null }),
      );
    });
  });

  describe('numbering allocation (#1575)', () => {
    // A DocumentNumberConsumer adapter (KSeF-shaped): the marker discriminant
    // makes `isDocumentNumberConsumer` return true so the service allocates.
    let consumer: jest.Mocked<InvoicingPort> & { consumesDocumentNumber: true };

    beforeEach(() => {
      consumer = {
        issueInvoice: jest.fn().mockResolvedValue(makeIssuedFromAdapter()),
        getInvoice: jest.fn(),
        upsertCustomer: jest.fn(),
        getSupportedDocumentTypes: jest.fn(),
        consumesDocumentNumber: true,
        numberingTimeZone: 'Europe/Warsaw',
        maxDocumentNumberLength: 256,
      } as unknown as jest.Mocked<InvoicingPort> & { consumesDocumentNumber: true };
      integrations.getCapabilityAdapter.mockResolvedValue(consumer);
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'pending' }));
      repo.claimForIssue.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issuing' }));
      repo.updateOutcome.mockResolvedValue(makeRecord({ id: 'rec-1', status: 'issued' }));
    });

    it('routes an invoice to the invoice series and passes the rendered number to the adapter', async () => {
      numberingRepo.findSeriesIdForDocument.mockResolvedValue('series-main');
      numberingRepo.allocateNumber.mockResolvedValue({
        documentNumber: 'FV/2026/06/0001',
        allocatedSeq: 1,
      });

      await service.issueInvoice(makeCmd());

      expect(numberingRepo.findSeriesIdForDocument).toHaveBeenCalledWith(
        CONNECTION,
        'invoice',
        null,
      );
      expect(numberingRepo.allocateNumber).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: 'series-main',
          recordId: 'rec-1',
          connectionId: CONNECTION,
          timeZone: 'Europe/Warsaw',
          maxDocumentNumberLength: 256,
        }),
      );
      expect(consumer.issueInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ documentNumber: 'FV/2026/06/0001' }),
      );
    });

    it('threads ONE issuance instant into allocateNumber AND the adapter command (#1692)', async () => {
      numberingRepo.findSeriesIdForDocument.mockResolvedValue('series-main');
      numberingRepo.allocateNumber.mockResolvedValue({
        documentNumber: 'FV/2026/06/0001',
        allocatedSeq: 1,
      });

      await service.issueInvoice(makeCmd());

      const allocateArg = numberingRepo.allocateNumber.mock.calls[0][0];
      const [issuedCmd] = consumer.issueInvoice.mock.calls[0];
      // The same Date instance is handed to the allocation (as issueDate) and to
      // the adapter command (as issuedAt) — no day/period-boundary divergence.
      expect(allocateArg.issueDate).toBeInstanceOf(Date);
      expect(issuedCmd.issuedAt).toBe(allocateArg.issueDate);
    });

    it('routes a correction to the corrected series when a correction route exists', async () => {
      numberingRepo.findSeriesIdForDocument.mockResolvedValue('series-correction');
      numberingRepo.allocateNumber.mockResolvedValue({
        documentNumber: 'FK/2026/06/0001',
        allocatedSeq: 1,
      });

      await service.issueInvoice(
        makeCmd({
          documentType: 'corrected',
          correction: {
            originalClearanceReference: null,
            originalDocumentNumber: 'FV/2026/06/0001',
            originalIssueDate: '2026-06-01',
            reason: 'return',
            correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 12.3, taxRate: '23' }],
          },
        }),
      );

      expect(numberingRepo.allocateNumber).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 'series-correction' }),
      );
    });

    it('does NOT allocate for a non-consumer adapter and leaves documentNumber unset', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      adapter.issueInvoice.mockResolvedValue(makeIssuedFromAdapter());

      await service.issueInvoice(makeCmd());

      expect(numberingRepo.allocateNumber).not.toHaveBeenCalled();
      const [issuedCmd] = adapter.issueInvoice.mock.calls[0];
      expect(issuedCmd.documentNumber).toBeUndefined();
    });

    it('fails the record (rejected) and throws when the connection has no series route', async () => {
      numberingRepo.findSeriesIdForDocument.mockResolvedValue(null);

      await expect(service.issueInvoice(makeCmd())).rejects.toBeInstanceOf(
        MissingNumberingSeriesException,
      );
      expect(consumer.issueInvoice).not.toHaveBeenCalled();
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: 'failed', failureMode: 'rejected' }),
      );
    });

    it('reuses the persisted number on retry without allocating again', async () => {
      repo.claimForIssue.mockResolvedValue(
        makeRecord({ id: 'rec-1', status: 'issuing', documentNumber: 'FV/2026/06/0007' }),
      );

      await service.issueInvoice(makeCmd());

      expect(numberingRepo.allocateNumber).not.toHaveBeenCalled();
      expect(numberingRepo.findSeriesIdForDocument).not.toHaveBeenCalled();
      expect(consumer.issueInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ documentNumber: 'FV/2026/06/0007' }),
      );
    });
  });
});
