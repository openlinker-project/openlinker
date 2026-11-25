/**
 * Order detail visual fixtures (#4286)
 *
 * `GET /orders/:id` responses that reproduce the sample orders of the committed
 * mockup (`docs/plans/mockups/order-detail-v3.html`), so the real page can be
 * rendered with the mockup's own data and compared with it. The tests feed these
 * through `page.route`, so nothing is written to the stack under test and the
 * same text, amounts and dates appear on every run.
 *
 * Only the situations the header rows depend on are modelled: ready to ship,
 * on hold and cancelled. The mockup's own labels (the status pill, the gift
 * line) come from rules this stack may not have, so a difference there is data,
 * not layout.
 *
 * @module support
 */

/** A synthetic shipping connection, so the shipment panel offers a label the way the mockup does. */
export const SHIPPING_CONNECTION_ID = '00000000-0000-4000-8000-0000000000a1';

export function shippingConnection(): Record<string, unknown> {
  return {
    id: SHIPPING_CONNECTION_ID,
    name: 'InPost',
    platformType: 'inpost',
    status: 'active',
    config: {},
    credentialsBacked: true,
    credentialsStored: true,
    enabledCapabilities: ['ShippingProviderManager'],
    supportedCapabilities: ['ShippingProviderManager'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * The channel the sample order came from. It is synthetic on purpose: the header chip and the source row
 * read the connection's name and platform, and taking "the first connection on the stack" made the
 * measured distance from the mockup depend on whichever connection the stack happened to list first.
 */
export const SOURCE_CONNECTION_ID = '00000000-0000-4000-8000-0000000000a2';

export function sourceConnection(): Record<string, unknown> {
  return {
    id: SOURCE_CONNECTION_ID,
    name: 'Allegro (sandbox)',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    credentialsStored: true,
    enabledCapabilities: ['OrderSource'],
    supportedCapabilities: ['OrderSource'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

export type OrderDetailSituation = 'ready' | 'held' | 'cancelled';

/** The instant the page is rendered at, so "1 day ago" and the ship-by state are stable. */
export const FIXED_NOW: Readonly<Record<OrderDetailSituation, string>> = {
  ready: '2026-11-13T18:20:00.000Z',
  held: '2026-11-13T15:30:00.000Z',
  cancelled: '2026-11-14T10:00:00.000Z',
};

interface SituationData {
  mockupHash: string;
  orderId: string;
  number: string;
  firstName: string | null;
  lastName: string | null;
  placedAt: string;
  total: number;
  shipping: number;
  items: Array<{ id: string; sku: string; name: string; price: number; quantity: number }>;
  pickup: { id: string; name: string; description: string };
  dispatchByAt: string;
  cancelledAt: string | null;
  hold: { reason: string; placedByService: string } | null;
}

const DATA: Record<OrderDetailSituation, SituationData> = {
  ready: {
    mockupHash: 'ready',
    orderId: 'ol_order_9a1c7e22c8d44f10a1b73be0d6f2a590',
    number: '9a1c7e22',
    firstName: 'Ewa',
    lastName: 'Lewandowska',
    placedAt: '2026-11-12T18:20:00.000Z',
    total: 127.4,
    shipping: 10.95,
    items: [
      { id: 'l1', sku: '7783019920', name: 'Świeca sojowa Cedr i Mech 220g', price: 49, quantity: 2 },
      { id: 'l2', sku: '7783019931', name: 'Zapach do szafy lawenda', price: 33.45, quantity: 1 },
    ],
    pickup: { id: 'KRA044M', name: 'locker KRA044M', description: 'Chosen by the buyer on Allegro' },
    dispatchByAt: '2026-11-14T23:59:00.000Z',
    cancelledAt: null,
    hold: null,
  },
  held: {
    mockupHash: 'held',
    orderId: 'ol_order_e8a14c706c114f8abb023d9be71ac0d4',
    number: 'e8a14c70',
    firstName: null,
    lastName: null,
    placedAt: '2026-11-11T15:30:00.000Z',
    total: 108.95,
    shipping: 10.95,
    items: [{ id: 'l1', sku: '7786003300', name: 'Mydło naturalne 3-pak', price: 49, quantity: 2 }],
    pickup: { id: 'GDA10M', name: 'locker GDA10M', description: 'Chosen by the buyer on Allegro' },
    dispatchByAt: '2026-11-13T23:59:00.000Z',
    cancelledAt: null,
    hold: { reason: 'fraud-review', placedByService: 'system' },
  },
  cancelled: {
    mockupHash: 'cancelled',
    orderId: 'ol_order_46d41800b1c311f88843c1be75cc2239',
    number: '46d41800',
    firstName: 'Joanna',
    lastName: 'Kamińska',
    placedAt: '2026-09-16T13:39:00.000Z',
    total: 60.94,
    shipping: 10.95,
    items: [
      { id: 'l1', sku: '7781925023', name: 'Handmade Resin Ring with Pressed Botanicals', price: 49.99, quantity: 1 },
    ],
    pickup: { id: 'LUB012M', name: 'locker LUB012M', description: 'Chosen by the buyer on Allegro' },
    dispatchByAt: '2026-09-18T23:59:00.000Z',
    cancelledAt: '2026-09-17T10:02:00.000Z',
    hold: null,
  },
};

export function situationData(situation: OrderDetailSituation): SituationData {
  return DATA[situation];
}

/** A full `OrderRecord` response for the situation. Field names follow `libs/core` order records. */
export function buildOrderRecord(
  situation: OrderDetailSituation,
  sourceConnectionId: string,
): Record<string, unknown> {
  const d = DATA[situation];
  const cancelled = d.cancelledAt !== null;
  return {
    internalOrderId: d.orderId,
    customerId: 'ol_customer_00000000000000000000000000000000',
    sourceConnectionId,
    sourceEventId: '1790290045120987',
    editedInOpenLinker: false,
    editsNeedAttention: false,
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    mappingFailureReason: null,
    salesDocumentBlockReason: null,
    salesDocumentUnresolvedReason: null,
    salesDocumentBlockDetail: null,
    salesDocumentBlockParams: null,
    destinationRoutingBlockReason: null,
    destinationRoutingBlockDetail: null,
    salesDocumentBlockedAt: null,
    salesDocumentBlockReleasedAt: null,
    paymentWriteback: [],
    omsAttention: [],
    createdAt: d.placedAt,
    updatedAt: d.placedAt,
    dispatchByAt: d.dispatchByAt,
    cancelledAt: d.cancelledAt,
    packedAt: null,
    packedByUserId: null,
    hasBuyerNote: false,
    hasBundle: false,
    buyerNoteState: 'none',
    buyerNotePreview: null,
    buyerNoteReadAt: null,
    shippingCountry: 'PL',
    billingCountry: 'PL',
    buyerOrderCount: null,
    lastAmendedAt: null,
    lastAmendmentChanges: null,
    dispatchByEstimated: false,
    fulfillmentState: 'not-shipped',
    slaState: 'ok',
    lifecyclePhase: cancelled ? 'cancelled' : d.hold ? 'on_hold' : 'ready_to_ship',
    sourceDeliveryMethodId: null,
    sourceDeliveryMethodName: 'InPost',
    activeHoldReason: d.hold ? d.hold.reason : null,
    fulfillmentRoutingSkipReason: null,
    fulfillmentBlockReason: null,
    fulfillmentBlockDetail: null,
    paymentMethod: 'online',
    buyerNoteReadByUserId: null,
    buyerNoteChangedAt: null,
    buyerNoteAcknowledgements: [],
    edits: null,
    deliveryResolution: {
      source: 'rule',
      processorKind: 'ol_managed_carrier',
      processorConnectionId: SHIPPING_CONNECTION_ID,
      processorAvailable: true,
      parcelProfile: null,
    },
    deliveryRider: { rider: 'none' },
    reservationShortfalls: [],
    holdHistory: [],
    activeHold: d.hold
      ? {
          id: '00000000-0000-4000-8000-000000000001',
          internalOrderId: d.orderId,
          reason: d.hold.reason,
          note: null,
          placedByUserId: null,
          placedByService: d.hold.placedByService,
          placedAt: d.placedAt,
          releasedAt: null,
        }
      : null,
    salesDocument: {
      orderId: d.orderId,
      documentKind: 'invoice',
      document: null,
      blockReason: null,
      unresolvedReason: null,
      blockDetail: null,
      blockParams: null,
      otherRecords: [],
      matchedRule: null,
      afterIssueAttention: null,
    },
    tagIds: [],
    orderSnapshot: {
      id: d.orderId,
      orderNumber: d.number,
      externalOrderId: d.number,
      status: cancelled ? 'cancelled' : 'processing',
      placedAt: d.placedAt,
      createdAt: d.placedAt,
      updatedAt: d.placedAt,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      deliverySmart: false,
      items: d.items.map((i) => ({ ...i, taxRate: '23', productRef: null })),
      totals: {
        subtotal: Number((d.total - d.shipping).toFixed(2)),
        shipping: d.shipping,
        tax: 0,
        total: d.total,
        currency: 'PLN',
        taxTreatment: 'inclusive',
      },
      shipping: { methodId: 'inpost-locker', methodName: 'InPost' },
      pickupPoint: d.pickup,
      ...(d.firstName
        ? {
            shippingAddress: {
              firstName: d.firstName,
              lastName: d.lastName,
              address1: 'ul. Kwiatowa 5',
              postalCode: '30-001',
              city: 'Kraków',
              country: 'PL',
            },
          }
        : { shippingAddress: { country: 'PL' } }),
      metadata: {},
    },
  };
}
