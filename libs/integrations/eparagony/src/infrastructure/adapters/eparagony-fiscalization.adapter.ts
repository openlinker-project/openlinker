/**
 * eparagony.pl Fiscalization Adapter
 *
 * First implementation of `FiscalizationPort` (ADR-042). eparagony.pl is an
 * e-receipt distribution hub fronting vendor software that drives the seller's
 * own online fiscal printer, so this adapter hands a completed sale to a
 * registering mechanism somebody else operates - it never performs the fiscal
 * registration itself, and OpenLinker is never the issuer.
 *
 * It also implements `FiscalRegistrationLocator`, which is only possible because
 * the adapter supplies its OWN deterministic `documentToken` on the create (see
 * `document-token.policy.ts`). The vendor publishes no search by order id or
 * registration key; without the derived token an indeterminate call would leave
 * nothing to look the registration up by.
 *
 * TWO BEHAVIOURS DESERVE THE READER'S ATTENTION.
 *
 * 1. **`registerTransaction` blocks on a bounded status poll.** The create
 *    returns `202 Accepted` - the device has not printed or registered anything
 *    yet, and may still fail. Returning at `202` would report a completed fiscal
 *    registration that does not exist, and `registered` is TERMINAL in core.
 *    So the call polls `GET /documents/{token}/status` to a terminal status,
 *    inside a wall-clock budget kept under core's supported provider round-trip
 *    ceiling. This mirrors `InfaktInvoicingAdapter`'s async-task poll (#1763).
 *
 * 2. **Every failure is classified towards `in-doubt`.** A wrong `rejected`
 *    invites a resend, and a sale registered twice is a legal event for the
 *    seller. Only an outcome where the provider demonstrably created no fiscal
 *    registration is reported as `rejected`.
 *
 * The adapter is a PURE MECHANISM: it never deduplicates and holds no state.
 * Idempotency, persistence and the exactly-once guarantee belong to core.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  FiscalizationPort,
  FiscalLocateCriteria,
  FiscalLocateResult,
  FiscalRegistrationLocator,
  RegisterTransactionCommand,
  RegisterTransactionResult,
} from '@openlinker/core/fiscalization';

import { EPARAGONY_REGISTER_DEADLINE_MS } from '../../eparagony.constants';
import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { EparagonyNetworkError } from '../../domain/exceptions/eparagony-network.error';
import {
  deriveDocumentToken,
  deriveTransactionToken,
} from '../../domain/policies/document-token.policy';
import {
  EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS,
  EPARAGONY_ERROR_UNKNOWN_DOCUMENT,
  EPARAGONY_STATUS_CONFIRMED,
  EPARAGONY_STATUS_ERROR,
  type EparagonyDocumentStatusResponse,
} from '../../domain/types/eparagony-api.types';
import type { EparagonyConnectionConfig } from '../../domain/types/eparagony-config.types';
import type { IEparagonyHttpClient } from '../http/eparagony-http-client.interface';
import {
  isConfirmed,
  readDocumentStatus,
  toCreateReceiptRequest,
  toLocateResult,
  toRegisterTransactionResult,
} from './eparagony-document.mapper';

const DOCUMENTS_PATH = 'documents';

/**
 * Default ceiling on the status poll. Deliberately well under
 * {@link EPARAGONY_REGISTER_DEADLINE_MS} so the create (with its own retries)
 * fits inside the same budget.
 */
const DEFAULT_STATUS_POLL_TIMEOUT_MS = 60_000;

/** Floor on an operator-configured poll timeout - a device needs seconds, not milliseconds. */
const MIN_STATUS_POLL_TIMEOUT_MS = 5_000;

/** Ceiling on an operator-configured poll timeout, so the deadline invariant cannot be configured away. */
const MAX_STATUS_POLL_TIMEOUT_MS = 90_000;

/** First gap before re-reading the status. The vendor asks for exponential backoff. */
const STATUS_POLL_INITIAL_DELAY_MS = 1_000;
const STATUS_POLL_BACKOFF_MULTIPLIER = 1.6;
const STATUS_POLL_MAX_DELAY_MS = 5_000;

// Fail loud at module load if the poll ceiling is ever raised past the whole-call
// deadline, which would let one registration outlive core's in-flight lease.
if (MAX_STATUS_POLL_TIMEOUT_MS >= EPARAGONY_REGISTER_DEADLINE_MS) {
  throw new Error(
    `eparagony.pl fiscal-safety invariant violated: MAX_STATUS_POLL_TIMEOUT_MS ` +
      `(${MAX_STATUS_POLL_TIMEOUT_MS}ms) must stay below EPARAGONY_REGISTER_DEADLINE_MS ` +
      `(${EPARAGONY_REGISTER_DEADLINE_MS}ms).`,
  );
}

export class EparagonyFiscalizationAdapter
  implements FiscalizationPort, FiscalRegistrationLocator
{
  constructor(
    private readonly connectionId: string,
    private readonly http: IEparagonyHttpClient,
    private readonly logger: LoggerPort,
    private readonly config: EparagonyConnectionConfig,
  ) {}

  async registerTransaction(
    cmd: RegisterTransactionCommand,
  ): Promise<RegisterTransactionResult> {
    const documentToken = deriveDocumentToken(this.connectionId, cmd.idempotencyKey);
    const transactionToken = deriveTransactionToken(this.connectionId, cmd.idempotencyKey);

    // Composition failures (unresolvable rate, non-registrable amount) throw
    // `EparagonyConfigException` with `failureMode: 'rejected'` BEFORE anything
    // crosses the boundary - nothing was sent, so nothing was registered.
    const body = toCreateReceiptRequest({
      command: cmd,
      config: this.config,
      documentToken,
      transactionToken,
    });

    if (body.eReceipt.metadata.currency !== undefined && body.eReceipt.metadata.currency !== 'PLN') {
      // The vendor field is the REGISTER's ledger currency. A device programmed
      // in PLN will reject or mis-book anything else, and OL cannot observe how
      // the device is programmed - so this is surfaced rather than silently
      // normalised or dropped.
      this.logger.warn(
        `eparagony.pl registration for order ${cmd.orderId} declares currency ` +
          `${body.eReceipt.metadata.currency}; the fiscal device may not be programmed for it ` +
          `[connectionId=${this.connectionId}]`,
      );
    }

    const deadline = Date.now() + EPARAGONY_REGISTER_DEADLINE_MS;

    await this.createDocument(body, cmd.idempotencyKey, documentToken, cmd.orderId);

    const status = await this.pollToTerminalStatus(documentToken, deadline, cmd.orderId);
    return toRegisterTransactionResult(status, documentToken);
  }

  async locateByQuery(criteria: FiscalLocateCriteria): Promise<FiscalLocateResult | null> {
    const key = criteria.idempotencyKey?.trim() ?? '';
    if (key.length === 0) {
      // The vendor's ONLY document lookup is by its path token, and our token is
      // derived from the registration key. Without the key there is nothing to
      // derive, and neither `orderId` nor a date range is queryable here.
      this.logger.warn(
        `eparagony.pl cannot locate a registration without an idempotency key ` +
          `[connectionId=${this.connectionId}]`,
      );
      return null;
    }

    const documentToken = deriveDocumentToken(this.connectionId, key);
    const status = await this.readStatus(documentToken, { treatUnknownDocumentAsMissing: true });

    if (status === null) {
      // The provider holds no document under our token.
      return null;
    }

    if (!isConfirmed(status)) {
      // The provider HAS the document but has not confirmed a fiscal
      // registration for it. `FiscalLocateResult` cannot express "found, not
      // registered yet" - core reads any non-null answer as proof of a completed
      // registration and would terminalise the record on it. Reporting `null`
      // leaves the record in doubt for an operator, which is the fiscal-safe
      // reading of the two available answers. See the known-gaps note in the
      // package README.
      this.logger.warn(
        `eparagony.pl holds document ${documentToken} at status ` +
          `"${readDocumentStatus(status) ?? 'unknown'}"; reporting no confirmed registration so the ` +
          `record stays in doubt [connectionId=${this.connectionId}]`,
      );
      return null;
    }

    return toLocateResult(status, documentToken);
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  private async createDocument(
    body: ReturnType<typeof toCreateReceiptRequest>,
    idempotencyKey: string,
    documentToken: string,
    orderId: string,
  ): Promise<void> {
    try {
      await this.http.post<unknown>(DOCUMENTS_PATH, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
        // Safe to re-issue on a 5xx/network failure precisely BECAUSE of the
        // header above: the vendor guarantees that repeating a key with the same
        // body cannot mint a second document, and therefore cannot mint a second
        // fiscal registration.
        idempotent: true,
      });
      this.logger.log(
        `eparagony.pl accepted the document for order ${orderId} as ${documentToken} ` +
          `[connectionId=${this.connectionId}]`,
      );
    } catch (error) {
      if (
        error instanceof EparagonyApiError &&
        error.errorCode === EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS
      ) {
        // Our token is deterministic, so "already exists" means OUR earlier
        // attempt landed. Reporting a rejection here would be the wrong-direction
        // error the whole taxonomy exists to prevent: the status read below
        // resolves what actually happened.
        this.logger.warn(
          `eparagony.pl already holds document ${documentToken} for order ${orderId}; ` +
            `reading its status instead of re-creating [connectionId=${this.connectionId}]`,
        );
        return;
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Status poll
  // -------------------------------------------------------------------------

  /**
   * Poll until the document reaches a terminal status, or the budget runs out.
   *
   * `CONFIRMED` is the only success. `ERROR` is the one definite rejection the
   * provider ever reports. `READY` means the printer processed the commands but
   * the e-document has not reached the repository yet, so it is NOT terminal -
   * treating it as success would claim a registration the repository has not
   * accepted.
   */
  private async pollToTerminalStatus(
    documentToken: string,
    deadline: number,
    orderId: string,
  ): Promise<EparagonyDocumentStatusResponse> {
    let delay = STATUS_POLL_INITIAL_DELAY_MS;
    const pollUntil = Math.min(deadline, Date.now() + this.resolvePollTimeoutMs());
    let lastStatus: string | null = null;

    for (;;) {
      const body = await this.readStatus(documentToken, {
        treatUnknownDocumentAsMissing: false,
      });
      // `treatUnknownDocumentAsMissing: false` never returns null.
      const status = body === null ? null : readDocumentStatus(body);
      lastStatus = status ?? lastStatus;

      if (body !== null && status === EPARAGONY_STATUS_CONFIRMED) {
        return body;
      }
      if (body !== null && status === EPARAGONY_STATUS_ERROR) {
        throw this.toTerminalRejection(body, documentToken, orderId);
      }

      const remaining = pollUntil - Date.now();
      if (remaining <= 0) {
        // The device may still complete. Never a rejection.
        throw new EparagonyNetworkError(
          `eparagony.pl did not confirm document ${documentToken} for order ${orderId} within the ` +
            `poll budget (last status "${lastStatus ?? 'unknown'}")`,
        );
      }
      await sleep(Math.min(delay, remaining));
      delay = Math.min(delay * STATUS_POLL_BACKOFF_MULTIPLIER, STATUS_POLL_MAX_DELAY_MS);
    }
  }

  /**
   * Terminal `ERROR`: the provider explicitly reports the fiscalization failed,
   * so no fiscal registration exists. `rejected` is safe here for a reason
   * specific to this vendor - OL sends its own registration key as the vendor's
   * `Idempotency-Key`, so re-crossing the boundary under the same key cannot
   * produce a second registration of the sale, which is exactly what the neutral
   * definition of `rejected` requires.
   *
   * Note the operational consequence, recorded honestly: because the vendor
   * replays the same key idempotently, a re-attempt after the operator fixes the
   * device returns this same failed document. A genuine retry needs a fresh
   * registration key, i.e. an operator action.
   */
  private toTerminalRejection(
    body: EparagonyDocumentStatusResponse,
    documentToken: string,
    orderId: string,
  ): EparagonyApiError {
    const errorCode = typeof body.errorCode === 'number' ? body.errorCode : null;
    // The vendor's `errorDescription` quotes the printer and can echo a product
    // name, so it is logged but never promoted into the operator-facing reason
    // core persists on the record.
    const description =
      typeof body.errorDescription === 'string' ? body.errorDescription : 'no description';
    this.logger.warn(
      `eparagony.pl reported a terminal error for document ${documentToken} (order ${orderId}, ` +
        `code ${errorCode ?? 'none'}): ${description} [connectionId=${this.connectionId}]`,
    );
    return new EparagonyApiError(
      `eparagony.pl reported a terminal fiscalization error for document ${documentToken} ` +
        `(code ${errorCode ?? 'none'})`,
      // Not an HTTP status - the read itself succeeded. Recorded as the vendor's
      // own code so a support conversation has something to key on.
      200,
      { errorCode },
      {
        failureMode: 'rejected',
        reason:
          'The fiscal device reported an error and did not register the sale. Check the device, then register again under a new key.',
      },
    );
  }

  /**
   * Read one document status.
   *
   * `treatUnknownDocumentAsMissing` converts the vendor's "no such token"
   * rejection into `null` - the locator's "the provider holds no match". The
   * poll never asks for that, because a document that vanished mid-poll is not a
   * clean absence and must stay in doubt.
   */
  private async readStatus(
    documentToken: string,
    options: { treatUnknownDocumentAsMissing: boolean },
  ): Promise<EparagonyDocumentStatusResponse | null> {
    try {
      const { data } = await this.http.get<EparagonyDocumentStatusResponse>(
        `${DOCUMENTS_PATH}/${encodeURIComponent(documentToken)}/status`,
      );
      // A body that is not an object at all is a contract break, not a status.
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new EparagonyNetworkError(
          `eparagony.pl returned a non-object status body for document ${documentToken}`,
        );
      }
      return data;
    } catch (error) {
      if (
        options.treatUnknownDocumentAsMissing &&
        error instanceof EparagonyApiError &&
        error.errorCode !== null &&
        (EPARAGONY_ERROR_UNKNOWN_DOCUMENT as readonly number[]).includes(error.errorCode)
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Clamp the operator's poll timeout into the range the deadline invariant allows. */
  private resolvePollTimeoutMs(): number {
    const configured = this.config.statusPollTimeoutMs;
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
      return DEFAULT_STATUS_POLL_TIMEOUT_MS;
    }
    return Math.min(Math.max(configured, MIN_STATUS_POLL_TIMEOUT_MS), MAX_STATUS_POLL_TIMEOUT_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
