/**
 * Auto-Issue Trigger Service (ADR-026 §3 — core policy composer, OL #1120)
 *
 * Core-resident policy that turns a qualifying order transition (paid / shipped)
 * into AT MOST ONE issuance job. It:
 *  1. Lists ACTIVE invoicing connections (D8) via `ConnectionPort`.
 *  2. Resolves EXACTLY ONE of them (#2047) via `selectPrimaryInvoicingConnection`
 *     over `config.invoicing.isPrimary` (`parseIsPrimaryInvoicing`). One sale is
 *     one invoice: before #2047 this method fanned out over EVERY connection with
 *     the `Invoicing` capability and its per-connection idempotency key
 *     (`invoice:{connId}:{orderId}`) could not dedup across them, so an operator
 *     running two providers got two real fiscal documents for one sale. With
 *     several candidates and no unambiguous primary it now issues NOTHING and
 *     logs an error — a missing invoice is fixable, a duplicate needs a
 *     correction of a document that should never have existed.
 *  3. Reads the selected connection's `config.invoicing.triggerModel`
 *     (`parseTriggerModel`).
 *  4. Evaluates the transition (level-evaluated, D3): `auto-on-paid` iff paid;
 *     `auto-on-shipped` iff `order.status === 'shipped'` (D6 + one-time viability
 *     log, F7); `manual` → skip; `batched` → log + skip (deferred, F-cleanly).
 *  5. Composes the `IssueInvoiceCommand` from the clean in-hand `Order` and
 *     enqueues the `invoicing.issue` job with a deterministic key
 *     `invoice:{connId}:{orderId}` composed ONCE and threaded into BOTH the
 *     `ScheduleJobInput.idempotencyKey` AND `payload.idempotencyKey` (F4).
 *
 * Every non-issuing exit (ambiguous selection, `manual`, `batched`) is currently
 * LOG-ONLY. ADR-041 §54/§105 require it to also persist a named, operator-visible
 * reason — deferred to **#2100**, whose comment at the `ambiguous` branch explains
 * why the log alone is insufficient.
 *
 * The selected connection's work is isolated in a try/catch; the catch logs a
 * PII-SAFE envelope only (F9 + D11): `error.name`, invoicing `connectionId`, `order.id`,
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
import type { Connection } from '@openlinker/core/identifier-mapping';
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
import {
  parseIsPrimaryInvoicing,
  selectPrimaryInvoicingConnection,
} from '../../domain/types/invoicing-primary.types';
import { normalizeShippingLineName } from '../../domain/types/shipping-line-label.types';
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

  /**
   * #2047 one-time diagnosis: connection ids already warned about being the
   * chosen primary while carrying a `manual` trigger model on an install that
   * has OTHER invoicing candidates. Selection runs before the trigger model is
   * read, so naming the primary on a `manual` connection turns auto-issue off
   * for the WHOLE install even though a sibling is `auto-on-paid`. That is the
   * operator's call to make, but without this line it is indistinguishable from
   * "the trigger never fired". Warned ONCE per connection, not per order.
   */
  private readonly manualPrimaryWarned = new Set<string>();

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

    // #2047: ONE order, ONE invoice. Resolve exactly one connection instead of
    // fanning out — KSeF / inFakt / Subiekt are alternative routes for the same
    // document, so issuing on each produced two real fiscal documents for one
    // sale (the per-connection idempotency key could never dedup across them).
    const selection = selectPrimaryInvoicingConnection(
      connections.map((candidate) => ({
        id: candidate.id,
        isPrimary: parseIsPrimaryInvoicing(candidate.config.invoicing?.isPrimary),
      })),
    );

    if (selection.kind === 'none') {
      return;
    }
    if (selection.kind === 'ambiguous') {
      // Deliberately silent-by-design at the domain level: issue NOTHING and log
      // an error naming the ambiguity. An uninvoiced order is fixable by hand; two
      // issued documents for one sale need a correction of a document that should
      // never have existed. The order-detail panel surfaces this state to the
      // operator ("Automatic invoicing is off for this order") so the decision is
      // not visible only in a log.
      //
      // DEFERRED — #2100: ADR-041 §54/§105 require a block to also PERSIST a named
      // reason ('ambiguous-connection-no-primary'), never log-only. This exit (and
      // the `manual` / `batched` ones below) is still log-only, so an install where
      // auto-issue silently stopped for EVERY order is normal-looking on the orders
      // and invoices lists — the panel's client-side re-derivation only helps an
      // operator who already opened that one order. #2100 lands decision 11's first
      // slice: the two reason unions in a `sales-documents` concern plus #1689's
      // `source_deleted` surfacing treatment (health bucket + list badge + bulk-action
      // exclusion). No `sync_jobs.outcomeReason` can carry it — these exits enqueue
      // no job, so there is no row.
      this.logger.error(
        `Auto-issue skipped: ${selection.candidateIds.length} active Invoicing connections and ` +
          `no unambiguous primary (reason=${selection.reason}) — issuing nothing rather than ` +
          `issuing more than one document. orderId=${order.id} ` +
          `candidateConnectionIds=${selection.candidateIds.join(',')} ` +
          `sourceEventId=${sourceEventId ?? 'n/a'}. ` +
          `Set config.invoicing.isPrimary on exactly one connection.`,
      );
      return;
    }

    const connection = connections.find((candidate) => candidate.id === selection.connectionId);
    if (connection === undefined) {
      // Unreachable: `selection.connectionId` is always an id this method just
      // read out of `connections`. Logged rather than returned silently because
      // this method's whole contract is "at most one job, and never quietly
      // none" — a silent return here would be indistinguishable from the
      // legitimate `none` / `manual` skips while actually being a defect.
      this.logger.error(
        `Auto-issue skipped: selected connection ${selection.connectionId} vanished from the ` +
          `candidate list it was chosen from. orderId=${order.id} sourceEventId=${sourceEventId ?? 'n/a'}`,
      );
      return;
    }

    // F9/D11: the selected connection's work is isolated — a compose/enqueue
    // failure never escapes onOrderTransition (the OrderIngestionService catch
    // swallows too, but defense in depth here keeps an invoicing fault from
    // surfacing as an order-ingestion failure).
    try {
      const triggerModel = parseTriggerModel(connection.config.invoicing?.triggerModel);
      this.warnOnceIfManualPrimaryDisablesInstall(triggerModel, connection.id, connections.length);

      if (!this.qualifies(order, triggerModel, connection.id)) {
        return;
      }

      // F4: compose the deterministic key ONCE and thread it into BOTH the
      // job-row idempotencyKey AND payload.idempotencyKey.
      const idempotencyKey = `invoice:${connection.id}:${order.id}`;
      // #1694: resolve the source connection's neutral platformType for the
      // per-source numbering axis. Best-effort — a lookup failure leaves it
      // absent (routing falls back past the source axis), never aborting issuance.
      const sourcePlatformType = await this.resolveSourcePlatformType(sourceConnectionId);
      const payload = this.composePayload(
        order,
        connection.id,
        idempotencyKey,
        triggerModel,
        sourceConnectionId,
        sourceEventId,
        this.readShippingLineName(connection),
        sourcePlatformType,
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

  /**
   * #2047 one-time viability warning, the `manual` counterpart of F7's
   * `auto-on-shipped` one. Selection (which connection) happens BEFORE the
   * trigger model (whether it auto-issues) is read, so a primary set on a
   * `manual` connection silently turns auto-issue off for the entire install —
   * a sibling `auto-on-paid` connection never gets a look. Warn ONCE per
   * connection so the deliberate choice and the misconfiguration are
   * distinguishable without flooding the log on every qualifying order.
   * PII-clean: connection id + candidate count only.
   */
  private warnOnceIfManualPrimaryDisablesInstall(
    triggerModel: InvoiceTriggerModel,
    connectionId: string,
    candidateCount: number,
  ): void {
    if (triggerModel !== 'manual' || candidateCount < 2) {
      return;
    }
    if (this.manualPrimaryWarned.has(connectionId)) {
      return;
    }
    this.manualPrimaryWarned.add(connectionId);
    this.logger.warn(
      `Primary invoicing connection ${connectionId} has triggerModel=manual, so NO connection ` +
        `auto-issues on this install (${candidateCount} candidates). One sale is one invoice, so ` +
        `the primary is resolved before the trigger model is read — a sibling connection set to ` +
        `auto-on-paid is deliberately not consulted. Set the primary on the connection that should ` +
        `auto-issue, or leave this one primary if manual issuing is intended.`,
    );
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
    shippingLineName?: string,
    sourcePlatformType?: string,
  ): InvoicingIssuePayloadV1 {
    // The mapper owns the neutral Order->command rules and may surface
    // InvalidBuyerProfileError / UnsupportedPriceTreatmentError (both PII-clean).
    // #1562: thread the operator's per-connection shipping-line label into the
    // mapper's gross shipping line. Country-agnostic (ADR-026) - core forwards
    // an opaque operator string, never a language it chose. The worker replays
    // `payload.lines` verbatim, so the label MUST be baked here, where the
    // Connection is in hand; a blank/absent value defers to the mapper's neutral
    // `SHIPPING_LINE_NAME` default.
    const command = toIssueInvoiceCommand({
      order,
      connectionId: invoicingConnectionId,
      idempotencyKey,
      shippingLineName,
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
        email: command.buyer.email,
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
    // #1694: carry the resolved order-origin platformType so the worker can
    // thread it onto the command's `source` numbering axis.
    if (sourcePlatformType !== undefined && sourcePlatformType.trim().length > 0) {
      payload.source = sourcePlatformType;
    }

    return payload;
  }

  /**
   * Read the connection's optional operator-supplied shipping-line label
   * (#1562), narrowed via the shared {@link normalizeShippingLineName} coercion
   * so this reader and the HTTP controller's cannot drift.
   */
  private readShippingLineName(connection: Connection): string | undefined {
    return normalizeShippingLineName(connection.config.invoicing?.shippingLineName);
  }

  /**
   * Resolve the source connection's neutral `platformType` for the per-source
   * numbering axis (#1694). Best-effort: any lookup failure returns `undefined`
   * (the source axis is simply not applied) rather than breaking issuance — the
   * downstream numbering resolution degrades gracefully past a missing source.
   */
  private async resolveSourcePlatformType(
    sourceConnectionId: string,
  ): Promise<string | undefined> {
    try {
      const connection = await this.connectionPort.get(sourceConnectionId);
      const platformType = connection.platformType.trim();
      return platformType.length > 0 ? platformType : undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Source platformType lookup failed for connection ${sourceConnectionId}; ` +
          `per-source numbering axis not applied: ${message}`,
      );
      return undefined;
    }
  }
}
