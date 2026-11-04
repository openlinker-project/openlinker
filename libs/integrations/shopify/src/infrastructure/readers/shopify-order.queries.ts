/**
 * Shopify Order Queries
 *
 * GraphQL documents of the OrderSource and OrderProcessorManager adapters.
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
      id name sku quantity
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

/** Lookup by `sourceIdentifier`: also index-backed, so it proves nothing about a write seconds old (L-O4). */
export const ORDER_BY_SOURCE_IDENTIFIER_QUERY = `query OlOrderBySource($query: String!) {
  orders(first: 1, query: $query) { nodes { id name } }
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

export const ORDER_CREATE_MUTATION = `mutation OlOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order {
      id name
      fulfillmentOrders(first: 20) { nodes { id status assignedLocation { location { id } } } }
    }
    userErrors { field message }
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

export const ORDER_CANCEL_MUTATION = `mutation OlOrderCancel($id: ID!) {
  orderCancel(orderId: $id, reason: OTHER, refund: false, restock: true, notifyCustomer: false) {
    job { id }
    orderCancelUserErrors { field message code }
  }
}`;
