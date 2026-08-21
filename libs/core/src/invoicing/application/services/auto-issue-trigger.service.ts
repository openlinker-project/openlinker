/**
 * Auto-Issue Trigger Service — cross-capability sales-document gate
 * (ADR-026 §3 — core policy composer, OL #1120; ADR-041 decisions 3a/3b/4/7 —
 * cross-capability gate, #2156; decision 11's persisted block reason, #2100)
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
 *     connection issues, and whether it is the operator-set primary), then
 *     resolves EXACTLY ONE `(documentKind, connectionId)` pair — since #2173,
 *     via a TWO-STEP precedence rather than a single resolver call:
 *       a. Build a `SalesDocumentOrderFacts` projection from the order
 *          (`toSalesDocumentOrderFacts`, delivery-country + gross total; buyer
 *          tax-id status stays `undefined` — no field for it exists on `Order`
 *          yet, ADR-041 decision 5). When the order carries no delivery
 *          country at all, skip straight to (c).
 *       b. Call the country-agnostic rule engine
 *          (`ISalesDocumentRulesService.resolveRouting`, #2170) with those
 *          facts. Any decision OTHER than `unresolved`/
 *          `'no-configuration-for-country'` is used AS-IS (including a
 *          `route`, an `aggregate`, or a different `unresolved` reason such as
 *          `'threshold-currency-mismatch'` — surfaced via the SAME
 *          `SalesDocumentBlockOutcome` reporting seam below, never silently
 *          dropped).
 *       c. Only when the engine reports `'no-configuration-for-country'` (the
 *          operator never touched the rule-engine UI for this order's
 *          country) — or when no order facts could be built at all — fall
 *          back to the pre-#2170, `operator-configured` single-primary model,
 *          the `sales-documents` context's pure `resolveSalesDocumentRouting`
 *          (#2155). This is what keeps an untouched install's behaviour
 *          byte-identical to before #2170 shipped its authoring surface.
 *     (That selection logic is INSIDE the resolvers; this service only calls
 *     them, and feeds whichever decision won into the SAME dispatch pipeline
 *     below regardless of which resolver produced it.)
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
 *     D3, via `evaluateGate` — separating "not yet" from "not without a
 *     human", #2100): `auto-on-paid` / `auto-on-shipped` `proceed` when their
 *     condition holds and `waiting` otherwise (D6 + one-time viability log,
 *     F7); `manual` is `blocked`; `batched` throws
 *     `BatchedTriggerNotImplementedError`, mapped to a `trigger-model-batched`
 *     block by the PII-safe catch.
 *  6. Composes the job payload from the clean in-hand `Order` and enqueues
 *     the matching job type with a deterministic key: `invoicing.issue` /
 *     `invoice:{connId}:{orderId}` for `'invoice'` (unchanged from before
 *     #2156), `fiscalization.register` / `fiscal:{connId}:{orderId}` for
 *     `'fiscal-receipt'` (#2156 — the SAME key format the fiscalization HTTP
 *     controller already uses for the identical semantic: one connection
 *     registering one order is one sale).
 *
 * Every exit REPORTS a `SalesDocumentBlockOutcome` to the caller (#2100, ADR-041
 * §54/§105: a block is never log-only), alongside — never instead of — its
 * existing log line. Reporting rather than persisting is what keeps the F3
 * one-way edge below intact: the caller already lives in the orders context and
 * owns the write.
 *
 *  - `blocked`       — unresolved routing, unsupported document kind, `manual`,
 *    `batched`. Reported only after `reportBlock` confirms the order does not
 *    already carry a document, because reasons derived from CONFIGURATION stay
 *    true after issuance and would otherwise be re-blocked onto an order the
 *    operator already invoiced/registered by hand.
 *  - `none`          — job enqueued; or the `auto-on-*` condition is simply not
 *    met yet (level-evaluated, D3 — an unpaid order is waiting, not blocked); or
 *    no sales-document candidate exists at all; or a document already exists.
 *  - `indeterminate` — a compose/enqueue error, or the unreachable
 *    vanished-connection / unimplemented-aggregate branches. The caller leaves
 *    the persisted reason ALONE: clearing on a deterministic error would erase a
 *    true reason and put nothing in its place, which is the silent decline §54
 *    forbids.
 *
 * The selected connection's work is isolated in a try/catch; the catch logs a
 * PII-SAFE envelope only (F9 + D11): `error.name`, connectionId, `order.id`,
 * `sourceEventId` (when present) — never the raw error / message / payload.
 * `error.message` is added ONLY for the allow-listed deterministic, PII-clean
 * errors (`InvalidBuyerProfileError`, `UnsupportedPriceTreatmentError`,
 * `InvalidFiscalLineError`, `UnsupportedFiscalPriceTreatmentError`,
 * `BatchedTriggerNotImplementedError`).
 *
 * ONE-WAY EDGE (F3): depends on `CONNECTION_PORT_TOKEN` (identifier-mapping),
 * `SYNC_JOBS_SERVICE_TOKEN` (sync), `INVOICE_SERVICE_TOKEN` (SAME context —
 * InvoicingModule provides both, so no module cycle; used only for the
 * idempotent-block-suppression read in `reportBlock`), since #2156,
 * `INTEGRATIONS_SERVICE_TOKEN` (for the `getSupportedDocumentTypes()` deeper
 * check — an `integrations`-context dependency, likewise unrelated to the F3
 * property, which is specifically about `orders`), and since #2173,
 * `SALES_DOCUMENT_RULES_SERVICE_TOKEN` (`sales-documents` — a dependency-free
 * leaf concern with zero outbound core-context edges of its own, per
 * `docs/architecture-overview.md`), and since review finding 6, a plain
 * `ModuleRef` used to lazily resolve `IFiscalRegistrationService` in
 * `reportBlock` — the SAME lazy-require pattern `InvoiceService` uses, for
 * the SAME reason (a constructor-typed dependency would require
 * `FiscalizationModule`, which imports `InvoicingModule`, not the other way
 * around). It injects NO `OrdersModule` token, which is what the invariant is
 * about and what
 * `invoicing-auto-issue-boot.int-spec.ts` asserts.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IAutoIssueTriggerService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
} from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ISyncJobsService,
  SYNC_JOBS_SERVICE_TOKEN,
} from '@openlinker/core/sync';
import { IInvoiceService } from './invoice.service.interface';
import { INVOICE_SERVICE_TOKEN } from '../../invoicing.tokens';
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
  ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  readSalesDocumentRouting,
  resolveSalesDocumentRouting,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBlock,
  SalesDocumentBlockOutcome,
  SalesDocumentDecision,
  SalesDocumentRoutingCandidate,
  SalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';
import { Logger } from '@openlinker/shared/logging';
// Type-only NAMED import (never a wildcard — see
// docs/architecture-overview.md#cross-context-dependencies-in-core) of just
// the one function used in the lazy require below. Erases at compile time,
// never emits a runtime require(), so it cannot reintroduce the CommonJS
// cycle that require breaks.
import type { toRegisterTransactionCommand as ToRegisterTransactionCommandType } from '@openlinker/core/fiscalization';
// Same lazy-require reason as `toRegisterTransactionCommand` above and as
// `InvoiceService.resolveFiscalRegistrationService` — see either doc comment.
import type {
  FISCAL_REGISTRATION_SERVICE_TOKEN as FiscalRegistrationServiceTokenType,
  IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';

import type { IAutoIssueTriggerService } from './auto-issue-trigger.service.interface';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import type {
  InvoiceTriggerModel,
  TriggerGateOutcome,
} from '../../domain/types/invoice-trigger.types';
import {
  BLOCK_REASON_BY_TRIGGER_MODEL,
  parseTriggerModel,
} from '../../domain/types/invoice-trigger.types';
import { normalizeShippingLineName } from '../../domain/types/shipping-line-label.types';
import { toIssueInvoiceCommand } from '../mappers/order-to-issue-invoice-command.mapper';
import { toSalesDocumentOrderFacts } from '../mappers/order-to-sales-document-order-facts.mapper';
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
    // #2100: read-only, SAME-CONTEXT dependency (both are provided by
    // InvoicingModule), so it neither forms a module cycle nor touches the F3
    // one-way edge — that invariant is specifically about OrdersModule tokens.
    // Used only to answer "does a document already exist for this order?" before
    // reporting a block; see `reportBlock`. Cost note: `parseTriggerModel` defaults
    // to `manual`, which IS a block path, so on an install whose winning
    // connection has no `config.invoicing` every ingestion pays one extra indexed
    // SELECT. That is the price of not re-blocking already-invoiced orders; the
    // conditional UPDATE in `updateSalesDocumentBlock` gives back more than it.
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    // #2173: the country-agnostic rule engine, consulted BEFORE the
    // single-primary resolver — see the file-level docstring point 2. A
    // `sales-documents`-context dependency (zero outbound core-context edges
    // of its own), so this neither forms a module cycle nor touches the F3
    // one-way edge above.
    @Inject(SALES_DOCUMENT_RULES_SERVICE_TOKEN)
    private readonly salesDocumentRules: ISalesDocumentRulesService,
    // Resolved lazily via `resolveFiscalRegistrationService` (review finding
    // 6) — never a constructor-typed `IFiscalRegistrationService`, which
    // would require `FiscalizationModule` and close the
    // `invoicing <-> fiscalization` cycle from the WRONG direction (see
    // `docs/architecture-overview.md`'s dependency map: `FiscalizationModule`
    // imports `InvoicingModule`, never the reverse).
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Lazily resolve `IFiscalRegistrationService`, structurally mirroring
   * `InvoiceService.resolveFiscalRegistrationService` (see that method's own
   * doc comment for why the require is deferred to call time). Returns
   * `null` when `FiscalizationModule` is not wired into this process — the
   * normal case on an install that only uses Invoicing.
   *
   * Deliberately SILENT on the catch, unlike its `InvoiceService` sibling
   * (review finding 1 vs. finding 6 — two different call sites, two
   * different noise budgets): `reportBlock` calls this on EVERY order
   * transition, so a warn-per-call here would log on every single
   * transition for the common "Fiscalization not wired at all" install,
   * which is exactly the log-spam anti-pattern this file's own
   * `shippedViabilityWarned` / `manualWinnerWarned` one-time-diagnostic sets
   * exist to avoid. `InvoiceService`'s copy is called once per issuance
   * attempt — a much smaller noise budget — which is why IT logs.
   */
  private resolveFiscalRegistrationService(): IFiscalRegistrationService | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- lazy require needed to break a CommonJS barrel-load cycle with `@openlinker/core/fiscalization`
      const fiscalization = require('@openlinker/core/fiscalization') as {
        FISCAL_REGISTRATION_SERVICE_TOKEN: typeof FiscalRegistrationServiceTokenType;
      };
      return this.moduleRef.get<IFiscalRegistrationService>(
        fiscalization.FISCAL_REGISTRATION_SERVICE_TOKEN,
        { strict: false },
      );
    } catch {
      return null;
    }
  }

  /**
   * Report a block ONLY if the order does not already have a fiscal document
   * (#2100 review).
   *
   * Without this check the gate is not idempotent against its own effect: a
   * `manual` connection re-reports `trigger-model-manual` on every later
   * transition (shipped, status change, re-poll), so a block would be re-written
   * onto an order that had since been invoiced by hand. That made the aggregate
   * count wrong, filtered rows render with no badge, and the order-detail
   * timeline claim "No invoice issued" directly under the issued invoice.
   *
   * The suppression predicate is the domain's own `blocksIssuanceElsewhere`
   * (#2100 review round 3), NOT a hand-rolled status test. It is already the
   * codebase's canonical answer to "does a document plausibly exist for this
   * order" (`InvoiceService`, `OrderAlreadyInvoicedException`, the issue lock),
   * and it gets the arm a status test gets wrong: an `in-doubt` failure means we
   * do NOT know whether the provider created a document, so persisting "no fiscal
   * document was issued" against it is the fiscally dangerous direction. Only a
   * terminal `rejected` failure — the provider is known to have created nothing —
   * leaves the block standing, because there the configuration problem is still
   * real and clearing it would strip the routing reason from an order whose only
   * remaining signal is a failure that says nothing about the missing primary.
   *
   * `invoicingBlockedBadge` and `resolveSalesDocumentBlockCopy` mirror this rule
   * on the FE, so the reasons the aggregate counts are exactly the reasons a row,
   * a panel and a timeline can explain. They must move together: a block that is
   * counted but suppressed on every surface is a number with no reachable
   * explanation, which is the same silent decline §54 forbids.
   *
   * A read failure yields `indeterminate` rather than a block: with the answer
   * unknown, leaving the persisted value untouched is the only option that can
   * neither invent a reason nor erase a true one.
   *
   * Checks BOTH document kinds (review finding 6 — previously only the
   * invoice projection was read): an order that already has a blocking
   * fiscal-receipt registration must suppress a re-block for the same reason
   * an already-invoiced order does, or a fiscal-receipt candidate blocked for
   * an unrelated reason (e.g. `trigger-model-manual`) on an order that
   * already has a receipt would still report the block instead of `none`.
   * `IFiscalRegistrationService` is resolved lazily (see
   * `resolveFiscalRegistrationService`) since `fiscalization` is not always
   * wired into this process; when it isn't, this half of the check is simply
   * skipped rather than treated as a read failure.
   */
  private async reportBlock(
    block: SalesDocumentBlock,
    orderId: string,
  ): Promise<SalesDocumentBlockOutcome> {
    try {
      const existing = await this.invoices.getLatestInvoiceForOrder(orderId);
      if (existing !== null && existing.blocksIssuanceElsewhere) {
        return { kind: 'none' };
      }

      const fiscalRegistrationService = this.resolveFiscalRegistrationService();
      if (fiscalRegistrationService !== null) {
        const registrations = await fiscalRegistrationService.getByOrderId(orderId);
        if (registrations.some((record) => record.blocksFurtherRegistration)) {
          return { kind: 'none' };
        }
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Could not read the invoice/fiscal-registration projection while reporting a ` +
          `sales-document block; leaving the persisted reason untouched: error=${name} ` +
          `orderId=${orderId} reason=${block.reason}`,
      );
      return { kind: 'indeterminate' };
    }
    return { kind: 'blocked', block };
  }

  async onOrderTransition(
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<SalesDocumentBlockOutcome> {
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
      // NOT a block: no connection can issue a sales document at all, so there
      // is nothing for an operator to unblock on THIS order. Reporting a
      // reason here would badge every order on an install that simply does
      // not do invoicing or fiscalization.
      return { kind: 'none' };
    }

    // `selfRoutesDocumentKind` is hardcoded `false`: per #2158's own doc
    // comment, no adapter in this repo implements `SelfRoutingDocumentKind`
    // yet ("#2158 ships the mechanism, not a first consumer"). Resolving each
    // candidate's adapter here purely to ask a question that can only ever
    // answer `false` today would be a per-order-transition I/O cost with no
    // observable effect; wiring the real per-connection resolution is
    // deferred until a self-routing adapter actually exists to exercise it.
    const candidates: SalesDocumentRoutingCandidate[] = connections.map((connection) => {
      const routing = readSalesDocumentRouting(connection.config);
      return {
        connectionId: connection.id,
        documentKind: routing.documentKind,
        isPrimary: routing.isPrimary,
        enabledCapabilities: connection.enabledCapabilities,
        selfRoutesDocumentKind: false,
      };
    });

    const eligibleCount = candidates.filter((candidate) => candidate.documentKind !== null).length;

    const decision = await this.resolveSalesDocumentDecision(order, candidates, eligibleCount);
    if (decision === null) {
      // Neither the rule engine nor the operator-configured resolver has
      // anything to route with — mirrors the pre-#2173 zero-eligible-candidate
      // short-circuit below, NOT a block, same reasoning as the
      // zero-connections case above.
      return { kind: 'none' };
    }

    switch (decision.kind) {
      case 'unresolved':
        return this.reportUnresolved(decision.reason, candidates, order, sourceEventId);
      case 'aggregate':
        // Reserved outcome (ADR-041 decision 8) — the aggregation window's
        // mechanics are explicitly deferred, and no caller of
        // resolveSalesDocumentRouting can produce this decision today.
        // Defensive-only: if this ever fires it is a forward-compat gap, not
        // a normal outcome, so issue nothing rather than guess. NOT a block
        // (there is no operator-actionable misconfiguration to name) and NOT
        // a clear either (a defect, not a legitimate "nothing to do").
        this.logger.error(
          `Auto-issue skipped: 'aggregate' routing outcome is not implemented; issuing nothing. ` +
            `orderId=${order.id} connectionId=${decision.connectionId} ` +
            `sourceEventId=${sourceEventId ?? 'n/a'}`,
        );
        return { kind: 'indeterminate' };
      case 'route':
        return this.dispatchRoute(decision, connections, eligibleCount, order, sourceConnectionId, sourceEventId);
    }
  }

  /**
   * Resolve EXACTLY ONE `SalesDocumentDecision` (or `null` for "nothing to
   * route with at all") via the #2173 two-step precedence:
   *
   *  1. Build order facts (`toSalesDocumentOrderFacts`) and, when a delivery
   *     country could be determined, call the country-agnostic rule engine
   *     (`ISalesDocumentRulesService.resolveRouting`, #2170). ANY decision
   *     other than `unresolved`/`'no-configuration-for-country'` is returned
   *     AS-IS — a `route`, an `aggregate`, or a different `unresolved` reason
   *     (e.g. `'threshold-currency-mismatch'`) all flow into the SAME
   *     dispatch switch in `onOrderTransition`, which is what makes the
   *     "surface it, never silently fall back" rule automatic rather than a
   *     second thing to remember.
   *  2. Only when the engine reports `'no-configuration-for-country'` — the
   *     operator never touched the rule-engine UI for this order's country —
   *     or when no order facts could be built at all (no delivery address),
   *     fall back to the pre-#2170 `resolveSalesDocumentRouting`. That
   *     resolver's own zero-eligible-candidate short-circuit (mirrored here
   *     via `eligibleCount === 0 → null`) is preserved verbatim, so an
   *     untouched install's behaviour is byte-identical to before #2170
   *     shipped its authoring surface.
   */
  private async resolveSalesDocumentDecision(
    order: Order,
    candidates: readonly SalesDocumentRoutingCandidate[],
    eligibleCount: number,
  ): Promise<SalesDocumentDecision | null> {
    const orderFacts = toSalesDocumentOrderFacts(order);
    if (orderFacts !== null) {
      const ruleDecision = await this.salesDocumentRules.resolveRouting(orderFacts);
      if (!this.isNoConfigurationForCountry(ruleDecision)) {
        return ruleDecision;
      }
    }

    // Fallback: the pre-#2170, `operator-configured` single-primary model.
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
      return null;
    }
    return resolveSalesDocumentRouting(order, candidates);
  }

  /** Narrow a rule-engine decision to "the engine has no configuration at all for this order's country". */
  private isNoConfigurationForCountry(decision: SalesDocumentDecision): boolean {
    return decision.kind === 'unresolved' && decision.reason === 'no-configuration-for-country';
  }

  /**
   * `unresolved` routing outcome (#2156, closing the #2100 persistence gap
   * this dispatcher previously left log-only): persists
   * `'unresolved-routing'` as the gate-block reason with the routing's own
   * `SalesDocumentUnresolvedReason` traveling alongside it as the
   * `unresolvedReason` (ADR-041 §107 — the gate records that it blocked on an
   * unresolved routing decision; the routing reason itself is a routing-
   * vocabulary fact, so it cannot be the gate reason directly).
   *
   * The resolver reports only the REASON, never a breakdown (it is a pure
   * function of the candidate list, not a formatter) — so `detail` is
   * composed here, from the same eligible-candidate list the resolver saw.
   * Wording is carried over verbatim from the pre-#2156, invoice-only gate
   * (#2100): "none marked primary" vs "more than one marked primary" is a
   * materially different operator instruction (add a primary vs remove one),
   * so collapsing both into one generic phrase would make the persisted
   * detail less actionable than before this dispatcher went cross-kind.
   */
  private async reportUnresolved(
    reason: SalesDocumentUnresolvedReason,
    candidates: readonly SalesDocumentRoutingCandidate[],
    order: Order,
    sourceEventId?: string,
  ): Promise<SalesDocumentBlockOutcome> {
    const eligible = candidates.filter((candidate) => candidate.documentKind !== null);
    const candidateIds = eligible.map((candidate) => candidate.connectionId);

    this.logger.error(
      `Auto-issue skipped: sales-document routing unresolved (reason=${reason}) — issuing nothing ` +
        `rather than issuing on an ambiguous or unsupported pick. orderId=${order.id} ` +
        `candidateConnectionIds=${candidateIds.join(',')} sourceEventId=${sourceEventId ?? 'n/a'}. ` +
        `Set config.salesDocument.documentKind and config.invoicing.isPrimary appropriately.`,
    );

    // PII-free detail: a count and the neutral routing reason only. It reaches
    // an operator screen verbatim, so it must never carry buyer data.
    const detail = this.describeUnresolvedDetail(reason, eligible);

    return this.reportBlock(
      { reason: 'unresolved-routing', unresolvedReason: reason, detail },
      order.id,
    );
  }

  /**
   * PII-free elaboration of an `unresolved` decision, for the persisted
   * `SalesDocumentBlock.detail`. `'ambiguous-connection-no-primary'`
   * distinguishes "no primary was set" from "more than one was" — the
   * operator fix is opposite in each case — by recounting primaries among the
   * same eligible candidates the resolver itself considered.
   *
   * The noun is kind-derived from the eligible pool itself (all-`'invoice'`,
   * all-`'fiscal-receipt'`, or a genuine mix), not hardcoded to "invoicing" —
   * this detail is cross-kind since #2156, and a two-Fiscalization-connection
   * ambiguity must not read as if it were about invoicing. The all-invoice
   * wording is unchanged from the pre-#2156 gate for backward-compatible
   * operator copy.
   */
  private describeUnresolvedDetail(
    reason: SalesDocumentUnresolvedReason,
    eligible: readonly SalesDocumentRoutingCandidate[],
  ): string {
    if (reason === 'ambiguous-connection-no-primary') {
      const primaryCount = eligible.filter((candidate) => candidate.isPrimary).length;
      const qualifier = primaryCount === 0 ? 'none marked primary' : 'more than one marked primary';
      const noun = this.describeEligiblePoolNoun(eligible);
      return `${eligible.length} ${noun}, ${qualifier}`;
    }
    return `${eligible.length} sales-document candidates, reason=${reason}`;
  }

  /**
   * Kind-derived noun for {@link describeUnresolvedDetail}'s "N {noun}, …"
   * phrasing: `'invoicing connections'` when every eligible candidate resolves
   * `'invoice'` (unchanged from the pre-#2156 gate), `'fiscal-registration
   * connections'` when every one resolves `'fiscal-receipt'`, and
   * `'sales-document connections'` for a genuine mix or an open-world kind.
   */
  private describeEligiblePoolNoun(eligible: readonly SalesDocumentRoutingCandidate[]): string {
    const kinds = new Set(eligible.map((candidate) => candidate.documentKind));
    if (kinds.size === 1) {
      const [kind] = kinds;
      if (kind === 'invoice') return 'invoicing connections';
      if (kind === 'fiscal-receipt') return 'fiscal-registration connections';
    }
    return 'sales-document connections';
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
  ): Promise<SalesDocumentBlockOutcome> {
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
      // NOT a block, and NOT a clear either: this is a defect, so neither naming a
      // reason the operator cannot act on nor erasing one they can is right.
      return { kind: 'indeterminate' };
    }

    if (decision.documentKind === null) {
      // Self-routing destination (ADR-041 decision 9): reserved in the type,
      // but resolveSalesDocumentRouting's own candidate filter requires either
      // a configured `documentKind` or `selfRoutesDocumentKind: true`
      // (#2158), so a `route` decision with `documentKind: null` means the
      // resolved connection self-routes. No self-routing dispatch is
      // implemented yet on this branch (no adapter declares the capability).
      this.logger.error(
        `Auto-issue skipped: resolved a self-routing decision (documentKind: null), but no ` +
          `self-routing dispatch is implemented; issuing nothing. orderId=${order.id} ` +
          `connectionId=${decision.connectionId} sourceEventId=${sourceEventId ?? 'n/a'}`,
      );
      return { kind: 'indeterminate' };
    }

    if (decision.documentKind === 'invoice') {
      return this.dispatchInvoice(connection, eligibleCount, order, sourceConnectionId, sourceEventId);
    }
    if (decision.documentKind === 'fiscal-receipt') {
      return this.dispatchFiscalReceipt(connection, eligibleCount, order, sourceConnectionId, sourceEventId);
    }

    // Open-world kind (decision 10): core recognizes no dispatch for it. The
    // resolver's structural capability check already passed (an unrecognized
    // kind has no REQUIRED_CAPABILITY entry, so it is never blocked there) —
    // the DEEPER "can this connection actually produce a document of this
    // kind" check is this gate's job, and for an unrecognized kind the honest
    // answer is "not yet" rather than a guess.
    this.logger.error(
      `Auto-issue skipped: connection ${connection.id} resolved to sales-document kind ` +
        `'${decision.documentKind}', which this gate does not know how to dispatch. ` +
        `orderId=${order.id} sourceEventId=${sourceEventId ?? 'n/a'}`,
    );
    return this.reportBlock(
      {
        reason: 'unresolved-routing',
        unresolvedReason: 'unsupported-document-kind-on-connection',
        detail: `connection ${connection.id} resolved to unrecognized kind '${decision.documentKind}'`,
      },
      order.id,
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
  ): Promise<SalesDocumentBlockOutcome> {
    const supported = await this.connectionSupportsInvoiceDocumentType(connection.id);
    if (!supported) {
      this.logger.error(
        `Auto-issue skipped: connection ${connection.id} is routed for 'invoice' but its adapter ` +
          `does not list 'invoice' among its supported document types. orderId=${order.id} ` +
          `sourceEventId=${sourceEventId ?? 'n/a'}`,
      );
      return this.reportBlock(
        {
          reason: 'unresolved-routing',
          unresolvedReason: 'unsupported-document-kind-on-connection',
          detail: `connection ${connection.id} does not list 'invoice' in getSupportedDocumentTypes()`,
        },
        order.id,
      );
    }

    // F9/D11: the selected connection's work is isolated — a compose/enqueue
    // failure never escapes onOrderTransition (the OrderIngestionService catch
    // swallows too, but defense in depth here keeps an invoicing fault from
    // surfacing as an order-ingestion failure).
    try {
      const triggerModel = parseTriggerModel(connection.config.invoicing?.triggerModel);
      this.warnOnceIfManualWinnerDisablesInstall(triggerModel, connection.id, eligibleCount);

      const gate = this.evaluateGate(order, triggerModel, connection.id);
      if (gate.kind === 'waiting') {
        return { kind: 'none' };
      }
      if (gate.kind === 'blocked') {
        return await this.reportBlock({ reason: gate.reason }, order.id);
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
      // Enqueued: report NO block, which is what clears a previously persisted
      // reason once the operator has fixed the configuration. This is the
      // level-triggered half of the clear-on-success rule.
      return { kind: 'none' };
    } catch (error) {
      this.logIssuanceFailure(error, connection.id, order.id, sourceEventId);
      if (error instanceof BatchedTriggerNotImplementedError) {
        // The one error that IS an operator-visible block rather than a fault:
        // OpenLinker cannot group this order into a batch yet, and no retry will
        // change that until the feature ships or the operator picks another model.
        return await this.reportBlock(
          { reason: BLOCK_REASON_BY_TRIGGER_MODEL.batched },
          order.id,
        );
      }
      // Anything else is `indeterminate`, NOT a clear (#2100 review). Three of the
      // four errors this class allow-lists as deterministic and PII-clean
      // (`InvalidBuyerProfileError`, `InvalidInvoiceLineError`,
      // `UnsupportedPriceTreatmentError`) come out of command composition here and
      // will throw identically on every future transition. Clearing on them would
      // erase a true reason — say, the ambiguity the operator has just fixed — and
      // replace it with nothing at all: no invoice, no badge, no count, and no
      // `sync_jobs` row either, because nothing was enqueued. That is the exact
      // silent decline ADR-041 §54 forbids.
      return { kind: 'indeterminate' };
    }
  }

  /**
   * Dispatch the `'fiscal-receipt'` kind (#2156). No adapter-level "which
   * document kinds can this connection produce" discovery exists yet on
   * `FiscalizationPort` (unlike `InvoicingPort.getSupportedDocumentTypes()`),
   * so the resolver's structural check (`Fiscalization` capability enabled)
   * is the whole validation story for this kind today.
   *
   * Mirrors `dispatchInvoice`'s trigger-model gate + block-reporting shape
   * (#2100) so a blocked fiscal-receipt candidate is exactly as
   * operator-visible as a blocked invoice candidate — the persisted reason
   * columns are document-kind-agnostic.
   */
  private async dispatchFiscalReceipt(
    connection: Connection,
    eligibleCount: number,
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<SalesDocumentBlockOutcome> {
    try {
      // Reused verbatim from `config.invoicing.triggerModel` — see the
      // file-level docstring point 4 for why this is deliberate, not an
      // oversight.
      const triggerModel = parseTriggerModel(connection.config.invoicing?.triggerModel);
      this.warnOnceIfManualWinnerDisablesInstall(triggerModel, connection.id, eligibleCount);

      const gate = this.evaluateGate(order, triggerModel, connection.id);
      if (gate.kind === 'waiting') {
        return { kind: 'none' };
      }
      if (gate.kind === 'blocked') {
        return await this.reportBlock({ reason: gate.reason }, order.id);
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
      return { kind: 'none' };
    } catch (error) {
      this.logIssuanceFailure(error, connection.id, order.id, sourceEventId);
      if (error instanceof BatchedTriggerNotImplementedError) {
        return await this.reportBlock(
          { reason: BLOCK_REASON_BY_TRIGGER_MODEL.batched },
          order.id,
        );
      }
      // Same reasoning as dispatchInvoice's catch: InvalidFiscalLineError /
      // UnsupportedFiscalPriceTreatmentError are deterministic and will throw
      // identically on every future transition, so clearing on them would
      // erase a true reason and replace it with nothing at all.
      return { kind: 'indeterminate' };
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
   * (level-evaluated, D3), separating "not yet" from "not without a human"
   * (#2100): `auto-on-paid` / `auto-on-shipped` `proceed` when their condition
   * holds and `waiting` otherwise; `manual` is `blocked`; `batched` throws
   * `BatchedTriggerNotImplementedError`, which the caller's PII-safe catch maps to
   * a `trigger-model-batched` block. For `auto-on-shipped` on a non-shipped order
   * it emits the F7/D6 one-time viability warning (keyed by `connectionId`) so a
   * source that never surfaces `'shipped'` is operator-diagnosable. Reused
   * verbatim for BOTH document kinds (#2156) — the trigger-model vocabulary is
   * document-kind-agnostic.
   */
  private evaluateGate(
    order: Order,
    triggerModel: InvoiceTriggerModel,
    connectionId: string,
  ): TriggerGateOutcome {
    switch (triggerModel) {
      case 'auto-on-paid':
        // D3 level-evaluated: qualifies iff the order is currently paid. An unpaid
        // order is `waiting`, never `blocked` — the next transition re-evaluates it.
        return order.paymentStatus === PAYMENT_STATUS.Paid
          ? { kind: 'proceed' }
          : { kind: 'waiting' };
      case 'auto-on-shipped':
        // D6: honored only where the source surfaces 'shipped' inbound.
        if (order.status === 'shipped') {
          return { kind: 'proceed' };
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
        // `waiting`, not `blocked`, even though the F7 warning above suspects the
        // source may never emit 'shipped': from THIS order's point of view the
        // condition is simply unmet, and the misconfiguration it hints at is a
        // connection-level fact the one-time warning already carries.
        return { kind: 'waiting' };
      case 'manual':
        // A deliberate operator setting, not a fault — but still a block: no
        // invoice will ever be issued for this order without a human acting.
        // ADR-041 lists it in `SalesDocumentGateBlockReasonValues`, so the fact is
        // recorded; rendering keeps it quiet (neutral tone, alongside the
        // "Issue invoice" affordance rather than in place of it).
        return { kind: 'blocked', reason: BLOCK_REASON_BY_TRIGGER_MODEL.manual };
      case 'batched':
        // Deferred to a future issue — rejected cleanly, never silently ignored.
        // Still thrown rather than returned so the existing PII-safe catch keeps
        // logging it; the catch maps it to `trigger-model-batched`.
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
   *
   * `toRegisterTransactionCommand` is required LAZILY, not via a top-level
   * import, for the same reason `InvoiceService.resolveFiscalRegistrationService`
   * does (see that file's doc comment): this file is exported from
   * `@openlinker/core/invoicing`'s barrel BEFORE `InvoicingModule` itself, so a
   * top-level `import ... from '@openlinker/core/fiscalization'` here forces
   * fiscalization's barrel to load mid-way through invoicing's own barrel load
   * — and `fiscalization.module.ts`'s own `import { InvoicingModule } from
   * '@openlinker/core/invoicing'` then lands on invoicing's still-partially
   * -populated exports, capturing `undefined` into `FiscalizationModule`'s
   * `imports` array permanently and crashing `apps/api` / `apps/worker` boot.
   * Deferring the require to call time (well after both barrels have fully
   * loaded via `app.module.ts`'s own top-level imports) breaks the cycle.
   */
  private composeFiscalReceiptPayload(
    order: Order,
    connection: Connection,
    idempotencyKey: string,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): FiscalizationRegisterPayloadV1 {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- lazy require needed to break a CommonJS barrel-load cycle with `@openlinker/core/fiscalization` (see the doc comment above)
    const { toRegisterTransactionCommand } = require('@openlinker/core/fiscalization') as {
      toRegisterTransactionCommand: typeof ToRegisterTransactionCommandType;
    };
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
