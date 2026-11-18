/**
 * Shopify Order Queries
 *
 * GraphQL documents of the OrderSource adapter and of the order status
 * writeback (fulfil, move, cancel), Admin API 2026-10. The writeback's
 * documents are shared with the OrderProcessorManager when it arrives (#3978).
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */

const MAILING_ADDRESS =
  'firstName lastName company address1 address2 city provinceCode zip countryCodeV2 phone';
const MONEY = 'shopMoney { amount currencyCode }';
const TAX_LINE = 'rate ratePercentage title';

const LINE_ITEM_FIELDS = `
      id name sku quantity currentQuantity
      variant { id }
      product { id }
      originalUnitPriceSet { ${MONEY} }
      discountedUnitPriceAfterAllDiscountsSet { ${MONEY} }
      taxLines { ${TAX_LINE} }`;

export const ORDER_FIELDS = `
  id name sourceIdentifier createdAt updatedAt processedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
  email phone note taxesIncluded currencyCode presentmentCurrencyCode
  customer { id }
  currentTotalPriceSet { ${MONEY} }
  currentSubtotalPriceSet { ${MONEY} }
  currentTotalTaxSet { ${MONEY} }
  currentShippingPriceSet { ${MONEY} }
  purchasingEntity {
    __typename
    ... on PurchasingCompany { location { taxSettings { taxRegistrationId } } }
  }
  shippingAddress { ${MAILING_ADDRESS} }
  billingAddress { ${MAILING_ADDRESS} }
  shippingLines(first: 25) {
    nodes { title code originalPriceSet { ${MONEY} } taxLines { ${TAX_LINE} } }
    pageInfo { hasNextPage }
  }
  lineItems(first: 250) {
    nodes {${LINE_ITEM_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
`;

/** The lines past the first 250 of one order, so a large order is ingested whole rather than truncated. */
export const ORDER_LINE_ITEMS_PAGE_QUERY = `query OlOrderLineItemsPage($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 250, after: $after) {
      nodes {${LINE_ITEM_FIELDS}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const ORDER_BY_ID_QUERY = `query OlOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;

/**
 * The order feed. `updated_at` goes through the search index, which lags
 * writes by seconds (L-M1); the adapter compensates with a settle window
 * rather than trusting the index to be current.
 */
/**
 * What the destination copy of an order reports back (`FulfillmentStatusReader`):
 * whether it was cancelled, how far it is fulfilled, and each fulfillment's
 * state, delivery instant and tracking numbers.
 */
export const ORDER_FULFILLMENT_STATUS_QUERY = `query OlOrderFulfillmentStatus($id: ID!) {
  order(id: $id) {
    cancelledAt
    displayFulfillmentStatus
    fulfillments(first: 20) { status displayStatus deliveredAt trackingInfo(first: 5) { number } }
  }
}`;

export const ORDER_FEED_QUERY = `query OlOrderFeed($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    nodes { id createdAt updatedAt cancelledAt }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * The order this shop already holds for an OpenLinker order, by the
 * `sourceIdentifier` the create stamped on it. Goes through the search index,
 * which sees an order only seconds after it was written: a retry finds it, a
 * race does not (core's per-order create lock covers the race).
 */
export const ORDER_BY_SOURCE_IDENTIFIER_QUERY = `query OlOrderBySource($query: String!) {
  orders(first: 1, query: $query) {
    nodes { id name fulfillmentOrders(first: 20) { nodes { id status assignedLocation { location { id } } } } }
  }
}`;

/**
 * Whether each variant ships (its inventory item's `requiresShipping`), read
 * before an order is created: `orderCreate` defaults every line to "no shipping
 * required" (D1), so the line must say it.
 */
export const VARIANTS_REQUIRE_SHIPPING_QUERY = `query OlVariantsRequireShipping($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { requiresShipping } } }
}`;

/**
 * Creates an order (#3978). `orderCreate` has no `@idempotent` support, so the
 * caller dedupes before it (see `ORDER_BY_SOURCE_IDENTIFIER_QUERY`). The
 * created order's fulfillment orders come back so the adapter can move them
 * to the configured location in the same pass.
 */
export const ORDER_CREATE_MUTATION = `mutation OlOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order {
      id name
      fulfillmentOrders(first: 20) { nodes { id status assignedLocation { location { id } } } }
    }
    userErrors { field message }
  }
}`;

export const ORDER_FULFILLMENT_ORDERS_QUERY = `query OlFulfillmentOrders($id: ID!) {
  order(id: $id) {
    id displayFulfillmentStatus cancelledAt
    fulfillmentOrders(first: 20) {
      nodes {
        id status
        assignedLocation { location { id } }
        lineItems(first: 250) { nodes { id remainingQuantity } }
      }
    }
    fulfillments(first: 20) { id status createdAt trackingInfo(first: 5) { number } }
  }
}`;

export const FULFILLMENT_ORDER_MOVE_MUTATION = `mutation OlFulfillmentOrderMove($id: ID!, $locationId: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $locationId) {
    movedFulfillmentOrder { id assignedLocation { location { id } } }
    userErrors { field message }
  }
}`;

export const FULFILLMENT_CREATE_MUTATION = `mutation OlFulfillmentCreate($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment { id status }
    userErrors { field message }
  }
}`;

/**
 * Adds a tracking number to a fulfillment that already exists: a carrier such
 * as InPost assigns the number only after the parcel is dispatched, so the
 * number reaches Shopify after the fulfillment was created without one.
 */
export const FULFILLMENT_TRACKING_INFO_UPDATE_MUTATION = `mutation OlFulfillmentTrackingInfoUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
  fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
    fulfillment { id }
    userErrors { field message }
  }
}`;

/**
 * Cancels an order, restocking it and keeping its payment: `refund: Boolean`
 * is deprecated in 2026-10 and no `refundMethod` is sent, so nothing is
 * refunded (a refund is OpenLinker's own decision, made through
 * `RefundExecutor`). The cancel runs as an async job on Shopify.
 */
/** What the `paid` writeback decides on: whether the order is cancelled and how Shopify books its money. */
export const ORDER_PAYMENT_STATE_QUERY = `query OlOrderPaymentState($id: ID!) {
  order(id: $id) { id cancelledAt displayFinancialStatus }
}`;

/** Records a sale for the order's outstanding amount, on Shopify's own "manual" gateway. */
export const ORDER_MARK_AS_PAID_MUTATION = `mutation OlOrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
  orderMarkAsPaid(input: $input) {
    order { id displayFinancialStatus }
    userErrors { field message }
  }
}`;

export const ORDER_CANCEL_MUTATION = `mutation OlOrderCancel($id: ID!) {
  orderCancel(orderId: $id, reason: OTHER, restock: true, notifyCustomer: false) {
    job { id }
    orderCancelUserErrors { field message code }
  }
}`;

/**
 * What the delivery update needs to know about the copy (#4195): whether it can
 * still be edited, and the note, attributes and shipping lines it carries now.
 */
export const ORDER_DELIVERY_QUERY = `query OlOrderDelivery($id: ID!) {
  order(id: $id) {
    id cancelledAt closedAt displayFulfillmentStatus note
    customAttributes { key value }
    shippingLines(first: 25) { nodes { id title originalPriceSet { ${MONEY} } taxLines { rate } } }
  }
}`;

export const ORDER_EDIT_BEGIN_MUTATION = `mutation OlOrderEditBegin($id: ID!) {
  orderEditBegin(id: $id) {
    calculatedOrder {
      id
      shippingLines { id title price { ${MONEY} } }
    }
    userErrors { field message }
  }
}`;

export const ORDER_EDIT_REMOVE_SHIPPING_LINE_MUTATION = `mutation OlOrderEditRemoveShippingLine($id: ID!, $shippingLineId: ID!) {
  orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) {
    calculatedOrder { id }
    userErrors { field message }
  }
}`;

export const ORDER_EDIT_ADD_SHIPPING_LINE_MUTATION = `mutation OlOrderEditAddShippingLine($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
  orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) {
    calculatedOrder { id }
    userErrors { field message }
  }
}`;

export const ORDER_EDIT_COMMIT_MUTATION = `mutation OlOrderEditCommit($id: ID!, $staffNote: String) {
  orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
    order { id }
    userErrors { field message }
  }
}`;

export const ORDER_UPDATE_MUTATION = `mutation OlOrderUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order { id }
    userErrors { field message }
  }
}`;

/**
 * What the contact refresh needs to know about the copy: whether it can still
 * be edited, and the contact fields it carries now.
 */
export const ORDER_CONTACT_QUERY = `query OlOrderContact($id: ID!) {
  order(id: $id) {
    id cancelledAt closedAt email phone
    shippingAddress {
      firstName lastName company address1 address2 city zip provinceCode countryCodeV2 phone
    }
  }
}`;
