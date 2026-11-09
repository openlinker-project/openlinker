/**
 * Shopify Return Queries
 *
 * GraphQL documents of the `ReturnSourceReader` half of the order source: the
 * return feed (orders that carry a return, with their returns' ids) and the
 * full read of one return.
 *
 * The feed goes through the ORDER search index because the Admin API has no
 * top-level return listing. Two live facts shape it (spike #3928): a return
 * does NOT bump the order's `updatedAt`, so the feed cannot key on it; and
 * the index lags a write by seconds, so a return created a moment ago may
 * miss this lap and is found on the next one.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */

/** Returns read per order on the feed; an order with more is warned about. */
export const SHOPIFY_RETURNS_PER_ORDER = 20;

/** Return lines read per return; a return with more is read in part and warned about. */
export const SHOPIFY_LINES_PER_RETURN = 100;

/**
 * Order `return_status` values that mean "this order has, or had, a return".
 * `in_progress` is verified live; the other three are the remaining
 * non-`no_return` members of `OrderReturnStatus`. `return_status:open` matches
 * nothing (live), so it is not used.
 */
export const SHOPIFY_RETURN_FEED_FILTER =
  '(return_status:return_requested OR return_status:in_progress OR ' +
  'return_status:inspection_complete OR return_status:returned)';

export const RETURN_FEED_QUERY = `query OlReturnFeed($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: ID) {
    nodes {
      id
      returns(first: ${SHOPIFY_RETURNS_PER_ORDER}) {
        nodes { id name status createdAt }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const RETURN_BY_ID_QUERY = `query OlReturn($id: ID!) {
  node(id: $id) {
    __typename
    ... on Return {
      id name status createdAt
      order { id name }
      returnLineItems(first: ${SHOPIFY_LINES_PER_RETURN}) {
        nodes {
          __typename
          id quantity
          ... on ReturnLineItem {
            returnReasonDefinition { handle name } returnReasonNote customerNote
            fulfillmentLineItem {
              lineItem {
                id sku name
                variant { id }
                discountedUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

/** Declines a return still `REQUESTED`; the decline note is never shown to the buyer here. */
export const RETURN_DECLINE_MUTATION = `mutation OlDeclineReturn($input: ReturnDeclineRequestInput!) {
  returnDeclineRequest(input: $input) { return { status } userErrors { code message } }
}`;

/** A return's current status, to tell an already-declined return from a refusal. */
export const RETURN_STATUS_QUERY = `query OlReturnStatus($id: ID!) {
  node(id: $id) { ... on Return { status } }
}`;
