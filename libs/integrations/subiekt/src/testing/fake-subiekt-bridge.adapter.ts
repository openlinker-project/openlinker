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
  BridgeInvoiceStatusRequest,
  BridgeInvoiceStatusResponse,
  BridgeIssueInvoiceRequest,
  BridgeIssueInvoiceResponse,
  BridgeUpsertCustomerRequest,
  BridgeUpsertCustomerResponse,
} from '../bridge/subiekt-bridge.types';

type SeededFailure =
  | { kind: 'bridge-unreachable' }
  | { kind: 'subiekt-rejected'; reason: string };

export class FakeSubiektBridgeAdapter implements SubiektBridgeClient {
  private issueCounter = 0;
  private customerCounter = 0;
  private seededFailure: SeededFailure | null = null;
  private issueOverride: Partial<BridgeIssueInvoiceResponse> | null = null;
  // Keyed by the STRING form of the numeric providerInvoiceId (matches how the
  // status read keys its lookup).
  private readonly issuedById = new Map<string, BridgeIssueInvoiceResponse>();

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

  /** Reset all in-memory state between tests. */
  clear(): void {
    this.issueCounter = 0;
    this.customerCounter = 0;
    this.seededFailure = null;
    this.issueOverride = null;
    this.issuedById.clear();
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
