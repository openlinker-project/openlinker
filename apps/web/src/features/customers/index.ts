/**
 * Customers — public surface
 *
 * Public barrel for the customers feature (#609). Cross-feature consumers
 * (today: `features/orders` for the customer card on the order-detail page)
 * import the customer query from here.
 */
export type { CustomerProjection, CustomerProjectionDetail, CustomerAddress } from './api/customers.types';
export { useCustomerQuery } from './hooks/use-customer-query';
