/**
 * Invoicing Issue Handler (OL #1120)
 *
 * Handles `invoicing.issue` sync jobs — a PURE delegate to `IInvoiceService`.
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
  IInvoiceService,
  INVOICE_SERVICE_TOKEN,
  BuyerProfile,
  BuyerTypeValues,
} from '@openlinker/core/invoicing';
import type { IssueInvoiceCommand } from '@openlinker/core/invoicing';
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
      await this.invoiceService.issueInvoice(command);
      return { outcome: 'ok' };
    } catch (error) {
      // Transport / bridge-unreachable → retryable. PII discipline: the message
      // carries ONLY error.name + orderId + connectionId — never payload/buyer.
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
   *    `{ scheme, value }` with both non-empty.
   *
   * PII: on violation logs ONLY the failed field name(s) + `orderId` /
   * `connectionId` / `schemaVersion` — NEVER `payload` / `buyer` / `lines`.
   */
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
      if (!isNonEmptyString(buyer.taxId.scheme)) return fail('buyer.taxId.scheme');
      if (!isNonEmptyString(buyer.taxId.value)) return fail('buyer.taxId.value');
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
    const buyer = new BuyerProfile(
      payload.buyer.name,
      payload.buyer.taxId,
      payload.buyer.address,
      payload.buyer.type,
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
