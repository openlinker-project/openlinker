/**
 * Fake Subiekt Bridge Adapter (#754)
 *
 * In-memory double of `SubiektBridgeClient` — a **plugin-internal contract**,
 * not a core `*.port.ts` (a deliberate, novel use of the `/testing` seam). It
 * lets Mac/Linux contributors develop and unit-test the real Subiekt adapter
 * (#753) without a Windows VM or a live Sfera bridge — Subiekt nexo is
 * Windows-only and cannot be containerized, so the real dependency is
 * categorically un-runnable here (the textbook case for an in-memory fake).
 *
 * Returns deterministic mock data shaped EXACTLY like the real bridge `data`
 * payloads (numeric `providerInvoiceId`/`id`, `FV-MOCK-001`, …,
 * `regulatoryStatus: 'sent'`) and supports seeded failure modes + `seed`/`clear`
 * helpers. Consumed only from `*.spec.ts` via
 * `@openlinker/integrations-subiekt/testing`. Keeping the fake on the real shape
 * is what stops it drifting from reality (the bug this reconciliation fixed).
 *
 * Fidelity caveat: a fake can pass while the real bridge fails. The shared
 * `runSubiektBridgeContractTests` suite is the seam that keeps both honest — it
 * must also run against the real client (#753) on a Windows CI job (#752).
 *
 * @module libs/integrations/subiekt/testing
 */
import type { SubiektBridgeClient } from '../bridge/subiekt-bridge.client';
import {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from '../bridge/subiekt-bridge.errors';
import type {
  BridgeBankAccount,
  BridgeCashRegister,
  BridgeInvoiceStatusRequest,
  BridgeInvoiceStatusResponse,
  BridgeIssueInvoiceRequest,
  BridgeIssueInvoiceResponse,
  BridgeKorektaRequest,
  BridgeKorektaResponse,
  BridgeListBankAccountsResponse,
  BridgeListCashRegistersResponse,
  BridgeSetDefaultBankAccountResponse,
  BridgeUpsertCustomerRequest,
  BridgeUpsertCustomerResponse,
} from '../bridge/subiekt-bridge.types';

type SeededFailure =
  | { kind: 'bridge-unreachable' }
  | { kind: 'subiekt-rejected'; reason: string };

/**
 * Deterministic default bank accounts. Two accounts, one default, and a THIRD
 * carrying a distinct `ownerPodmiotId` (2 vs 1) so multi-payer UI/behaviour can
 * be exercised downstream. Numeric ids mirror the real bridge's `100xxx` space.
 */
function defaultBankAccounts(): BridgeBankAccount[] {
  return [
    {
      id: 100004,
      name: 'Rachunek podstawowy',
      number: '00 10101010 1111 1111 1111 1111',
      bankNumber: null,
      description: null,
      currency: 'PLN',
      isVatAccount: false,
      isDefault: true,
      ownerPodmiotId: 1,
      ownerName: 'Moja Firma Sp. z o.o.',
    },
    {
      id: 100007,
      name: 'Rachunek VAT',
      number: '00 10101010 2222 2222 2222 2222',
      bankNumber: null,
      description: null,
      currency: 'PLN',
      isVatAccount: true,
      isDefault: false,
      ownerPodmiotId: 1,
      ownerName: 'Moja Firma Sp. z o.o.',
    },
    {
      id: 100011,
      name: 'Rachunek oddziału',
      number: '00 10101010 3333 3333 3333 3333',
      bankNumber: null,
      description: null,
      currency: 'PLN',
      isVatAccount: false,
      isDefault: false,
      ownerPodmiotId: 2,
      ownerName: 'Oddział Handlowy Sp. z o.o.',
    },
  ];
}

/**
 * Deterministic default cash registers (Stanowiska Kasowe) — a mix of linked
 * (`oddzialId` set to an informational branch tag) and unlinked (`oddzialId:
 * null`), matching the real probe data.
 */
function defaultCashRegisters(): BridgeCashRegister[] {
  return [
    { id: 100065, name: 'Kasa Centralna', symbol: 'CENTR', oddzialId: null },
    { id: 100066, name: 'Kasa Outlet', symbol: 'OUTLET', oddzialId: null },
    { id: 100067, name: 'Kasa Pachnidło', symbol: 'PACH', oddzialId: 100001 },
  ];
}

export class FakeSubiektBridgeAdapter implements SubiektBridgeClient {
  private issueCounter = 0;
  private customerCounter = 0;
  private seededFailure: SeededFailure | null = null;
  private issueOverride: Partial<BridgeIssueInvoiceResponse> | null = null;
  // Keyed by the STRING form of the numeric providerInvoiceId (matches how the
  // status read keys its lookup).
  private readonly issuedById = new Map<string, BridgeIssueInvoiceResponse>();
  /** The most recent korekta request body (for passthrough assertions in tests). */
  private lastKorektaRequest: BridgeKorektaRequest | null = null;
  /** Discovery state (bank accounts / cash registers), #1324. */
  private bankAccounts: BridgeBankAccount[] = defaultBankAccounts();
  private cashRegisters: BridgeCashRegister[] = defaultCashRegisters();

  issueInvoice(_req: BridgeIssueInvoiceRequest): Promise<BridgeIssueInvoiceResponse> {
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    this.issueCounter += 1;
    const response: BridgeIssueInvoiceResponse = {
      // Real bridge returns a numeric Subiekt document id.
      providerInvoiceId: 100_000 + this.issueCounter,
      providerInvoiceNumber: `FV-MOCK-${String(this.issueCounter).padStart(3, '0')}`,
      state: 'issued',
      regulatoryStatus: 'sent',
      pdfUrl: null,
      ...this.issueOverride,
    };
    this.issuedById.set(String(response.providerInvoiceId), response);
    return Promise.resolve(response);
  }

  issueCorrection(origId: number, req: BridgeKorektaRequest): Promise<BridgeKorektaResponse> {
    this.lastKorektaRequest = req;
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    this.issueCounter += 1;
    // `seed({ state })` exercises the failed-correction branch; `seed({
    // regulatoryStatus })` only affects the status read-back below.
    const state = this.issueOverride?.state ?? 'issued';
    const response: BridgeKorektaResponse = {
      // Distinct id space (300_000+) so a correction never collides with the
      // original it corrects; still a numeric Subiekt document id.
      providerInvoiceId: 300_000 + this.issueCounter,
      providerInvoiceNumber: `FK-MOCK-${String(this.issueCounter).padStart(3, '0')}`,
      korygowanyId: origId,
      przyczyna: req.przyczyna ?? null,
      state,
    };
    // Remember a status-shaped entry so a subsequent status read-back resolves
    // (the korekta response itself carries no regulatoryStatus).
    this.issuedById.set(String(response.providerInvoiceId), {
      providerInvoiceId: response.providerInvoiceId,
      providerInvoiceNumber: response.providerInvoiceNumber,
      state,
      regulatoryStatus: this.issueOverride?.regulatoryStatus ?? 'sent',
      pdfUrl: null,
    });
    return Promise.resolve(response);
  }

  upsertCustomer(_req: BridgeUpsertCustomerRequest): Promise<BridgeUpsertCustomerResponse> {
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    this.customerCounter += 1;
    const id = 200_000 + this.customerCounter;
    return Promise.resolve({
      id,
      numer: String(id),
      nazwaSkrocona: _req.nazwaSkrocona,
      nip: _req.nip,
    });
  }

  getInvoiceStatus(req: BridgeInvoiceStatusRequest): Promise<BridgeInvoiceStatusResponse> {
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    const known = this.issuedById.get(req.providerInvoiceId);
    return Promise.resolve(
      known
        ? { state: known.state, regulatoryStatus: known.regulatoryStatus }
        : { state: 'failed', regulatoryStatus: 'none' },
    );
  }

  listBankAccounts(): Promise<BridgeListBankAccountsResponse> {
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    const accounts = this.bankAccounts.map((a) => ({ ...a }));
    return Promise.resolve({ count: accounts.length, accounts });
  }

  setDefaultBankAccount(bankAccountId: number): Promise<BridgeSetDefaultBankAccountResponse> {
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    const target = this.bankAccounts.find((a) => a.id === bankAccountId);
    if (!target) {
      // Mirror the real bridge's 422 for an unknown account id.
      return Promise.reject(new SubiektRejectedError(`Unknown bank account id: ${bankAccountId}`));
    }
    // Idempotent flip: the picked account becomes the sole default.
    for (const account of this.bankAccounts) {
      account.isDefault = account.id === bankAccountId;
    }
    return Promise.resolve({ bankAccountId, isDefault: true });
  }

  listCashRegisters(): Promise<BridgeListCashRegistersResponse> {
    const failure = this.failureError();
    if (failure) {
      return Promise.reject(failure);
    }
    const cashRegisters = this.cashRegisters.map((c) => ({ ...c }));
    return Promise.resolve({ count: cashRegisters.length, cashRegisters });
  }

  // --- test helpers -----------------------------------------------------------

  /**
   * Make every subsequent call reject with the corresponding typed error until
   * `clear()`. `'bridge-unreachable'` → `SubiektBridgeUnreachableError`;
   * `'subiekt-rejected'` → `SubiektRejectedError` carrying `opts.reason`.
   */
  seedFailure(kind: 'bridge-unreachable'): void;
  seedFailure(kind: 'subiekt-rejected', opts: { reason: string }): void;
  seedFailure(kind: SeededFailure['kind'], opts?: { reason: string }): void {
    this.seededFailure =
      kind === 'subiekt-rejected'
        ? { kind, reason: opts?.reason ?? 'rejected' }
        : { kind };
  }

  /** Override fields on the next (and subsequent) `issueInvoice` response until `clear()`. */
  seed(issueResponse: Partial<BridgeIssueInvoiceResponse>): void {
    this.issueOverride = issueResponse;
  }

  /** The body passed to the most recent `issueCorrection` call (passthrough assertions). */
  getLastKorektaRequest(): BridgeKorektaRequest | null {
    return this.lastKorektaRequest;
  }

  /** Replace the seeded bank accounts (deep-copied) for `listBankAccounts`/`setDefaultBankAccount`. */
  seedBankAccounts(accounts: BridgeBankAccount[]): void {
    this.bankAccounts = accounts.map((a) => ({ ...a }));
  }

  /** Replace the seeded cash registers (deep-copied) for `listCashRegisters`. */
  seedCashRegisters(cashRegisters: BridgeCashRegister[]): void {
    this.cashRegisters = cashRegisters.map((c) => ({ ...c }));
  }

  /** Reset all in-memory state between tests. */
  clear(): void {
    this.issueCounter = 0;
    this.customerCounter = 0;
    this.seededFailure = null;
    this.issueOverride = null;
    this.issuedById.clear();
    this.lastKorektaRequest = null;
    this.bankAccounts = defaultBankAccounts();
    this.cashRegisters = defaultCashRegisters();
  }

  private failureError(): Error | null {
    if (!this.seededFailure) {
      return null;
    }
    return this.seededFailure.kind === 'bridge-unreachable'
      ? new SubiektBridgeUnreachableError()
      : new SubiektRejectedError(this.seededFailure.reason);
  }
}
