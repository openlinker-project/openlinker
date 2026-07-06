/**
 * Subiekt Bridge Client — contract
 *
 * The HTTP surface OpenLinker's Subiekt adapter (#753) calls against the local
 * Windows bridge (#752). Interface only — the real HTTP implementation is #753;
 * the in-memory double is `FakeSubiektBridgeAdapter` (#754, this package's
 * `/testing` sub-barrel). Covers exactly the endpoints the adapter needs: issue
 * an invoice, issue a correction (faktura korygująca), upsert a customer, read a
 * document's status.
 *
 * @module libs/integrations/subiekt/bridge
 * @see {@link FakeSubiektBridgeAdapter} for the in-memory test double
 */
import type {
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
} from './subiekt-bridge.types';

export interface SubiektBridgeClient {
  /** Issue a fiscal document. Rejects with `SubiektBridgeUnreachableError` / `SubiektRejectedError` on failure. */
  issueInvoice(req: BridgeIssueInvoiceRequest): Promise<BridgeIssueInvoiceResponse>;

  /**
   * Issue a correction document (faktura korygująca) against an already-issued
   * original, identified by its numeric `origId`. Returns the korekta-specific
   * response shape and shares `issueInvoice`'s failure modes. The REAL bridge
   * route is `POST /api/invoices/{origId}/corrections`.
   */
  issueCorrection(origId: number, req: BridgeKorektaRequest): Promise<BridgeKorektaResponse>;

  /** Create-or-update a customer (kontrahent) in Subiekt. */
  upsertCustomer(req: BridgeUpsertCustomerRequest): Promise<BridgeUpsertCustomerResponse>;

  /** Read the current state of a previously-issued document. */
  getInvoiceStatus(req: BridgeInvoiceStatusRequest): Promise<BridgeInvoiceStatusResponse>;

  /**
   * List the seller's bank accounts (rachunki bankowe), each tagged with its
   * owning Podmiot on a multi-payer install. The REAL bridge route is
   * `GET /api/bank-accounts` (#1324).
   */
  listBankAccounts(): Promise<BridgeListBankAccountsResponse>;

  /**
   * Mark a bank account as the seller's default. Idempotent (re-selecting the
   * current default is a no-op success). The REAL bridge route is
   * `PUT /api/bank-accounts/{id}/default` (#1324).
   */
  setDefaultBankAccount(bankAccountId: number): Promise<BridgeSetDefaultBankAccountResponse>;

  /**
   * List the seller's Stanowiska Kasowe (cash registers). The REAL bridge route
   * is `GET /api/cash-registers` (#1324).
   */
  listCashRegisters(): Promise<BridgeListCashRegistersResponse>;
}
