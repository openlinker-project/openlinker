/**
 * Sales-Document View Service (#2516, ADR-065)
 *
 * Builds the neutral per-order `SalesDocumentView` for a whole page of orders
 * in a fixed number of queries.
 *
 * Four reads run in parallel - the order records, every invoice record for
 * those orders, every fiscal-registration record for those orders, and the
 * install's sales-document candidate connections - followed by ONE batched
 * routing resolve for the orders that have no document yet. Seven queries for
 * a page of 1 and seven for a page of 200, which is the property the orders
 * list needs (`getEarliestOrderDateByConnection`, #2083, is the precedent).
 *
 * Three rules from ADR-065 are enforced here rather than left to callers:
 *
 * 1. **The persisted reasons travel verbatim.** `blockReason`,
 *    `unresolvedReason` and `blockDetail` are copied off `order_records`
 *    untouched. Nothing in this service re-derives a reason from the order,
 *    and a surface that renders one must render the stored value or nothing.
 * 2. **A fiscal receipt has no authority axis.** The receipt member of
 *    `SalesDocumentRecordView` carries no regulatory field, so this service
 *    physically cannot report a clearance answer for one.
 * 3. **A second record is reported, never hidden.** Records held on a
 *    connection other than the winning document's are surfaced in
 *    `otherRecords` with the write-path guard's own predicate, not a
 *    recomputation of it.
 *
 * WRITES NOTHING: no issuance, no registration, no routing, no configuration.
 * `resolveRoutingBatch` and the candidate read are both projections.
 *
 * @module libs/core/src/orders/application/services
 * @implements {ISalesDocumentViewService}
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
import { Inject, Injectable } from '@nestjs/common';
import { CONNECTION_PORT_TOKEN, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { INVOICE_SERVICE_TOKEN, IInvoiceService } from '@openlinker/core/invoicing';
import type { InvoiceRecord } from '@openlinker/core/invoicing';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';
import type { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import {
  ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  chooseSalesDocumentDecision,
  readSalesDocumentRouting,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentDecision,
  SalesDocumentIdentity,
  SalesDocumentKind,
  SalesDocumentOrderFacts,
  SalesDocumentOtherRecord,
  SalesDocumentRecordView,
  SalesDocumentRoutingCandidate,
  SalesDocumentView,
} from '@openlinker/core/sales-documents';

import type { ISalesDocumentViewService } from '../interfaces/sales-document-view.service.interface';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import { PriceTaxTreatmentValues } from '../../domain/types/order.types';

/** Capability names a connection must enable to be a routing candidate at all. */
const INVOICING_CAPABILITY = 'Invoicing';
const FISCALIZATION_CAPABILITY = 'Fiscalization';

/**
 * One record of either kind, reduced to what ordering and grouping need.
 * `kind` is the discriminant the projection itself carries.
 */
interface RankedRecord {
  readonly orderId: string;
  readonly connectionId: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly view: SalesDocumentRecordView;
  readonly blocksFurtherIssuance: boolean;
}

@Injectable()
export class SalesDocumentViewService implements ISalesDocumentViewService {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecords: OrderRecordRepositoryPort,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscalRegistrations: IFiscalRegistrationService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(SALES_DOCUMENT_RULES_SERVICE_TOKEN)
    private readonly salesDocumentRules: ISalesDocumentRulesService,
  ) {}

  async getForOrders(orderIds: readonly string[]): Promise<Map<string, SalesDocumentView>> {
    const uniqueIds = [...new Set(orderIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const [records, invoiceRecords, fiscalRecords, candidates] = await Promise.all([
      this.orderRecords.findByIds(uniqueIds),
      this.invoices.listInvoicesForOrders(uniqueIds),
      this.fiscalRegistrations.getByOrderIds(uniqueIds),
      this.loadRoutingCandidates(),
    ]);

    const rankedByOrderId = groupRankedRecords(invoiceRecords, fiscalRecords);
    const prospectiveKinds = await this.resolveProspectiveKinds(
      records.filter((record) => !rankedByOrderId.has(record.internalOrderId)),
      candidates,
    );

    const views = new Map<string, SalesDocumentView>();
    for (const record of records) {
      const ranked = rankedByOrderId.get(record.internalOrderId) ?? [];
      const [winner, ...rest] = ranked;
      views.set(record.internalOrderId, {
        orderId: record.internalOrderId,
        documentKind:
          winner?.view.kind ?? prospectiveKinds.get(record.internalOrderId) ?? null,
        document: winner?.view ?? null,
        blockReason: record.salesDocumentBlockReason,
        unresolvedReason: record.salesDocumentUnresolvedReason,
        blockDetail: record.salesDocumentBlockDetail,
        // Only records on a DIFFERENT connection: an older attempt on the
        // winner's own connection is that document's history, not a second
        // document, and `SalesDocumentOtherRecord` describes the latter.
        otherRecords: rest
          .filter((other) => winner !== undefined && other.connectionId !== winner.connectionId)
          .map(toOtherRecord),
      });
    }
    return views;
  }

  /**
   * Which document kind an order with NO record is routed to.
   *
   * Runs the same two-step precedence the auto-issue gate runs
   * (`chooseSalesDocumentDecision`, #2516), over rule data loaded once for the
   * whole batch. It is a claim about ROUTING, never about issuance: an order
   * can be routed to an invoice and still be held, which is what the persisted
   * block reason alongside it says.
   *
   * An order whose analytics scalars are not populated - a record still
   * `awaiting_mapping`, whose snapshot references external ids - yields no
   * facts, so the rule engine is skipped for it exactly as the gate skips it
   * for an order with no delivery country, and only the connection-configured
   * fallback applies.
   */
  private async resolveProspectiveKinds(
    recordsWithoutDocument: readonly OrderRecord[],
    candidates: readonly SalesDocumentRoutingCandidate[],
  ): Promise<Map<string, SalesDocumentKind | null>> {
    const kinds = new Map<string, SalesDocumentKind | null>();
    if (recordsWithoutDocument.length === 0) {
      return kinds;
    }

    const withFacts: { orderId: string; facts: SalesDocumentOrderFacts }[] = [];
    const withoutFacts: string[] = [];
    for (const record of recordsWithoutDocument) {
      const facts = toOrderFacts(record);
      if (facts === null) {
        withoutFacts.push(record.internalOrderId);
      } else {
        withFacts.push({ orderId: record.internalOrderId, facts });
      }
    }

    const ruleDecisions = await this.salesDocumentRules.resolveRoutingBatch(
      withFacts.map((entry) => entry.facts),
    );

    withFacts.forEach((entry, index) => {
      kinds.set(
        entry.orderId,
        toDocumentKind(
          chooseSalesDocumentDecision({ ruleDecision: ruleDecisions[index] ?? null, candidates }),
        ),
      );
    });
    const withoutFactsKind = toDocumentKind(
      chooseSalesDocumentDecision({ ruleDecision: null, candidates }),
    );
    for (const orderId of withoutFacts) {
      kinds.set(orderId, withoutFactsKind);
    }
    return kinds;
  }

  /**
   * The install's sales-document candidate connections, reduced to what the
   * resolve depends on.
   *
   * Mirrors `AutoIssueTriggerService`'s own candidate build, including
   * `selfRoutesDocumentKind: false`: no adapter in this repo declares
   * `SelfRoutingDocumentKind` (#2158 shipped the mechanism, not a consumer),
   * and constructing every candidate's adapter to ask a question that can only
   * answer `false` would turn a list read into per-connection I/O.
   */
  private async loadRoutingCandidates(): Promise<SalesDocumentRoutingCandidate[]> {
    const connections = await this.connections.list({ status: 'active' });
    return connections
      .filter(
        (connection: Connection) =>
          connection.enabledCapabilities.includes(INVOICING_CAPABILITY) ||
          connection.enabledCapabilities.includes(FISCALIZATION_CAPABILITY),
      )
      .map((connection: Connection) => {
        const routing = readSalesDocumentRouting(connection.config);
        return {
          connectionId: connection.id,
          documentKind: routing.documentKind,
          isPrimary: routing.isPrimary,
          enabledCapabilities: connection.enabledCapabilities,
          selfRoutesDocumentKind: false,
        };
      });
  }
}

/**
 * The kind a routing decision names, or `null` when it names none.
 *
 * `unresolved` is `null` because routing did not decide. `aggregate` is `null`
 * too: it names a periodic aggregation, not this order's own document, so
 * reporting a kind for it would claim the order gets a document it does not
 * get. A self-routing `route` carries `documentKind: null` by construction -
 * the destination decides, and OpenLinker does not know which kind that is.
 */
function toDocumentKind(decision: SalesDocumentDecision | null): SalesDocumentKind | null {
  return decision !== null && decision.kind === 'route' ? decision.documentKind : null;
}

/**
 * The routing facts for one order record, or `null` when the record does not
 * carry enough to evaluate against.
 *
 * Reads the denormalized `order_records` scalars (#1985) for the money half
 * and the snapshot's DELIVERY address for the country - the same address
 * `toSalesDocumentOrderFacts` uses, because a discovery or projection reading
 * a different address would name a jurisdiction the evaluator never sees. The
 * country survives PII redaction (`sanitizeAddress` keeps it: a country code
 * is not PII), so this does not vary with `OL_STORE_PII`.
 *
 * `buyerHasTaxId` stays `undefined` for the same reason the gate's mapper
 * leaves it undefined: the order contract carries no such field, and
 * "unknown" must not collapse into "known to have none".
 */
function toOrderFacts(record: OrderRecord): SalesDocumentOrderFacts | null {
  const country = readDeliveryCountry(record.orderSnapshot);
  if (country === null || record.totalAmount === null || record.currency === null) {
    return null;
  }
  return {
    country,
    totalGross: record.totalAmount,
    currency: record.currency,
    ...(isTaxTreatment(record.taxTreatment) ? { taxTreatment: record.taxTreatment } : {}),
    buyerHasTaxId: undefined,
  };
}

function isTaxTreatment(value: unknown): value is 'inclusive' | 'exclusive' {
  return typeof value === 'string' && (PriceTaxTreatmentValues as readonly string[]).includes(value);
}

/** `orderSnapshot.shippingAddress.country`, or `null` when the snapshot carries none. */
function readDeliveryCountry(snapshot: Record<string, unknown>): string | null {
  const shippingAddress = snapshot['shippingAddress'];
  if (typeof shippingAddress !== 'object' || shippingAddress === null) {
    return null;
  }
  const country = (shippingAddress as Record<string, unknown>)['country'];
  if (typeof country !== 'string' || country.trim().length === 0) {
    return null;
  }
  return country;
}

/**
 * Index every record of both kinds by order, newest-first.
 *
 * The head of each list is the order's document; the tail is what
 * `otherRecords` is filtered from. Ordering is `createdAt` DESC then `id` DESC
 * - the same tiebreak `findLatestByOrderId` uses - so the document this
 * projection names is the same row the order-detail invoice panel already
 * shows, and the choice is deterministic when two rows share an instant.
 */
function groupRankedRecords(
  invoiceRecords: readonly InvoiceRecord[],
  fiscalRecords: readonly FiscalRegistrationRecord[],
): Map<string, RankedRecord[]> {
  const byOrderId = new Map<string, RankedRecord[]>();
  const push = (ranked: RankedRecord): void => {
    const existing = byOrderId.get(ranked.orderId);
    if (existing === undefined) {
      byOrderId.set(ranked.orderId, [ranked]);
    } else {
      existing.push(ranked);
    }
  };

  for (const record of invoiceRecords) {
    push(toRankedInvoice(record));
  }
  for (const record of fiscalRecords) {
    push(toRankedFiscal(record));
  }
  for (const ranked of byOrderId.values()) {
    ranked.sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
    );
  }
  return byOrderId;
}

function toRankedInvoice(record: InvoiceRecord): RankedRecord {
  return {
    orderId: record.orderId,
    connectionId: record.connectionId,
    createdAt: record.createdAt,
    id: record.id,
    blocksFurtherIssuance: record.blocksIssuanceElsewhere,
    view: {
      kind: 'invoice',
      documentType: record.documentType,
      status: record.status,
      failureMode: record.failureMode,
      failureCode: record.failureCode,
      failureReason: record.failureReason,
      regulatoryStatus: record.regulatoryStatus,
      clearanceReference: record.clearanceReference,
      identity: toIdentity({
        recordId: record.id,
        connectionId: record.connectionId,
        providerType: record.providerType,
        // OL's own allocated number first, the provider's as the fallback:
        // a document numbered by OpenLinker bears that number, and the
        // provider's is what a provider-numbered document bears.
        documentNumber: record.documentNumber ?? record.providerInvoiceNumber,
        createdAt: record.createdAt,
        completedAt: record.issuedAt,
        inFlightUntil: record.leaseExpiresAt,
      }),
    },
  };
}

function toRankedFiscal(record: FiscalRegistrationRecord): RankedRecord {
  return {
    orderId: record.orderId,
    connectionId: record.connectionId,
    createdAt: record.createdAt,
    id: record.id,
    blocksFurtherIssuance: record.blocksFurtherRegistration,
    view: {
      kind: 'fiscal-receipt',
      status: record.status,
      failureMode: record.failureMode,
      failureReason: record.failureReason,
      // `0` on a registered row is a SUCCESS - a pure reporting regime returns
      // identifiers and no artefact at all.
      artefactCount: record.artefacts?.length ?? 0,
      identity: toIdentity({
        recordId: record.id,
        connectionId: record.connectionId,
        providerType: record.providerType,
        documentNumber: record.documentReference,
        createdAt: record.createdAt,
        completedAt: record.registeredAt,
        inFlightUntil: record.leaseExpiresAt,
      }),
    },
  };
}

/**
 * Normalize the identity fields onto the wire shape: ISO-8601 strings, and an
 * empty provider string reported as `null` rather than as an empty name (a
 * fiscal row carries `''` until the adapter answers).
 */
function toIdentity(input: {
  recordId: string;
  connectionId: string;
  providerType: string;
  documentNumber: string | null;
  createdAt: Date;
  completedAt: Date | null;
  inFlightUntil: Date | null;
}): SalesDocumentIdentity {
  return {
    recordId: input.recordId,
    connectionId: input.connectionId,
    providerType: input.providerType.trim().length === 0 ? null : input.providerType,
    documentNumber: input.documentNumber,
    createdAt: input.createdAt.toISOString(),
    completedAt: input.completedAt?.toISOString() ?? null,
    inFlightUntil: input.inFlightUntil?.toISOString() ?? null,
  };
}

function toOtherRecord(ranked: RankedRecord): SalesDocumentOtherRecord {
  return {
    recordId: ranked.id,
    connectionId: ranked.connectionId,
    kind: ranked.view.kind,
    blocksFurtherIssuance: ranked.blocksFurtherIssuance,
  };
}
