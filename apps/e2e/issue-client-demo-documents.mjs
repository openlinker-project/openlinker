/**
 * Buys the demo parcel's two papers, for real (#3340 follow-up)
 *
 * The companion to `seed-client-demo-order.mjs`. That script writes an order
 * and a fulfilment work; this one issues the invoice and buys the shipping
 * label THROUGH THE ORDINARY API, so both documents are genuine provider
 * round-trips rather than rows someone typed: `POST /invoices` against the
 * live inFakt connection, `POST /shipments/generate-label` against the InPost
 * sandbox.
 *
 * That distinction is the whole point of splitting the two scripts. A demo
 * whose "invoice" is an INSERT proves nothing about invoicing, and the pack
 * bench's documents panel is exactly the surface where the difference shows:
 * it offers a print only when the provider can actually render the document
 * (`bench-documents.service.ts` — clearance `accepted` plus an adapter that
 * narrows to `RegulatoryDocumentReader`), which no hand-written row satisfies.
 *
 * Re-runnable: an order that already holds an issued invoice is refused by
 * the one-document-per-order guard (#2047), and that refusal is reported as
 * "already done" rather than as a failure.
 *
 *   node issue-client-demo-documents.mjs
 */
const API = process.env.OL_DEMO_API ?? 'http://localhost:33000/v1';
const USER = process.env.OL_DEMO_USER ?? 'admin';
const PASS = process.env.OL_DEMO_PASS ?? 'admin';

const ORDER_ID = 'ol_order_clientdemo00000001';

/** A real Kraków locker, so the label is one InPost would actually accept. */
const PACZKOMAT_ID = 'KRA01A';

/** Must match the seed's — it is the routing rule's key, not a label. */
const SHIPPING_METHOD_ID = 'inpost_paczkomat';

const RECIPIENT = {
  name: 'Barbara Nowak',
  email: 'barbara.nowak@example.com',
  phone: '600100200',
  // The house number is its own field — InPost validates the two separately,
  // and a street carrying "Miodowa 7" is refused for having no number.
  address: {
    street: 'Miodowa',
    buildingNumber: '7',
    city: 'Kraków',
    postCode: '30-001',
    countryCode: 'PL',
  },
};

/**
 * A locker parcel is sized by TEMPLATE, not by dimensions — the compartment
 * has fixed sizes and the carrier bills by the one you pick. OpenLinker's own
 * preflight refuses a paczkomat shipment without it
 * (`preflight.missing-parcel-template`) rather than letting InPost reject it
 * later. `small` is InPost's A compartment, 8 x 38 x 64 cm.
 */
const PARCEL = { template: 'small', weightGrams: 1200 };

async function signIn() {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!response.ok) throw new Error(`sign-in failed: ${String(response.status)}`);
  const body = await response.json();
  return body.access_token;
}

async function post(token, path, payload) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function get(token, path) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function pickConnection(token, platformType, capability) {
  // The route takes no pagination at all — `?limit=` is refused as an unknown
  // property — and answers a bare array.
  const { body } = await get(token, '/connections');
  const rows = Array.isArray(body) ? body : (body?.items ?? []);
  const match = rows.find(
    (row) =>
      row.platformType === platformType &&
      row.status === 'active' &&
      (capability === undefined || (row.enabledCapabilities ?? []).includes(capability))
  );
  if (match === undefined) {
    throw new Error(`no active ${platformType} connection with ${capability ?? 'any capability'}`);
  }
  return match;
}

async function issueInvoice(token) {
  const connection = await pickConnection(token, 'infakt', 'Invoicing');
  console.log(`invoice via "${connection.name}" (${connection.id})`);

  const { status, body } = await post(token, '/invoices', {
    connectionId: connection.id,
    orderId: ORDER_ID,
  });

  if (status === 201 || status === 200) {
    console.log(`  issued: ${body.documentNumber ?? body.providerInvoiceNumber ?? '(number pending)'}`);
    console.log(`  status ${body.status} / clearance ${body.regulatoryStatus}`);
    return body;
  }
  if (status === 409) {
    // #2047's guard. Re-running the script is the expected way to reach this.
    console.log('  already invoiced — leaving the existing document alone');
    return null;
  }
  console.log(`  FAILED ${String(status)}: ${JSON.stringify(body).slice(0, 400)}`);
  return null;
}

async function buyLabel(token) {
  // The order's OWN source, never a guess. `ShipmentDispatchService` resolves
  // the carrier from a `fulfillment_routing_rules` row keyed on
  // `(source_connection_id, source_delivery_method_id)`; name a different
  // connection and there is no rule, so it resolves `omp_fulfilled` — the
  // marketplace ships it — answers 200 and mints no label, which reads as a
  // carrier failure and is a routing miss.
  const { body: order } = await get(token, `/orders/${ORDER_ID}`);
  const sourceConnectionId = order?.sourceConnectionId;
  if (typeof sourceConnectionId !== 'string') {
    console.log('  could not read the order\'s source connection — is it seeded?');
    return null;
  }
  console.log(`label via the order's own source (${sourceConnectionId})`);

  const { status, body } = await post(token, '/shipments/generate-label', {
    sourceConnectionId,
    // Named explicitly: the routing rule is keyed on
    // `(source_connection_id, source_delivery_method_id)`, and the resolver
    // does NOT fall back to the order snapshot's own `shipping.methodId`.
    // Omit it and a correctly-routed order still resolves `omp_fulfilled`.
    sourceDeliveryMethodId: SHIPPING_METHOD_ID,
    orderId: ORDER_ID,
    // Carrier-neutral intent (#979). The vocabulary is two values,
    // `pickup_point` | `address` — the carrier's own word for a locker is the
    // adapter's business, not the caller's.
    deliveryIntent: 'pickup_point',
    paczkomatId: PACZKOMAT_ID,
    recipient: RECIPIENT,
    parcel: PARCEL,
  });

  if (status === 200) {
    console.log(`  label: ${body.trackingNumber ?? '(tracking pending)'} — ${body.status}`);
    return body;
  }
  console.log(`  FAILED ${String(status)}: ${JSON.stringify(body).slice(0, 500)}`);
  return null;
}

async function main() {
  const token = await signIn();
  console.log(`order ${ORDER_ID}\n`);

  await issueInvoice(token);
  console.log('');
  await buyLabel(token);

  console.log('\nopen the bench and take the parcel:');
  console.log(`  ${(process.env.OL_DEMO_WEB ?? 'http://localhost:38090')}/bench`);
}

await main();
