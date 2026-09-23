/**
 * Sales-Document View Service (#2516, ADR-065)
 *
 * Builds the neutral per-order `SalesDocumentView` for a whole page of orders
 * in a fixed number of queries.
 *
 * Three reads run in parallel - the order records, every invoice record for
 * those orders, every fiscal-registration record for those orders - followed,
 * only for the orders that have no document yet, by the install's
 * sales-document candidate connections plus ONE batched routing resolve. Seven
 * queries for a page of 1 and seven for a page of 200, which is the property
 * the orders list needs (`getEarliestOrderDateByConnection`, #2083, is the
 * precedent); a page whose orders all already have a document pays three.
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
import type { InvoiceRecord, InvoiceRecordFilters, InvoiceStatus } from '@openlinker/core/invoicing';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';
import type {
  FiscalRegistrationListFilters,
  FiscalRegistrationRecord,
  FiscalRegistrationStatus,
} from '@openlinker/core/fiscalization';
import {
  ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  chooseSalesDocumentDecision,
  expandSalesDocumentRoutingCandidates,
  readSalesDocumentRouting,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentDecision,
  SalesDocumentIdentity,
  SalesDocumentKind,
  SalesDocumentMatchedRuleView,
  SalesDocumentOrderFacts,
  SalesDocumentOtherRecord,
  SalesDocumentRecordView,
  SalesDocumentRoutingCandidate,
  SalesDocumentRule,
  SalesDocumentView,
} from '@openlinker/core/sales-documents';

import type { ISalesDocumentViewService } from '../interfaces/sales-document-view.service.interface';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import { PriceTaxTreatmentValues } from '../../domain/types/order.types';
import { buyerHasTaxId } from '../../domain/types/buyer-tax-id.types';
import type {
  SalesDocumentListFilters,
  SalesDocumentListItem,
  SalesDocumentListPage,
  SalesDocumentListPagination,
} from '../../domain/types/sales-document-list.types';
import {
  mergeSalesDocumentPages,
  type MergeCandidate,
  type SourcePage,
} from '../../domain/sales-document-page-merge';

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
    return this.buildViews(orderIds, false);
  }

  /**
   * Cross-order operational list (#3306) - see the interface docblock. Four
   * steps: fetch each source's own keyset page (skipping a source the `kind`
   * filter excludes, or one already reported exhausted); merge them with the
   * pure {@link mergeSalesDocumentPages}; batch-resolve the merged page's
   * orders for their amount AND their full sibling-record set (reusing
   * `groupRankedRecords`, the SAME grouping `getForOrders` uses, scoped to
   * just this page's orders rather than a caller-supplied set); assemble the
   * wire shape.
   */
  async listSalesDocuments(
    filters: SalesDocumentListFilters,
    pagination: SalesDocumentListPagination,
  ): Promise<SalesDocumentListPage> {
    const { limit } = pagination;
    const incomingInvoiceCursor = pagination.cursor?.invoice;
    const incomingFiscalCursor = pagination.cursor?.fiscal;

    const wantInvoice = filters.kind !== 'fiscal-receipt' && incomingInvoiceCursor !== null;
    const wantFiscal = filters.kind !== 'invoice' && incomingFiscalCursor !== null;

    const [invoicePage, fiscalPage] = await Promise.all([
      wantInvoice
        ? this.invoices.listInvoicesKeyset(toInvoiceListFilter(filters), {
            limit,
            cursor: incomingInvoiceCursor ?? undefined,
          })
        : Promise.resolve({ items: [], nextCursor: null }),
      wantFiscal
        ? this.fiscalRegistrations.listRegistrationsKeyset(toFiscalListFilter(filters), {
            limit,
            cursor: incomingFiscalCursor ?? undefined,
          })
        : Promise.resolve({ items: [], nextCursor: null }),
    ]);

    type ListSource = 'invoice' | 'fiscal-receipt';
    type ListMergeItem =
      | (MergeCandidate<'invoice'> & { record: InvoiceRecord })
      | (MergeCandidate<'fiscal-receipt'> & { record: FiscalRegistrationRecord });

    const sourcePages: Record<ListSource, SourcePage<ListSource, ListMergeItem>> = {
      invoice: {
        items: invoicePage.items.map((record) => ({
          source: 'invoice' as const,
          createdAt: record.createdAt,
          id: record.id,
          record,
        })),
        ownNextCursor: invoicePage.nextCursor,
      },
      'fiscal-receipt': {
        items: fiscalPage.items.map((record) => ({
          source: 'fiscal-receipt' as const,
          createdAt: record.createdAt,
          id: record.id,
          record,
        })),
        ownNextCursor: fiscalPage.nextCursor,
      },
    };

    const merged = mergeSalesDocumentPages<ListSource, ListMergeItem>(
      sourcePages,
      { invoice: incomingInvoiceCursor, 'fiscal-receipt': incomingFiscalCursor },
      limit,
    );

    const nextCursor = {
      invoice: merged.nextCursor.invoice,
      fiscal: merged.nextCursor['fiscal-receipt'],
    };

    if (merged.items.length === 0) {
      return { items: [], nextCursor };
    }

    const orderIds = [...new Set(merged.items.map((item) => item.record.orderId))];
    const [orderRecords, invoicesForOrders, fiscalForOrders] = await Promise.all([
      this.orderRecords.findByIds(orderIds),
      this.invoices.listInvoicesForOrders(orderIds),
      this.fiscalRegistrations.getByOrderIds(orderIds),
    ]);
    const orderRecordById = new Map(orderRecords.map((record) => [record.internalOrderId, record]));
    // Reuse the SAME grouping `buildViews` uses - the duplicate signal must
    // never be computed a second, possibly-drifting way.
    const rankedByOrderId = groupRankedRecords(invoicesForOrders, fiscalForOrders);

    const items: SalesDocumentListItem[] = merged.items.map((mergedItem) => {
      const ranked =
        mergedItem.source === 'invoice'
          ? toRankedInvoice(mergedItem.record)
          : toRankedFiscal(mergedItem.record);
      const orderId = mergedItem.record.orderId;
      const orderRecord = orderRecordById.get(orderId) ?? null;
      const siblings = rankedByOrderId.get(orderId) ?? [];
      // "Other" = held on any OTHER connection than THIS row's own - a
      // duplicate is a fact about the ORDER, not about which record happens
      // to be this row's "winner" (unlike `otherRecords` on the per-order
      // projection, which is relative to one designated winner).
      const otherRecordCount = siblings.filter(
        (sibling) => sibling.connectionId !== ranked.connectionId,
      ).length;
      return {
        orderId,
        connectionId: ranked.connectionId,
        document: ranked.view,
        amount:
          orderRecord && orderRecord.totalAmount !== null && orderRecord.currency !== null
            ? { value: orderRecord.totalAmount, currency: orderRecord.currency }
            : null,
        otherRecordCount,
      };
    });

    return { items, nextCursor };
  }

  /**
   * The one assembly path behind both reads (#2517). `includeMatchedRule`
   * decides ONLY whether the "Why this kind?" disclosure (#3186) is resolved —
   * a second assembly path would be how the row and the panel stop agreeing
   * about the same order, which is the property `getForOrder`'s own doc comment
   * names.
   *
   * It is off for the list because `matchedRule` is a DETAIL-only disclosure
   * (#3186 review, the #2349/#2350 convention): the paged row renders nothing
   * from it, so resolving it there would put a full conditions array on every
   * row of every page plus one extra `IN (...)` read per page, for a sentence
   * nothing on that surface shows.
   */
  private async buildViews(
    orderIds: readonly string[],
    includeMatchedRule: boolean,
  ): Promise<Map<string, SalesDocumentView>> {
    const uniqueIds = [...new Set(orderIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const [records, invoiceRecords, fiscalRecords] = await Promise.all([
      this.orderRecords.findByIds(uniqueIds),
      this.invoices.listInvoicesForOrders(uniqueIds),
      this.fiscalRegistrations.getByOrderIds(uniqueIds),
    ]);

    const rankedByOrderId = groupRankedRecords(invoiceRecords, fiscalRecords);
    // Routing is only asked about orders that have no document, so a page where
    // every order already has one issues neither the candidate read nor the
    // rule-engine reads.
    const prospectiveKinds = await this.resolveProspectiveKinds(
      records.filter((record) => !rankedByOrderId.has(record.internalOrderId)),
    );
    // The rule (#3186) that decided each order's document kind, batch-loaded
    // ONCE for the whole page rather than one read per row — mirrors
    // `resolveProspectiveKinds`' own batching rationale. Skipped entirely on
    // the list path, which renders none of it.
    const matchedRulesById = includeMatchedRule
      ? await this.loadMatchedRules(records)
      : new Map<string, SalesDocumentMatchedRuleView>();

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
        // `null` covers BOTH "no rule ever decided this order's kind" and "one
        // did, but has since been deleted" — see `SalesDocumentMatchedRuleView`'s
        // own doc comment for why a surface must not tell the two apart. On the
        // list path it additionally means "this read did not resolve it", which
        // is why only the detail surface may render an explanation from it.
        matchedRule:
          !includeMatchedRule || record.salesDocumentMatchedRuleId === null
            ? null
            : (matchedRulesById.get(record.salesDocumentMatchedRuleId) ?? null),
      });
    }
    return views;
  }

  /**
   * Batch-resolve every distinct `salesDocumentMatchedRuleId` on this page of
   * records (#3186) into its {@link SalesDocumentMatchedRuleView} projection, in
   * ONE call to the rule store. A record whose matched rule has since been
   * deleted is simply absent from the returned map — `getForOrders` reads that
   * identically to "no rule ever matched".
   */
  private async loadMatchedRules(
    records: readonly OrderRecord[],
  ): Promise<Map<string, SalesDocumentMatchedRuleView>> {
    const ruleIds = [
      ...new Set(
        records
          .map((record) => record.salesDocumentMatchedRuleId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (ruleIds.length === 0) {
      return new Map();
    }
    const rules = await this.salesDocumentRules.getRulesByIds(ruleIds);
    return new Map(rules.map((rule) => [rule.id, toMatchedRuleView(rule)]));
  }

  async getForOrder(orderId: string): Promise<SalesDocumentView | null> {
    return (await this.buildViews([orderId], true)).get(orderId) ?? null;
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

    const [candidates, ruleDecisions] = await Promise.all([
      this.loadRoutingCandidates(),
      this.salesDocumentRules.resolveRoutingBatch(withFacts.map((entry) => entry.facts)),
    ]);

    withFacts.forEach((entry, index) => {
      kinds.set(
        entry.orderId,
        toDocumentKind(
          chooseSalesDocumentDecision({ ruleDecision: ruleDecisions[index] ?? null, candidates }),
        ),
      );
    });
    if (withoutFacts.length > 0) {
      const withoutFactsKind = toDocumentKind(
        chooseSalesDocumentDecision({ ruleDecision: null, candidates }),
      );
      for (const orderId of withoutFacts) {
        kinds.set(orderId, withoutFactsKind);
      }
    }
    return kinds;
  }

  /**
   * The install's sales-document candidate connections, reduced to what the
   * resolve depends on.
   *
   * Mirrors `AutoIssueTriggerService`'s own candidate build — both call the
   * shared `expandSalesDocumentRoutingCandidates` (#3195), so a dual-role
   * `documentKind: 'both'` connection expands into the identical two rows on
   * both sides — including `selfRoutesDocumentKind: false`: no adapter in this
   * repo declares `SelfRoutingDocumentKind` (#2158 shipped the mechanism, not
   * a consumer), and constructing every candidate's adapter to ask a question
   * that can only answer `false` would turn a list read into per-connection
   * I/O.
   */
  private async loadRoutingCandidates(): Promise<SalesDocumentRoutingCandidate[]> {
    const connections = await this.connections.list({ status: 'active' });
    return connections
      .filter(
        (connection: Connection) =>
          connection.enabledCapabilities.includes(INVOICING_CAPABILITY) ||
          connection.enabledCapabilities.includes(FISCALIZATION_CAPABILITY),
      )
      .flatMap((connection: Connection) => {
        const routing = readSalesDocumentRouting(connection.config);
        return expandSalesDocumentRoutingCandidates({
          connectionId: connection.id,
          documentKind: routing.documentKind,
          isPrimary: routing.isPrimary,
          enabledCapabilities: connection.enabledCapabilities,
          selfRoutesDocumentKind: false,
        });
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
 * `buyerHasTaxId` is read off the record's own three-state buyer tax id
 * (#2599) through the SAME `buyerHasTaxId` helper the gate's mapper uses, so
 * the projection and the gate answer a `buyerHasTaxId` rule identically.
 * `undefined` (the source asserted nothing) never collapses into `false` (the
 * source asserted the buyer has none) - `buyerTaxIdState` is the only intended
 * read of the column, because a bare `!== null` test reports true for the
 * asserted-none row.
 *
 * `taxTreatment` reads `record.totalTaxTreatment ?? record.taxTreatment`
 * (#2829/#2832), the SAME fallback `toSalesDocumentOrderFacts` applies from
 * the live `Order` - this is the `totalGross` field's own inclusivity, which
 * can diverge from the line-price/subtotal `taxTreatment` (a PrestaShop order
 * prices lines net but its total gross). Reading `record.taxTreatment` alone
 * here would report every PrestaShop order as `net-priced` to the operator
 * while the gate itself resolves it as gross, and the two must agree - see
 * the country-address comment above, whose argument binds identically here.
 */
function toOrderFacts(record: OrderRecord): SalesDocumentOrderFacts | null {
  const country = readDeliveryCountry(record.orderSnapshot);
  if (country === null || record.totalAmount === null || record.currency === null) {
    return null;
  }
  const totalTaxTreatment = record.totalTaxTreatment ?? record.taxTreatment;
  return {
    country,
    totalGross: record.totalAmount,
    currency: record.currency,
    ...(isTaxTreatment(totalTaxTreatment) ? { taxTreatment: totalTaxTreatment } : {}),
    buyerHasTaxId: buyerHasTaxId(record.buyerTaxIdState),
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

/** Reduce a full `SalesDocumentRule` to what the "Why this kind?" disclosure renders (#3186). */
function toMatchedRuleView(rule: SalesDocumentRule): SalesDocumentMatchedRuleView {
  return {
    id: rule.id,
    country: rule.country,
    conditions: rule.conditions,
    documentKind: rule.documentKind,
    connectionId: rule.connectionId,
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

/**
 * Project the merged list's neutral filters onto invoicing's own shape
 * (#3306). `status` is passed through with an unsafe cast rather than
 * validated against `InvoiceStatus` here - a value naming a fiscal-only
 * status simply matches no invoice row, which is the documented,
 * accepted behaviour (`SalesDocumentListFilters`'s own doc comment).
 */
function toInvoiceListFilter(filters: SalesDocumentListFilters): InvoiceRecordFilters {
  return {
    status: filters.status as InvoiceStatus | undefined,
    connectionId: filters.connectionId,
    issuedFrom: filters.issuedFrom,
    issuedTo: filters.issuedTo,
    taxId: filters.taxId,
    search: filters.search,
  };
}

/** The fiscal-side counterpart of {@link toInvoiceListFilter}. */
function toFiscalListFilter(filters: SalesDocumentListFilters): FiscalRegistrationListFilters {
  return {
    status: filters.status as FiscalRegistrationStatus | undefined,
    connectionId: filters.connectionId,
    createdFrom: filters.issuedFrom,
    createdTo: filters.issuedTo,
    search: filters.search,
  };
}
