/**
 * Invoicing Issue Handler (OL #1120)
 *
 * Handles `invoicing.issue` sync jobs — very nearly a pure delegate to
 * `IInvoiceService`, with ONE deliberate exception noted below.
 * The policy service (`AutoIssueTriggerService`) has already composed the
 * issuance command into the job payload, so this handler:
 *  1. Casts + DEEP-validates the payload (F5).
 *  2. Reconstructs `new BuyerProfile(...)` from the PLAIN payload buyer (#12).
 *  3. Calls `invoiceService.issueInvoice(command)` with the command idempotency
 *     key equal to `payload.idempotencyKey` (the SAME string as the job row, F4).
 *
 * PII DISCIPLINE (F-validate-PII / D11): the payload carries real buyer PII.
 * Therefore NO failure path may serialize `payload` / `buyer` / `lines`:
 *  - A malformed/over-bound payload → return `{ outcome: 'business_failure' }`
 *    (never succeeds on retry); the log names ONLY the failed field(s) +
 *    `orderId` / `connectionId` / `schemaVersion`. It does NOT throw a
 *    `SyncJobExecutionError` carrying `JSON.stringify(job.payload)` (deliberately
 *    diverging from the inventory-handler precedent).
 *  - A transport/bridge-unreachable error → wrap in `SyncJobExecutionError` and
 *    THROW (retryable); the message excludes payload/buyer (only `error.name` +
 *    `orderId` / `connectionId`).
 *
 * THE ONE THING THIS HANDLER DOES BESIDES DELEGATE (Z3). After a successful
 * issuance it asks for a post-document master stock re-read. On a master where
 * the DOCUMENT moves stock — Subiekt, whose FS/PA carries the warehouse release
 * — the refresh `OrderSyncService` fires at order-create time runs BEFORE the
 * sale is recorded and therefore reads the pre-sale quantity; measured at 5.1 s
 * early, and unrepeatable because that key is order-scoped. This is the only
 * point that both knows the document committed and still holds the payload.
 *
 * It lives here rather than in `InvoiceService` on purpose: doing it there
 * would mean injecting the job queue, identifier mapping and the integrations
 * registry into `InvoicingModule` — a new invoicing→inventory edge and three
 * new throw sites on the fiscal-safety-critical write path, whose whole premise
 * is that nothing may disturb a committed document. Here it is wrapped so it
 * can never change the outcome.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  InvoicingIssuePayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  POST_SALE_INVENTORY_REFRESH_SERVICE_TOKEN,
  type PostSaleInventoryRefreshService,
} from '@openlinker/core/inventory';
import {
  IInvoiceService,
  INVOICE_SERVICE_TOKEN,
  BuyerProfile,
  BuyerTypeValues,
  OrderAlreadyInvoicedException,
  MissingTaxRateException,
} from '@openlinker/core/invoicing';
import type { IssueInvoiceCommand } from '@openlinker/core/invoicing';
import { isTaxRateEra } from '@openlinker/core/sales-documents';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

/**
 * Hard ceiling on `lines[]` length (F5). Rejects empty AND over-bound payloads
 * so a pathological job can never balloon the issuance call.
 */
export const MAX_INVOICE_LINES = 200;

@Injectable()
export class InvoicingIssueHandler implements SyncJobHandler {
  private readonly logger = new Logger(InvoicingIssueHandler.name);

  constructor(
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoiceService: IInvoiceService,
    @Inject(POST_SALE_INVENTORY_REFRESH_SERVICE_TOKEN)
    private readonly postSaleInventoryRefresh: PostSaleInventoryRefreshService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    // F5: deep-validate first. A malformed/over-bound payload is a terminal
    // business failure — it can NEVER succeed on retry — so return the outcome
    // rather than throw a retryable error. validatePayload logs only field names
    // + ids (no payload/buyer/lines).
    const payload = this.validatePayload(job);
    if (payload === null) {
      return { outcome: 'business_failure' };
    }

    const command = this.toCommand(payload);

    try {
      // F4: command idempotencyKey === payload.idempotencyKey === job row key.
      // The service's `issued`-only exactly-once gate makes duplicate events /
      // retries a no-op against the same key.
      const record = await this.invoiceService.issueInvoice(command);
      await this.refreshMasterStockAfterDocument(record.id, payload);
      return { outcome: 'ok' };
    } catch (error) {
      // #2047: the order is already invoiced on ANOTHER connection. A retry can
      // never change that (the guard is a persisted-state read, not a transport
      // fault), and the correct outcome is "nothing to do" — one sale already has
      // one invoice. Terminal `business_failure` (ADR-007) so the runner does not
      // burn the retry budget re-asserting a permanent condition. The log names
      // ids + a neutral status only, never payload/buyer.
      if (error instanceof OrderAlreadyInvoicedException) {
        this.logger.warn(
          `invoicing.issue skipped: orderId=${payload.orderId} is already invoiced on ` +
            `connectionId=${error.issuingConnectionId} (invoice ${error.blockingInvoiceId}, ` +
            `status ${error.blockingStatus}); requested connectionId=${payload.connectionId}`,
        );
        return { outcome: 'business_failure' };
      }
      // #2245 review: ADR-063's tax-rate refusal. Terminal for the same reason
      // the guard above is: it is a decision about persisted data (a line with
      // no rate), not a transport fault, so it throws identically on every
      // attempt. Left in the retryable catch-all it burned the whole
      // `maxAttempts` budget with backoff and then landed as a `dead` sync job,
      // which reads as an infrastructure incident rather than the catalogue gap
      // it is - and the order already carries the operator-facing
      // `missing-tax-rate` reason from the gate. Follows the
      // OrderAlreadyInvoicedException precedent exactly (ADR-007).
      if (error instanceof MissingTaxRateException) {
        this.logger.warn(
          // Counts only. `describeMissingTaxRate` can name the first rate-less
          // line, and on the write path that reference is the shop-authored line
          // LABEL - free text this handler's PII rule forbids logging.
          `invoicing.issue refused: orderId=${payload.orderId} has ` +
            `${String(error.finding.lineCount)} of ${String(error.finding.totalLines)} ` +
            `line(s) with no tax rate; connectionId=${payload.connectionId}. Add the rate ` +
            `in the shop's catalogue and re-sync the product.`,
        );
        return { outcome: 'business_failure' };
      }
      // ANY OTHER issueInvoice failure (transport/bridge-unreachable AND any provider
      // error that escapes the SVC) is wrapped as retryable here — the deep
      // pre-validation above has already rejected statically-malformed payloads
      // as business_failure, and the SVC's `issued`-only exactly-once gate makes
      // every retry a no-op against the same key, so re-crossing the provider
      // boundary cannot double-issue. PII discipline: the message carries ONLY
      // error.name + orderId + connectionId — never payload/buyer.
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      throw new SyncJobExecutionError(
        `invoicing.issue failed: error=${errorName} orderId=${payload.orderId} connectionId=${payload.connectionId}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * DEEP payload validation (F5). Returns the typed payload on success; returns
   * `null` to signal a `business_failure` outcome on ANY violation:
   *  - `schemaVersion === 1`;
   *  - `connectionId` / `orderId` / `idempotencyKey` / `currency` non-empty strings;
   *  - `lines` an array of `1..MAX_INVOICE_LINES` items, each with `quantity` a
   *    finite number `> 0` and `unitPriceGross` a finite number `>= 0`;
   *  - `buyer.type ∈ BuyerTypeValues`; `buyer.name` non-empty; `buyer.address`
   *    present with required string fields; `buyer.taxId` `null` OR
   *    `{ value }` with `value` non-empty and `scheme` OPTIONAL (#3224 - core
   *    hands the number over untagged); `buyer.email` (#1797) absent
   *    (pre-existing payload), `null`, OR a `string` — never any other type.
   *
   * PII: on violation logs ONLY the failed field name(s) + `orderId` /
   * `connectionId` / `schemaVersion` — NEVER `payload` / `buyer` / `lines`.
   */
  /**
   * Ask for a master stock re-read now that the document — and with it, on a
   * document-moves-stock master, the warehouse release — has committed.
   *
   * Keyed on the INVOICE RECORD, which makes it a genuinely distinct event
   * from the order-scoped refresh and therefore fires exactly once more. A
   * retried `invoicing.issue` resolves to the same record through the
   * exactly-once gate, hence the same key, hence no re-enqueue; a correction
   * is a new record and legitimately earns one more. The upper bound is the
   * number of documents issued against the order.
   *
   * NEVER throws and never changes the job outcome: the document is already
   * committed fiscal state, and a queue hiccup must not turn a successful
   * issuance into a retry that would re-enter the issuance path.
   */
  private async refreshMasterStockAfterDocument(
    invoiceRecordId: string,
    payload: InvoicingIssuePayloadV1,
  ): Promise<void> {
    try {
      await this.postSaleInventoryRefresh.enqueue({
        // Shipping and manual lines carry no product and are simply absent.
        productIds: payload.lines
          .map((line) => line.productId)
          .filter((id): id is string => typeof id === 'string' && id !== ''),
        keyScope: `invoice:${invoiceRecordId}`,
      });
    } catch (error) {
      this.logger.warn(
        `post-document master inventory refresh could not be enqueued for orderId=${payload.orderId} ` +
          `(invoice ${invoiceRecordId}): ${error instanceof Error ? error.name : 'unknown error'}. ` +
          `The scheduled inventory sweep remains the backstop.`,
      );
    }
  }

  private validatePayload(job: SyncJob): InvoicingIssuePayloadV1 | null {
    const p = job.payload as unknown as Partial<InvoicingIssuePayloadV1>;

    const fail = (field: string): null => {
      // PII: name ONLY the failed field + ids — never payload/buyer/lines.
      this.logger.warn(
        `invoicing.issue payload rejected: field=${field} orderId=${typeof p?.orderId === 'string' ? p.orderId : 'n/a'} connectionId=${job.connectionId} schemaVersion=${String(p?.schemaVersion)}`,
      );
      return null;
    };

    if (!p || typeof p !== 'object') return fail('payload');
    if (p.schemaVersion !== 1) return fail('schemaVersion');
    if (!isNonEmptyString(p.connectionId)) return fail('connectionId');
    if (!isNonEmptyString(p.orderId)) return fail('orderId');
    if (!isNonEmptyString(p.idempotencyKey)) return fail('idempotencyKey');
    if (!isNonEmptyString(p.currency)) return fail('currency');
    // Optional additive field (#1525): validated only when present.
    if (p.saleDate !== undefined && !isNonEmptyString(p.saleDate)) return fail('saleDate');
    // Optional additive field (#1694): validated only when present.
    if (p.source !== undefined && !isNonEmptyString(p.source)) return fail('source');

    if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > MAX_INVOICE_LINES) {
      return fail('lines');
    }
    for (const line of p.lines) {
      if (!line || typeof line !== 'object') return fail('lines.item');
      if (!isFiniteNumber(line.quantity) || line.quantity <= 0) return fail('lines.quantity');
      if (!isFiniteNumber(line.unitPriceGross) || line.unitPriceGross < 0) {
        return fail('lines.unitPriceGross');
      }
    }

    const buyer = p.buyer;
    if (!buyer || typeof buyer !== 'object') return fail('buyer');
    if (!(BuyerTypeValues as readonly string[]).includes(buyer.type)) return fail('buyer.type');
    if (!isNonEmptyString(buyer.name)) return fail('buyer.name');

    const address = buyer.address;
    if (!address || typeof address !== 'object') return fail('buyer.address');
    if (!isNonEmptyString(address.line1)) return fail('buyer.address.line1');
    if (!isNonEmptyString(address.city)) return fail('buyer.address.city');
    if (!isNonEmptyString(address.postalCode)) return fail('buyer.address.postalCode');
    if (!isNonEmptyString(address.countryIso2)) return fail('buyer.address.countryIso2');

    if (buyer.taxId !== null) {
      if (!buyer.taxId || typeof buyer.taxId !== 'object') return fail('buyer.taxId');
      // `scheme` is OPTIONAL (#3224, ADR-073 decision 1): the order stores a
      // bare tax number and core hands it over UNTAGGED, because minting a tag
      // would make `libs/core` name a country's identifier system - "an adapter
      // needing a tag supplies it". Requiring it here rejected every
      // auto-issued B2B invoice as a terminal `business_failure`, i.e. NO
      // document at all rather than the untagged one the epic exists to send -
      // strictly worse than the defective invoice #3224 replaced.
      //
      // Present-but-wrong-shaped is still refused, the same way `buyer.email`
      // (#1797) distinguishes absent from malformed.
      if (buyer.taxId.scheme !== undefined && !isNonEmptyString(buyer.taxId.scheme)) {
        return fail('buyer.taxId.scheme');
      }
      if (!isNonEmptyString(buyer.taxId.value)) return fail('buyer.taxId.value');
    }
    // Optional additive field (#1797): a payload persisted before this field
    // existed has `buyer.email === undefined` — that's valid. Only reject a
    // present-but-wrong-shaped value.
    if (
      buyer.email !== undefined &&
      buyer.email !== null &&
      typeof buyer.email !== 'string'
    ) {
      return fail('buyer.email');
    }

    return p as InvoicingIssuePayloadV1;
  }

  /**
   * Reconstruct the `IssueInvoiceCommand` from the validated PLAIN payload,
   * rebuilding `new BuyerProfile(...)` (#12) and carrying `payload.idempotencyKey`
   * as the command idempotency key (F4).
   */
  private toCommand(payload: InvoicingIssuePayloadV1): IssueInvoiceCommand {
    // #12: rebuild the BuyerProfile class from the PLAIN payload buyer.
    // #1797: `buyer.email` is `undefined` on a payload persisted before this
    // field existed — normalize to `null` rather than requiring the key.
    const buyer = new BuyerProfile(
      payload.buyer.name,
      payload.buyer.taxId,
      payload.buyer.address,
      payload.buyer.type,
      payload.buyer.email ?? null,
    );

    const command: IssueInvoiceCommand = {
      connectionId: payload.connectionId,
      orderId: payload.orderId,
      buyer,
      currency: payload.currency,
      lines: payload.lines,
      // F4: carry the SAME idempotency key as the job row.
      idempotencyKey: payload.idempotencyKey,
    };

    if (payload.documentType !== undefined) {
      command.documentType = payload.documentType;
    }
    // #1525: restore the sale date so the auto-issue path emits it (P_6 on KSeF).
    if (payload.saleDate !== undefined) {
      command.saleDate = payload.saleDate;
    }
    // #1694: thread the order-origin onto the command's `source` numbering axis.
    if (payload.source !== undefined) {
      command.source = payload.source;
    }
    // #2245 review: the era marker exempts pre-rollout history from the
    // write-path tax-rate guard. Coerced through the union's guard rather than
    // cast - an unrecognised value from an older/newer release must read as "no
    // era" (i.e. the guard applies) instead of silently exempting the order.
    if (isTaxRateEra(payload.taxRateEra)) {
      command.taxRateEra = payload.taxRateEra;
    }
    // #3188: the three-state buyer tax identity frozen onto the issued record.
    // Carried verbatim - `''` is the asserted-none state and must not be
    // normalised away by a truthiness test, which is why this checks the TYPE
    // rather than using `isNonEmptyString` like the fields above.
    if (typeof payload.buyerTaxIdAssertion === 'string') {
      command.buyerTaxIdAssertion = payload.buyerTaxIdAssertion;
    }

    return command;
  }
}

/** True for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True for a finite (non-NaN, non-Infinity) number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
