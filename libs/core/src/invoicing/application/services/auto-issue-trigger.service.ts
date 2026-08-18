/**
 * Auto-Issue Trigger Service — cross-capability sales-document gate
 * (ADR-026 §3 — core policy composer, OL #1120; ADR-041 decisions 3a/3b/4/7 —
 * cross-capability gate, #2156)
 *
 * Core-resident policy that turns a qualifying order transition (paid /
 * shipped) into AT MOST ONE sales-document issuance job — invoice **or**
 * fiscal receipt, never both (ADR-041 decision 3a). It:
 *  1. Lists ACTIVE connections (D8) via `ConnectionPort` that have EITHER the
 *     `Invoicing` OR the `Fiscalization` capability enabled (#2156 — before
 *     this, only `Invoicing` was listed, which structurally could never
 *     produce a fiscal-receipt candidate).
 *  2. Reduces each to a `SalesDocumentRoutingCandidate` via
 *     `readSalesDocumentRouting(connection.config)` (which `documentKind` this
 *     connection issues, and whether it is the operator-set primary) and
 *     resolves EXACTLY ONE `(documentKind, connectionId)` pair via the
 *     `sales-documents` context's pure `resolveSalesDocumentRouting` (#2155) —
 *     replacing the invoice-only `selectPrimaryInvoicingConnection` call this
 *     service used to make directly (that selection logic is now INSIDE the
 *     resolver; this service only calls it).
 *  3. Validates the resolved connection actually supports the resolved
 *     `documentKind` before dispatch (decision 7): for `'invoice'`, by asking
 *     the resolved `InvoicingPort` adapter's `getSupportedDocumentTypes()` —
 *     the resolver's own structural check (capability enabled) already ran,
 *     this is the DEEPER, adapter-level check. `'fiscal-receipt'` has no
 *     adapter-level discovery method yet (`FiscalizationPort` carries no
 *     `getSupportedDocumentTypes()` equivalent), so the structural check is
 *     the whole story for that kind today — documented, not silently skipped.
 *  4. Reads the winning connection's `config.invoicing.triggerModel`
 *     (`parseTriggerModel`) — reused verbatim for BOTH document kinds. The key
 *     predates the two-kind split and is historically named after invoicing
 *     only; ADR-041 decision 4 fixes the shape of `isPrimary` /
 *     `salesDocument.documentKind` but says nothing about renaming
 *     `triggerModel`, so this service treats it as "this connection's
 *     document-issuance trigger model" regardless of which kind it issues.
 *     Introducing a kind-scoped trigger-model key is a separate, out-of-scope
 *     config-shape decision.
 *  5. Evaluates the transition against that trigger model (level-evaluated,
 *     D3): `auto-on-paid` iff paid; `auto-on-shipped` iff
 *     `order.status === 'shipped'` (D6 + one-time viability log, F7);
 *     `manual` → skip; `batched` → log + skip (deferred, F-cleanly).
 *  6. Composes the job payload from the clean in-hand `Order` and enqueues
 *     the matching job type with a deterministic key: `invoicing.issue` /
 *     `invoice:{connId}:{orderId}` for `'invoice'` (unchanged from before
 *     #2156), `fiscalization.register` / `fiscal:{connId}:{orderId}` for
 *     `'fiscal-receipt'` (#2156 — the SAME key format the fiscalization HTTP
 *     controller already uses for the identical semantic: one connection
 *     registering one order is one sale).
 *
 * Every non-issuing exit (unresolved routing, unsupported document kind,
 * `manual`, `batched`) is currently LOG-ONLY. ADR-041 §54/§105 require it to
 * also persist a named, operator-visible reason via the `order_records`
 * sales-document-block mechanism — deferred to **#2100**. IMPORTANT: that
 * mechanism does not exist on this branch (it shipped independently on `main`,
 * commit c9231c9ba, which this epic branch has not merged) — see the PR/issue
 * description for this deviation. Every log line below already names the
 * exact `SalesDocumentUnresolvedReason` / kind values #2100's persistence
 * would need, so wiring it in is additive once the mechanism lands here.
 *
 * The selected connection's work is isolated in a try/catch; the catch logs a
 * PII-SAFE envelope only (F9 + D11): `error.name`, connectionId, `order.id`,
 * `sourceEventId` (when present) — never the raw error / message / payload.
 * `error.message` is added ONLY for the allow-listed deterministic, PII-clean
 * errors (`InvalidBuyerProfileError`, `UnsupportedPriceTreatmentError`,
 * `InvalidFiscalLineError`, `UnsupportedFiscalPriceTreatmentError`,
 * `BatchedTriggerNotImplementedError`).
 *
 * ONE-WAY EDGE (F3): still injects NO `OrdersModule` token. #2156 adds
 * `INTEGRATIONS_SERVICE_TOKEN` (for the `getSupportedDocumentTypes()` check) —
 * an `integrations`-context dependency, unrelated to the ONE-WAY EDGE
 * property this docstring guards, which is specifically about `orders`.
 * `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts`
 * continues to assert no `OrdersModule` token is injected.
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
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  readSalesDocumentRouting,
  resolveSalesDocumentRouting,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentDecision,
  SalesDocumentRoutingCandidate,
  SalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';
import { toRegisterTransactionCommand } from '@openlinker/core/fiscalization';
import { Logger } from '@openlinker/shared/logging';

import type { IAutoIssueTriggerService } from './auto-issue-trigger.service.interface';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type { InvoiceTriggerModel } from '../../domain/types/invoice-trigger.types';
import { parseTriggerModel } from '../../domain/types/invoice-trigger.types';
import { normalizeShippingLineName } from '../../domain/types/shipping-line-label.types';
import { toIssueInvoiceCommand } from '../mappers/order-to-issue-invoice-command.mapper';
import { BatchedTriggerNotImplementedError } from '../../domain/exceptions/batched-trigger-not-implemented.error';
import type {
  InvoicingIssuePayloadV1,
  FiscalizationRegisterPayloadV1,
} from '@openlinker/core/sync';

/**
 * Retry budget for issuance jobs (F1/F8/D9). Mirrors `RUNNER_RETRY_BUDGET = 3`:
 * the smallest budget that honors the retry AC (>=2 so a bridge-unreachable
 * blip genuinely retries) while keeping the D7 double-issue window deliberately
 * small (each transport-in-doubt retry re-crosses the provider boundary against
 * the `issued`-only gate).
 */
export const AUTO_ISSUE_RETRY_BUDGET = 3;

/** Capability names a connection must enable to be a routing candidate at all. */
const INVOICING_CAPABILITY = 'Invoicing';
const FISCALIZATION_CAPABILITY = 'Fiscalization';

/**
 * Error names whose `message` is deterministic and PII-clean (each cites only
 * `order.id` / `connectionId`), so they MAY be added to the per-connection log
 * envelope. Any other error logs `error.name` only (F9/D11).
 */
const PII_SAFE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'InvalidBuyerProfileError',
  'InvalidInvoiceLineError',
  'UnsupportedPriceTreatmentError',
  'InvalidFiscalLineError',
  'UnsupportedFiscalPriceTreatmentError',
  'BatchedTriggerNotImplementedError',
]);

@Injectable()
export class AutoIssueTriggerService implements IAutoIssueTriggerService {
  private readonly logger = new Logger(AutoIssueTriggerService.name);

  /**
   * F7/D6 one-time viability log: connection ids for which an `auto-on-shipped`
   * trigger model has already been evaluated against a non-`shipped` order and
   * warned. `auto-on-shipped` is only honored where the source surfaces
   * `'shipped'` inbound; a connection configured for it on a source that never
   * emits `'shipped'` would otherwise silently never issue. We warn ONCE per
   * connection (not per order) so the misconfiguration is operator-visible
   * without flooding the log on every poll.
   */
  private readonly shippedViabilityWarned = new Set<string>();

  /**
   * One-time diagnosis: connection ids already warned about being the chosen
   * winner while carrying a `manual` trigger model on an install that has
   * OTHER sales-document candidates. Routing resolves the winning connection
   * BEFORE its trigger model is read, so a `manual` winner silently turns
   * auto-issue off for the WHOLE install even though a sibling candidate is
   * `auto-on-paid`. That is the operator's call to make, but without this line
   * it is indistinguishable from "the trigger never fired". Warned ONCE per
   * connection, not per order.
   */
  private readonly manualWinnerWarned = new Set<string>();

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobs: ISyncJobsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async onOrderTransition(
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<void> {
    // D8: only ACTIVE connections receive issuance jobs. The scheduler's
    // `status: 'active'` filter already excludes disabled/error/needs_reauth
    // connections. #2156: a candidate needs EITHER capability, not just
    // Invoicing — a connection with only `Fiscalization` enabled must be
    // discoverable too, or a fiscal-receipt candidate could never exist.
    const connections = (
      await this.connectionPort.list({ status: 'active' })
    ).filter(
      (connection) =>
        connection.enabledCapabilities.includes(INVOICING_CAPABILITY) ||
        connection.enabledCapabilities.includes(FISCALIZATION_CAPABILITY),
    );

    if (connections.length === 0) {
      return;
    }

    const candidates: SalesDocumentRoutingCandidate[] = connections.map((connection) => {
      const routing = readSalesDocumentRouting(connection.config);
      return {
        connectionId: connection.id,
        documentKind: routing.documentKind,
        isPrimary: routing.isPrimary,
        enabledCapabilities: connection.enabledCapabilities,
      };
    });

    const eligibleCount = candidates.filter((candidate) => candidate.documentKind !== null).length;
    if (eligibleCount === 0) {
      // resolveSalesDocumentRouting's own doc: a caller that already knows it
      // has zero ELIGIBLE candidates (none carries a configured
      // `documentKind`) is expected to short-circuit before calling the
      // resolver — its zero-candidate branch is a defensive fallback, not the
      // common path. Without this, a perfectly ordinary "not configured yet"
      // install (capability enabled, but no `config.salesDocument.documentKind`
      // set) would error-log 'ambiguous-connection-no-primary' on every order,
      // which is a materially different and less actionable signal than "no
      // candidate at all". Mirrors the pre-#2156 `selection.kind === 'none'`
      // short-circuit.
      return;
    }

    const decision = resolveSalesDocumentRouting(order, candidates);

    switch (decision.kind) {
      case 'unresolved':
        this.logUnresolved(decision.reason, candidates, order, sourceEventId);
        return;
      case 'aggregate':
        // Reserved outcome (ADR-041 decision 8) — the aggregation window's
        // mechanics are explicitly deferred, and no caller of
        // resolveSalesDocumentRouting can produce this decision today.
        // Defensive-only: if this ever fires it is a forward-compat gap, not
        // a normal outcome, so issue nothing rather than guess.
        this.logger.error(
          `Auto-issue skipped: 'aggregate' routing outcome is not implemented; issuing nothing. ` +
            `orderId=${order.id} connectionId=${decision.connectionId} ` +
            `sourceEventId=${sourceEventId ?? 'n/a'}`,
        );
        return;
      case 'route':
        await this.dispatchRoute(decision, connections, eligibleCount, order, sourceConnectionId, sourceEventId);
        return;
    }
  }

  /**
   * DEFERRED — #2100: ADR-041 §54/§105 require an `unresolved` routing outcome
   * to also PERSIST a named reason (`'unresolved-routing'` + the
   * `SalesDocumentUnresolvedReason` that travelled with it), never log-only.
   * This exit is still log-only — see the file-level docstring for why the
   * persistence mechanism is out of reach on this branch today.
   */
  private logUnresolved(
    reason: SalesDocumentUnresolvedReason,
    candidates: readonly SalesDocumentRoutingCandidate[],
    order: Order,
    sourceEventId?: string,
  ): void {
    const candidateIds = candidates
      .filter((candidate) => candidate.documentKind !== null)
      .map((candidate) => candidate.connectionId);

    this.logger.error(
      `Auto-issue skipped: sales-document routing unresolved (reason=${reason}) — issuing nothing ` +
        `rather than issuing on an ambiguous or unsupported pick. orderId=${order.id} ` +
        `candidateConnectionIds=${candidateIds.join(',')} sourceEventId=${sourceEventId ?? 'n/a'}. ` +
        `Set config.salesDocument.documentKind and config.invoicing.isPrimary appropriately.`,
    );
  }

  /**
   * Dispatch a resolved `route` decision: validate the resolved connection
   * still exists in the candidate list, then branch on `documentKind`.
   */
  private async dispatchRoute(
    decision: Extract<SalesDocumentDecision, { kind: 'route' }>,
    connections: readonly Connection[],
    eligibleCount: number,
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<void> {
    if (decision.documentKind === null) {
      // Self-routing destination (ADR-041 decision 9): reserved in the type,
      // but resolveSalesDocumentRouting's own candidate filter requires a
      // configured `documentKind`, so a `route` decision can never carry
      // `null` while no adapter declares self-routing. Defensive-only.
      this.logger.error(
        `Auto-issue skipped: resolved a self-routing decision (documentKind: null), but no ` +
          `self-routing dispatch is implemented; issuing nothing. orderId=${order.id} ` +
          `connectionId=${decision.connectionId} sourceEventId=${sourceEventId ?? 'n/a'}`,
      );
      return;
    }

    const connection = connections.find((candidate) => candidate.id === decision.connectionId);
    if (connection === undefined) {
      // Unreachable: `decision.connectionId` is always an id this method just
      // read out of `connections`. Logged rather than returned silently
      // because this method's whole contract is "at most one job, and never
      // quietly none" — a silent return here would be indistinguishable from
      // a legitimate skip while actually being a defect.
      this.logger.error(
        `Auto-issue skipped: selected connection ${decision.connectionId} vanished from the ` +
          `candidate list it was chosen from. orderId=${order.id} sourceEventId=${sourceEventId ?? 'n/a'}`,
      );
      return;
    }

    if (decision.documentKind === 'invoice') {
      await this.dispatchInvoice(connection, eligibleCount, order, sourceConnectionId, sourceEventId);
      return;
    }
    if (decision.documentKind === 'fiscal-receipt') {
      await this.dispatchFiscalReceipt(connection, eligibleCount, order, sourceConnectionId, sourceEventId);
      return;
    }

    // Open-world kind (decision 10): core recognizes no dispatch for it. The
    // resolver's structural capability check already passed (an unrecognized
    // kind has no REQUIRED_CAPABILITY entry, so it is never blocked there) —
    // the DEEPER "can this connection actually produce a document of this
    // kind" check is this gate's job, and for an unrecognized kind the honest
    // answer is "not yet" rather than a guess.
    //
    // DEFERRED — #2100: should also persist
    // `'unsupported-document-kind-on-connection'`, not just log.
    this.logger.error(
      `Auto-issue skipped: connection ${connection.id} resolved to sales-document kind ` +
        `'${decision.documentKind}', which this gate does not know how to dispatch. ` +
        `orderId=${order.id} sourceEventId=${sourceEventId ?? 'n/a'}`,
    );
  }

  /**
   * Dispatch the `'invoice'` kind (unchanged job type / idempotency key from
   * before #2156). Adds the decision-7 deeper capability check: the resolved
   * connection's `InvoicingPort` adapter must actually list `'invoice'` among
   * its `getSupportedDocumentTypes()`.
   */
  private async dispatchInvoice(
    connection: Connection,
    eligibleCount: number,
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<void> {
    const supported = await this.connectionSupportsInvoiceDocumentType(connection.id);
    if (!supported) {
      // DEFERRED — #2100: should also persist
      // `'unsupported-document-kind-on-connection'`, not just log.
      this.logger.error(
        `Auto-issue skipped: connection ${connection.id} is routed for 'invoice' but its adapter ` +
          `does not list 'invoice' among its supported document types. orderId=${order.id} ` +
          `sourceEventId=${sourceEventId ?? 'n/a'}`,
      );
      return;
    }

    // F9/D11: the selected connection's work is isolated — a compose/enqueue
    // failure never escapes onOrderTransition (the OrderIngestionService catch
    // swallows too, but defense in depth here keeps an invoicing fault from
    // surfacing as an order-ingestion failure).
    try {
      const triggerModel = parseTriggerModel(connection.config.invoicing?.triggerModel);
      this.warnOnceIfManualWinnerDisablesInstall(triggerModel, connection.id, eligibleCount);

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
      const payload = this.composeInvoicePayload(
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
   * Dispatch the `'fiscal-receipt'` kind (#2156). No adapter-level "which
   * document kinds can this connection produce" discovery exists yet on
   * `FiscalizationPort` (unlike `InvoicingPort.getSupportedDocumentTypes()`),
   * so the resolver's structural check (`Fiscalization` capability enabled)
   * is the whole validation story for this kind today.
   */
  private async dispatchFiscalReceipt(
    connection: Connection,
    eligibleCount: number,
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<void> {
    try {
      // Reused verbatim from `config.invoicing.triggerModel` — see the
      // file-level docstring point 4 for why this is deliberate, not an
      // oversight.
      const triggerModel = parseTriggerModel(connection.config.invoicing?.triggerModel);
      this.warnOnceIfManualWinnerDisablesInstall(triggerModel, connection.id, eligibleCount);

      if (!this.qualifies(order, triggerModel, connection.id)) {
        return;
      }

      // Same key FORMAT the fiscalization HTTP controller already uses for
      // the identical semantic (one connection registering one order is one
      // sale) — see `apps/api/src/fiscalization/http/fiscalization.controller.ts`.
      const idempotencyKey = `fiscal:${connection.id}:${order.id}`;
      const payload = this.composeFiscalReceiptPayload(
        order,
        connection,
        idempotencyKey,
        sourceConnectionId,
        sourceEventId,
      );

      await this.syncJobs.schedule({
        jobType: 'fiscalization.register',
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
   * Decision-7 deeper check for the `'invoice'` kind: resolve the connection's
   * `InvoicingPort` adapter and ask its value-level
   * `getSupportedDocumentTypes()` whether `'invoice'` is among them. Fails
   * CLOSED (returns `false`) on any adapter-resolution error — a connection
   * this gate cannot even resolve is not one it should dispatch to.
   */
  private async connectionSupportsInvoiceDocumentType(connectionId: string): Promise<boolean> {
    try {
      const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
        connectionId,
        INVOICING_CAPABILITY,
      );
      return adapter.getSupportedDocumentTypes().includes('invoice');
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Could not resolve connection ${connectionId}'s Invoicing adapter to verify 'invoice' ` +
          `support (error=${name}); skipping this issuance rather than risk dispatching to an ` +
          `unresolvable adapter.`,
      );
      return false;
    }
  }

  /**
   * One-time viability warning: the winning connection carries a `manual`
   * trigger model while OTHER sales-document candidates exist. Routing
   * resolves the winning connection BEFORE the trigger model is read, so a
   * winner set to `manual` silently turns auto-issue off for the entire
   * install — a sibling `auto-on-paid` candidate never gets a look. Warn ONCE
   * per connection so the deliberate choice and the misconfiguration are
   * distinguishable without flooding the log on every qualifying order.
   * PII-clean: connection id + candidate count only.
   */
  private warnOnceIfManualWinnerDisablesInstall(
    triggerModel: InvoiceTriggerModel,
    connectionId: string,
    eligibleCount: number,
  ): void {
    if (triggerModel !== 'manual' || eligibleCount < 2) {
      return;
    }
    if (this.manualWinnerWarned.has(connectionId)) {
      return;
    }
    this.manualWinnerWarned.add(connectionId);
    this.logger.warn(
      `Winning sales-document connection ${connectionId} has triggerModel=manual, so NO ` +
        `connection auto-issues on this install (${eligibleCount} candidates). Routing resolves ` +
        `the winner before the trigger model is read — a sibling candidate set to auto-on-paid is ` +
        `deliberately not consulted. Set the primary on the connection that should auto-issue, or ` +
        `leave this one the winner if manual issuing is intended.`,
    );
  }

  /**
   * PII-SAFE per-connection failure log (F9/D11): names ONLY `error.name`,
   * connectionId, `order.id`, and `sourceEventId` (when present).
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
  private composeInvoicePayload(
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
   * Compose the SERIALIZABLE `fiscalization.register` payload (#2156) from the
   * clean `Order`, via the fiscalization context's own
   * `toRegisterTransactionCommand` mapper. May surface `InvalidFiscalLineError`
   * / `UnsupportedFiscalPriceTreatmentError` (both PII-clean, cite only the
   * order id).
   */
  private composeFiscalReceiptPayload(
    order: Order,
    connection: Connection,
    idempotencyKey: string,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): FiscalizationRegisterPayloadV1 {
    const command = toRegisterTransactionCommand({
      order,
      connectionId: connection.id,
      idempotencyKey,
      shippingLineName: this.readShippingLineName(connection),
    });

    const payload: FiscalizationRegisterPayloadV1 = {
      schemaVersion: 1,
      connectionId: command.connectionId,
      orderId: command.orderId,
      idempotencyKey,
      currency: command.currency,
      lines: command.lines,
      totalGross: command.totalGross,
      sourceConnectionId,
    };

    // SERIALIZATION CONTRACT: `occurredAt` is a `Date` on the command; the
    // jsonb payload carries it as ISO-8601 (see the payload type's own doc).
    if (command.occurredAt !== undefined) {
      payload.occurredAt = command.occurredAt.toISOString();
    }
    if (command.recipient !== undefined) {
      payload.recipient = command.recipient;
    }
    if (sourceEventId !== undefined) {
      payload.sourceEventId = sourceEventId;
    }

    return payload;
  }

  /**
   * Read the connection's optional operator-supplied shipping-line label
   * (#1562), narrowed via the shared {@link normalizeShippingLineName} coercion
   * so this reader and the HTTP controller's cannot drift. Reused verbatim for
   * both document kinds — see the file-level docstring point 4.
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
