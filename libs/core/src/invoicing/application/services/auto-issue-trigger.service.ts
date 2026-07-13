/**
 * Auto-Issue Trigger Service (ADR-026 §3 — core policy composer, OL #1120)
 *
 * Core-resident policy that turns a qualifying order transition (paid / shipped)
 * into per-connection issuance jobs. It:
 *  1. Lists ACTIVE invoicing connections (D8) via `ConnectionPort`.
 *  2. Reads each connection's `config.invoicing.triggerModel` (`parseTriggerModel`).
 *  3. Evaluates the transition (level-evaluated, D3): `auto-on-paid` iff paid;
 *     `auto-on-shipped` iff `order.status === 'shipped'` (D6 + one-time viability
 *     log, F7); `manual` → skip; `batched` → log + skip (deferred, F-cleanly).
 *  4. Composes the `IssueInvoiceCommand` from the clean in-hand `Order` and
 *     enqueues one `invoicing.issue` job per match with a deterministic key
 *     `invoice:{connId}:{orderId}` composed ONCE and threaded into BOTH the
 *     `ScheduleJobInput.idempotencyKey` AND `payload.idempotencyKey` (F4).
 *
 * Each connection is isolated in its own try/catch; the catch logs a PII-SAFE
 * envelope only (F9 + D11): `error.name`, invoicing `connectionId`, `order.id`,
 * `sourceEventId` (when present) — never the raw error / message / payload.
 * `error.message` is added ONLY for the allow-listed deterministic, PII-clean
 * errors (`InvalidBuyerProfileError`, `UnsupportedPriceTreatmentError`,
 * `BatchedTriggerNotImplementedError`).
 *
 * ONE-WAY EDGE (F3): depends ONLY on `CONNECTION_PORT_TOKEN` (identifier-mapping)
 * and `SYNC_JOBS_SERVICE_TOKEN` (sync). It injects NO OrdersModule token.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IAutoIssueTriggerService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  ISyncJobsService,
  SYNC_JOBS_SERVICE_TOKEN,
} from '@openlinker/core/sync';
import type { Order } from '@openlinker/core/orders';
// `@openlinker/core/orders/types` sub-barrel: exports dependency-free constants
// without pulling in `OrdersModule`. Using the main barrel would close a CJS
// cycle (OrdersModule imports InvoicingModule which provides this service).
import { PAYMENT_STATUS } from '@openlinker/core/orders/types';
import { Logger } from '@openlinker/shared/logging';

import type { IAutoIssueTriggerService } from './auto-issue-trigger.service.interface';
import type { InvoiceTriggerModel } from '../../domain/types/invoice-trigger.types';
import { parseTriggerModel } from '../../domain/types/invoice-trigger.types';
import { toIssueInvoiceCommand } from '../mappers/order-to-issue-invoice-command.mapper';
import { BatchedTriggerNotImplementedError } from '../../domain/exceptions/batched-trigger-not-implemented.error';
import type { InvoicingIssuePayloadV1 } from '@openlinker/core/sync';

/**
 * Retry budget for issuance jobs (F1/F8/D9). Mirrors `RUNNER_RETRY_BUDGET = 3`:
 * the smallest budget that honors the retry AC (>=2 so a bridge-unreachable
 * blip genuinely retries) while keeping the D7 double-issue window deliberately
 * small (each transport-in-doubt retry re-crosses the provider boundary against
 * the `issued`-only gate).
 */
export const AUTO_ISSUE_RETRY_BUDGET = 3;

/** Capability name a connection must enable to receive issuance jobs. */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Error names whose `message` is deterministic and PII-clean (each cites only
 * `order.id` / `connectionId`), so they MAY be added to the per-connection log
 * envelope. Any other error logs `error.name` only (F9/D11).
 */
const PII_SAFE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'InvalidBuyerProfileError',
  'InvalidInvoiceLineError',
  'UnsupportedPriceTreatmentError',
  'BatchedTriggerNotImplementedError',
]);

@Injectable()
export class AutoIssueTriggerService implements IAutoIssueTriggerService {
  private readonly logger = new Logger(AutoIssueTriggerService.name);

  /**
   * F7/D6 one-time viability log: connection ids for which an `auto-on-shipped`
   * model has already been evaluated against a non-`shipped` order and warned.
   * `auto-on-shipped` is only honored where the source surfaces `'shipped'`
   * inbound; a connection configured for it on a source that never emits
   * `'shipped'` would otherwise silently never issue. We warn ONCE per
   * connection (not per order) so the misconfiguration is operator-visible
   * without flooding the log on every poll.
   */
  private readonly shippedViabilityWarned = new Set<string>();

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobs: ISyncJobsService,
  ) {}

  async onOrderTransition(
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<void> {
    // D8: only ACTIVE invoicing connections receive issuance jobs. The
    // scheduler's `status: 'active'` filter already excludes disabled/error/
    // needs_reauth connections.
    const connections = (
      await this.connectionPort.list({ status: 'active' })
    ).filter((connection) =>
      connection.enabledCapabilities.includes(INVOICING_CAPABILITY),
    );

    for (const connection of connections) {
      // F9/D11: each connection is isolated — a compose/enqueue failure on one
      // never aborts the others, and never escapes onOrderTransition (the
      // OrderIngestionService catch swallows too, but defense in depth here keeps
      // a single bad connection from skipping the rest).
      try {
        const triggerModel = parseTriggerModel(
          connection.config.invoicing?.triggerModel,
        );

        if (!this.qualifies(order, triggerModel, connection.id)) {
          continue;
        }

        // F4: compose the deterministic key ONCE and thread it into BOTH the
        // job-row idempotencyKey AND payload.idempotencyKey.
        const idempotencyKey = `invoice:${connection.id}:${order.id}`;
        const payload = this.composePayload(
          order,
          connection.id,
          idempotencyKey,
          triggerModel,
          sourceConnectionId,
          sourceEventId,
        );

        await this.syncJobs.schedule({
          jobType: 'invoicing.issue',
          connectionId: connection.id,
          payload: payload as unknown as Record<string, unknown>,
          idempotencyKey,
          maxAttempts: AUTO_ISSUE_RETRY_BUDGET,
          runAfter: new Date(),
        });
      } catch (error) {
        this.logIssuanceFailure(error, connection.id, order.id, sourceEventId);
      }
    }
  }

  /**
   * PII-SAFE per-connection failure log (F9/D11): names ONLY `error.name`,
   * invoicing `connectionId`, `order.id`, and `sourceEventId` (when present).
   * `error.message` is appended ONLY for the allow-listed deterministic,
   * PII-clean errors — never the raw error/payload/buyer.
   */
  private logIssuanceFailure(
    error: unknown,
    connectionId: string,
    orderId: string,
    sourceEventId?: string,
  ): void {
    const name = error instanceof Error ? error.name : 'UnknownError';
    const message =
      error instanceof Error && PII_SAFE_ERROR_NAMES.has(error.name)
        ? error.message
        : undefined;

    this.logger.warn(
      `auto-issue trigger skipped connection: error=${name} connectionId=${connectionId} orderId=${orderId} sourceEventId=${sourceEventId ?? 'n/a'}${message ? ` detail=${message}` : ''}`,
    );
  }

  /**
   * Decide whether the trigger model qualifies for THIS transition
   * (level-evaluated, D3): `auto-on-paid` iff paid; `auto-on-shipped` iff
   * `order.status === 'shipped'`; `manual` → false; `batched` → throws
   * `BatchedTriggerNotImplementedError`. For `auto-on-shipped` on a non-shipped
   * order it emits the F7/D6 one-time viability warning (keyed by `connectionId`)
   * so a source that never surfaces `'shipped'` is operator-diagnosable.
   */
  private qualifies(
    order: Order,
    triggerModel: InvoiceTriggerModel,
    connectionId: string,
  ): boolean {
    switch (triggerModel) {
      case 'auto-on-paid':
        // D3 level-evaluated: qualifies iff the order is currently paid.
        return order.paymentStatus === PAYMENT_STATUS.Paid;
      case 'auto-on-shipped':
        // D6: honored only where the source surfaces 'shipped' inbound.
        if (order.status === 'shipped') {
          return true;
        }
        // F7: a non-`shipped` order on an `auto-on-shipped` connection is the
        // signal that the source may never emit `'shipped'`. Warn ONCE per
        // connection (PII-clean: connectionId + observed status only) so the
        // silent no-issue is diagnosable without per-poll log spam.
        if (!this.shippedViabilityWarned.has(connectionId)) {
          this.shippedViabilityWarned.add(connectionId);
          this.logger.warn(
            `auto-on-shipped connection has not yet seen a 'shipped' order: connectionId=${connectionId} observedStatus=${order.status}. ` +
              `If the source never surfaces 'shipped' inbound, this connection will never auto-issue (D6).`,
          );
        }
        return false;
      case 'manual':
        return false;
      case 'batched':
        // Deferred to a future issue — rejected cleanly, never silently ignored.
        throw new BatchedTriggerNotImplementedError(
          `Batched trigger model is not implemented (order ${order.id})`,
        );
    }
  }

  /**
   * Compose the SERIALIZABLE `invoicing.issue` payload (plain buyer shape, no
   * `BuyerProfile` class — #12) from the clean `Order`, threading the SAME
   * `idempotencyKey` into `payload.idempotencyKey` (F4). May surface
   * `InvalidBuyerProfileError` / `UnsupportedPriceTreatmentError` from the mapper.
   */
  private composePayload(
    order: Order,
    invoicingConnectionId: string,
    idempotencyKey: string,
    triggerModel: InvoiceTriggerModel,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): InvoicingIssuePayloadV1 {
    // The mapper owns the neutral Order->command rules and may surface
    // InvalidBuyerProfileError / UnsupportedPriceTreatmentError (both PII-clean).
    const command = toIssueInvoiceCommand({
      order,
      connectionId: invoicingConnectionId,
      idempotencyKey,
    });

    // #12: flatten the BuyerProfile class into the PLAIN, jsonb-safe field-set.
    const payload: InvoicingIssuePayloadV1 = {
      schemaVersion: 1,
      connectionId: invoicingConnectionId,
      orderId: command.orderId,
      idempotencyKey,
      currency: command.currency,
      lines: command.lines,
      buyer: {
        name: command.buyer.name,
        taxId: command.buyer.taxId,
        address: command.buyer.address,
        type: command.buyer.type,
      },
      sourceConnectionId,
      trigger: triggerModel,
    };

    if (command.documentType !== undefined) {
      payload.documentType = command.documentType;
    }
    // #1525: without this the field-by-field flatten silently drops the sale
    // date and the auto-issued document loses its P_6 counterpart.
    if (command.saleDate !== undefined) {
      payload.saleDate = command.saleDate;
    }
    if (sourceEventId !== undefined) {
      payload.sourceEventId = sourceEventId;
    }

    return payload;
  }
}
