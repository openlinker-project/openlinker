/**
 * Sales-document ROUTING full-path seed (#3196)
 *
 * Fixture for `tests/sales-documents/routing-full-path.spec.ts`, which walks
 * one order population across all three sales-document epics: the buyer tax
 * number's three states (#2599/#3180), the rule composer's round trip
 * (#2170/#3189/#3190), a receipt AND an invoice held by ONE dual-role
 * connection (ADR-073 decision 3, #3192), the cross-kind refusal that dual
 * role makes reachable (#3184), and an invoice left awaiting submission
 * (#1585/#3192).
 *
 * WHY SQL AT ALL. This package reaches the stack through OL's HTTP API
 * everywhere except the three sales-document seeds, and this is the third for
 * the same reason as the first two (`sales-document-seed.ts`,
 * `sales-document-market-seed.ts`): orders arrive from real ingestion and
 * there is no "create an order" endpoint, so a fabricated order in a market
 * nobody has ordered from is unreachable over HTTP. Two further states share
 * that property — a terminally `registered` fiscal receipt needs a working
 * eparagony session, and `regulatoryStatus: 'pending-submission'` is a
 * degraded-mode window no endpoint lets a caller force.
 *
 * WHAT IS **NOT** SEEDED, deliberately, because the real path exists:
 *   - the routing RULE itself — written through the composer UI by the spec.
 *   - the two cross-kind REFUSALS — driven through `POST /invoices` and
 *     `POST /fiscal-registrations`, which answer a real 409 (#3184).
 *   - the country DEFAULT — set through `PUT /sales-documents/country-defaults`.
 *
 * ONE DUAL-ROLE CONNECTION is the whole point of the fixture: a single
 * `eparagony` connection carrying BOTH `Invoicing` and `Fiscalization`
 * (#3192). That is what makes `InvoiceService.assertNoBlockingFiscalReceipt`'s
 * "no exemption, not even for the requested connection" clause (#3184)
 * reachable at all — with two separate connections the same 409 would prove
 * only the older #2157 cross-connection guard.
 *
 * ORDER SNAPSHOTS ARE ARITHMETICALLY CONSISTENT on purpose:
 * `toRegisterTransactionCommand` runs `assertLinesSumToTotal` and the
 * fiscalization controller composes BEFORE it reaches the 409 guard, so a
 * snapshot whose lines do not sum to `totals.total` would answer 422 and the
 * refusal this fixture exists to prove would never be reached.
 *
 * Country **PT**, chosen so the three sales-document seeds can coexist on one
 * stack: `sales-document-seed.ts` owns PL/DE/CZ and
 * `sales-document-market-seed.ts` owns SE/FI/NO.
 *
 * Idempotent: fixed ids, and every row is deleted before it is written.
 *
 * @module support
 */
// `pg` is CommonJS and this package is ESM, so the named export is not
// reachable through a named import under Node's CJS interop — it resolves to
// `SyntaxError: The requested module 'pg' does not provide an export named
// 'Client'` at load time, before any test runs. The default import is the
// interop form that works.
import pg from 'pg';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';

const { Client } = pg;

/**
 * The dual-role connection. Version(4)/variant(a) nibbles are deliberately
 * valid — the country-default and rule DTOs validate `connectionId` with
 * `@IsUUID()`, which checks the variant bits and not merely the 8-4-4-4-12
 * hex shape (the lesson `sales-document-market-seed.ts` records).
 */
export const ROUTING_SEED_CONNECTION_ID = '44444444-4444-4444-a444-444444444401';

/** Display name — the spec picks this connection out of the composer's select by it. */
export const ROUTING_SEED_CONNECTION_NAME = 'e-paragony Dual Role (3196 seed)';

/** The market this fixture owns end to end. */
export const ROUTING_SEED_COUNTRY = 'PT';

/** A real-shaped Portuguese NIF. Carried verbatim; OL never validates a tax id. */
export const ROUTING_SEED_BUYER_TAX_ID = 'PT501442600';

export const ROUTING_SEED_ORDER_IDS = {
  /** `buyerTaxId` = the id above. Scenario A "asserted". */
  taxIdAsserted: 'ol_order_e2e3196taxidasserted00000',
  /** `buyerTaxId` = `''` — the source positively said the buyer has none. */
  taxIdAssertedNone: 'ol_order_e2e3196taxidnone0000000',
  /** `buyerTaxId` = NULL — the source asserted nothing. */
  taxIdNotAsserted: 'ol_order_e2e3196taxidunknown0000',
  /** Holds a terminally `registered` fiscal receipt on the dual-role connection. */
  receiptIssued: 'ol_order_e2e3196receiptissued000',
  /** Holds an `issued` invoice on the SAME dual-role connection. */
  invoiceIssued: 'ol_order_e2e3196invoiceissued000',
  /** Holds an `issued` invoice stuck at `pending-submission`, backdated. */
  awaitingSubmission: 'ol_order_e2e3196awaitingsubmit00',
} as const;

export type RoutingSeedOrderKey = keyof typeof ROUTING_SEED_ORDER_IDS;

/**
 * How far back the awaiting-submission invoice was issued, so its `Issued`
 * column renders a real elapsed age rather than "today".
 */
export const AWAITING_SUBMISSION_AGE_DAYS = 6;

/**
 * One line at 100.00 plus 10.00 shipping = 110.00 — the equality
 * `assertLinesSumToTotal` checks. Every seeded order shares it, so any of them
 * can be driven at the fiscal-registration endpoint without a 422 standing in
 * front of the 409 the spec is asserting.
 */
function orderSnapshot(orderId: string, customerName: string): string {
  const address = {
    firstName: customerName.split(' ')[0],
    lastName: customerName.split(' ').slice(1).join(' ') || 'Silva',
    address1: 'Rua Augusta 100',
    city: 'Lisboa',
    postcode: '1100-053',
    countryIso2: ROUTING_SEED_COUNTRY,
    country: ROUTING_SEED_COUNTRY,
  };
  return JSON.stringify({
    id: orderId,
    status: 'processing',
    orderNumber: orderId.slice(-8).toUpperCase(),
    customer: { name: customerName },
    customerEmail: 'buyer@example.test',
    billingAddress: address,
    shippingAddress: address,
    channel: 'allegro',
    items: [
      {
        id: `${orderId}-line-1`,
        sku: 'SKU-3196',
        name: 'Routing walkthrough item',
        quantity: 1,
        price: 100.0,
      },
    ],
    totals: { subtotal: 100.0, shipping: 10.0, total: 110.0, currency: 'EUR' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    placedAt: new Date().toISOString(),
  });
}

/**
 * `order_records.buyerTaxId` carries the THREE-state encoding
 * (`libs/core/src/orders/domain/types/buyer-tax-id.types.ts`): `NULL` = the
 * source asserted nothing, `''` = the source asserted the buyer has none, and
 * anything else is the id verbatim. `undefined` here means NULL.
 */
const BUYER_TAX_ID_BY_ORDER: Record<RoutingSeedOrderKey, string | null> = {
  taxIdAsserted: ROUTING_SEED_BUYER_TAX_ID,
  taxIdAssertedNone: '',
  taxIdNotAsserted: null,
  receiptIssued: '',
  invoiceIssued: ROUTING_SEED_BUYER_TAX_ID,
  awaitingSubmission: ROUTING_SEED_BUYER_TAX_ID,
};

const CUSTOMER_BY_ORDER: Record<RoutingSeedOrderKey, string> = {
  taxIdAsserted: 'Ana Ferreira',
  taxIdAssertedNone: 'Bruno Costa',
  taxIdNotAsserted: 'Carla Marques',
  receiptIssued: 'Diogo Pinto',
  invoiceIssued: 'Eva Ribeiro',
  awaitingSubmission: 'Filipe Sousa',
};

function connect(): pg.Client {
  const env = resolveEnv();
  return new Client({ connectionString: env.databaseUrl });
}

/**
 * Seed the dual-role connection, six PT orders, and the two terminal
 * document records plus the awaiting-submission one.
 *
 * Every PT routing row (rules, country defaults, acknowledgments) is CLEARED
 * and none is written — the spec authors them through the real HTTP/UI paths,
 * so a re-run must not leave a previous run's rule behind to collide with the
 * one the composer is about to save.
 */
export async function seedSalesDocumentRoutingFixture(): Promise<void> {
  assertSeedableDatabase('seedSalesDocumentRoutingFixture');
  const client = connect();
  await client.connect();
  try {
    await client.query('BEGIN');

    const orderIds = Object.values(ROUTING_SEED_ORDER_IDS);

    await client.query(`DELETE FROM invoice_records WHERE "orderId" = ANY($1::text[])`, [orderIds]);
    await client.query(`DELETE FROM fiscal_registration_records WHERE "orderId" = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);
    // Rules / defaults / acknowledgments for THIS market only — the spec
    // creates them itself, and a leftover rule from a previous run would make
    // the composer's overlap gate refuse the save the spec is asserting.
    await client.query(`DELETE FROM sales_document_rules WHERE country = $1`, [
      ROUTING_SEED_COUNTRY,
    ]);
    await client.query(`DELETE FROM sales_document_country_defaults WHERE country = $1`, [
      ROUTING_SEED_COUNTRY,
    ]);
    await client.query(`DELETE FROM sales_document_country_acknowledgments WHERE country = $1`, [
      ROUTING_SEED_COUNTRY,
    ]);
    await client.query(`DELETE FROM connections WHERE id = $1::uuid`, [
      ROUTING_SEED_CONNECTION_ID,
    ]);

    // ONE connection, BOTH document lanes (#3192 / ADR-073 decision 3). No
    // `salesDocument.documentKind` is set: routing for this market is decided
    // by the rule the spec writes and by the country default it sets, never by
    // a per-connection primary claim.
    await client.query(
      `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
       VALUES ($1, 'eparagony', $2, 'active', '{}'::jsonb, 'seed-eparagony-dual-3196', '["Invoicing","Fiscalization"]'::jsonb)`,
      [ROUTING_SEED_CONNECTION_ID, ROUTING_SEED_CONNECTION_NAME],
    );

    for (const key of Object.keys(ROUTING_SEED_ORDER_IDS) as RoutingSeedOrderKey[]) {
      const orderId = ROUTING_SEED_ORDER_IDS[key];
      await client.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt",
            "currency", "totalAmount", "buyerTaxId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', now(), 'EUR', 110.00, $4, now(), now())`,
        [
          orderId,
          ROUTING_SEED_CONNECTION_ID,
          orderSnapshot(orderId, CUSTOMER_BY_ORDER[key]),
          BUYER_TAX_ID_BY_ORDER[key],
        ],
      );
    }

    // A terminally REGISTERED fiscal receipt on the dual-role connection.
    // `registered` is terminal (ADR-042) and `blocksFurtherRegistration`, which
    // is what the spec's invoice-side 409 stands on.
    await client.query(
      `INSERT INTO fiscal_registration_records
         (id, "connectionId", "orderId", "providerType", "idempotencyKey", status,
          "providerReference", "documentReference", "registeredAt", artefacts, "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'eparagony', 'e2e3196-receipt-issued', 'registered',
               'e2e3196-provider-ref', 'PAR/2026/09/3196', now(), $3::jsonb, now(), now())`,
      [
        ROUTING_SEED_CONNECTION_ID,
        ROUTING_SEED_ORDER_IDS.receiptIssued,
        JSON.stringify([
          {
            medium: 'link',
            disposition: 'display',
            content: 'https://eparagony.example/r/e2e3196',
            contentType: null,
            label: 'View receipt',
          },
        ]),
      ],
    );

    // An ISSUED invoice on the SAME connection, for a different order — the
    // other half of "one dual-role connection, two document kinds".
    await client.query(
      // `hasBuyerTaxId` AND `buyerTaxId` are both written, and both are needed.
      // They answer different questions and have different readers: the #1202
      // BOOLEAN is what the list's `taxId=with|without` filter selects on, and
      // the #3188 VALUE column is what the row renders. Writing only the value
      // leaves the row visible but unfilterable — which is exactly how a
      // fixture ends up asserting a filter that silently matches nothing.
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status,
          "regulatoryStatus", "buyerTaxId", "hasBuyerTaxId", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'eparagony', 'invoice', 'issued', 'accepted', $3, true,
               now(), now(), now())`,
      [ROUTING_SEED_CONNECTION_ID, ROUTING_SEED_ORDER_IDS.invoiceIssued, ROUTING_SEED_BUYER_TAX_ID],
    );

    // Issued, legally effective, NOT yet transmitted (#1585). Backdated so the
    // list's `Issued` column renders a real age rather than today's date.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status,
          "regulatoryStatus", "buyerTaxId", "hasBuyerTaxId", "providerInvoiceNumber",
          "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'eparagony', 'invoice', 'issued', 'pending-submission', $3, true,
               'FV/3196/AWAIT',
               now() - ($4 || ' days')::interval,
               now() - ($4 || ' days')::interval,
               now() - ($4 || ' days')::interval)`,
      [
        ROUTING_SEED_CONNECTION_ID,
        ROUTING_SEED_ORDER_IDS.awaitingSubmission,
        ROUTING_SEED_BUYER_TAX_ID,
        String(AWAITING_SUBMISSION_AGE_DAYS),
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Stamp `order_records.salesDocumentMatchedRuleId` on an order with the id of a
 * rule the SPEC authored through the composer.
 *
 * It is applied to an order that already CARRIES a document, because the
 * panel's `sales-document-why-kind` disclosure renders inside a filled
 * document slot only — on an order with nothing issued there is no kind to
 * explain, so the disclosure is correctly absent and the hook is unreachable.
 *
 * This is the one attribution the fixture supplies rather than driving,
 * and the divergence is worth stating plainly: the column is written by
 * `AutoIssueTriggerService` on an order TRANSITION, and a transition is
 * produced by real ingestion — no endpoint fires it for an order that already
 * exists. What the stamp buys is the rest of the chain, which is entirely
 * real: the rule row was created by a browser interaction, and
 * `SalesDocumentViewService` resolves this id against the LIVE
 * `sales_document_rules` table to render the operator-facing sentence. A
 * fabricated id would resolve to `null` and render nothing, so the assertion
 * still fails if the rule the composer saved is not genuinely readable.
 */
export async function attributeOrderToRule(orderId: string, ruleId: string): Promise<void> {
  assertSeedableDatabase('attributeOrderToRule');
  const client = connect();
  await client.connect();
  try {
    await client.query(
      `UPDATE order_records SET "salesDocumentMatchedRuleId" = $2 WHERE "internalOrderId" = $1`,
      [orderId, ruleId],
    );
  } finally {
    await client.end();
  }
}
