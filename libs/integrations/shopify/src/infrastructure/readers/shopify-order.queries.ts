/**
 * Shopify Order Queries
 *
 * GraphQL documents of the OrderSource adapter and of the order status
 * writeback (fulfil, move, cancel), Admin API 2026-10. The writeback's
 * documents are shared with the OrderProcessorManager when it arrives (#3978).
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */

const MAILING_ADDRESS = 'firstName lastName company address1 address2 city provinceCode zip countryCodeV2 phone';
const MONEY = 'shopMoney { amount currencyCode }';
const TAX_LINE = 'rate ratePercentage title';

export const ORDER_FIELDS = `
  id name createdAt updatedAt processedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
  email phone note taxesIncluded currencyCode
  customer { id }
  currentTotalPriceSet { ${MONEY} }
  currentSubtotalPriceSet { ${MONEY} }
  currentTotalTaxSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  purchasingEntity {
    __typename
    ... on PurchasingCompany { location { taxSettings { taxRegistrationId } } }
  }
  shippingAddress { ${MAILING_ADDRESS} }
  billingAddress { ${MAILING_ADDRESS} }
  shippingLines(first: 5) { nodes { title code originalPriceSet { ${MONEY} } taxLines { ${TAX_LINE} } } }
  lineItems(first: 250) {
    nodes {
      id name sku quantity currentQuantity
      variant { id }
      product { id }
      originalUnitPriceSet { ${MONEY} }
      discountedUnitPriceSet { ${MONEY} }
      taxLines { ${TAX_LINE} }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

export const ORDER_BY_ID_QUERY = `query OlOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;

/**
 * The order feed. `updated_at` goes through the search index, which lags
 * writes by seconds (L-M1); the adapter compensates with a settle window
 * rather than trusting the index to be current.
 */
export const ORDER_FEED_QUERY = `query OlOrderFeed($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    nodes { id createdAt updatedAt cancelledAt }
    pageInfo { hasNextPage endCursor }
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
 * Cancels an order, restocking it and keeping its payment: `refund: Boolean`
 * is deprecated in 2026-10 and no `refundMethod` is sent, so nothing is
 * refunded (a refund is OpenLinker's own decision, made through
 * `RefundExecutor`). The cancel runs as an async job on Shopify.
 */
export const ORDER_CANCEL_MUTATION = `mutation OlOrderCancel($id: ID!) {
  orderCancel(orderId: $id, reason: OTHER, restock: true, notifyCustomer: false) {
    job { id }
    orderCancelUserErrors { field message code }
  }
}`;
