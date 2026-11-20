/**
 * Shopify Order Contact Refresher
 *
 * Carries contact details the source revealed after the order was created to
 * the Shopify copy (`OrderContactRefresher`). A marketplace may show the
 * buyer's phone or e-mail only once the order is paid, so the copy was created
 * without it, and once the order is mapped core skips every later create.
 *
 * FILL, NEVER OVERWRITE: a field is written only while the copy holds none. A
 * value already there may be an operator's hand correction, or Shopify's own
 * normalisation of what was sent (a phone is stored in E.164), so comparing
 * and rewriting would fight both on every re-ingestion. Idempotent by
 * construction: once filled, the next call finds nothing to do and sends
 * nothing. A source value that is blank never clears anything.
 *
 * What `orderUpdate` can carry: `email`, `phone` and the SHIPPING address.
 * The billing address has no field on it, so its phone is out of reach; the
 * order's own `phone` is filled from the same source value the create used
 * (shipping phone first, then billing). The shipping address is re-sent whole
 * with only its phone added: `orderUpdate` replaces it (a partial input is
 * refused for want of a country), so every other field is carried over.
 *
 * Refused, not edited: a copy Shopify no longer has, cancelled, or closed
 * (`ShopifyOrderContactRefusedException`, named reason). Shopify's own
 * validation errors (`Phone is invalid`) surface verbatim through
 * `ShopifyUserErrorsException`; the value is never pre-judged here.
 *
 * The e-mail and phone go in one `orderUpdate` and the shipping address in a second, so a shipping address Shopify will not edit (its country is outside the store's shipping zones) does not hold back the rest.
 *
 * Cost: one read per call (core asks on every re-ingestion of a mapped order),
 * plus one `orderUpdate` only when something is missing.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-processor
 */
import type { OrderCreate } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyOrderContactRefusedException } from '../../../domain/exceptions/shopify-order-contact-refused.exception';
import { toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ORDER_CONTACT_QUERY, ORDER_UPDATE_MUTATION } from '../../readers/shopify-order.queries';

interface OrderContactQuery {
  readonly order: {
    readonly id: string;
    readonly cancelledAt: string | null;
    readonly closedAt: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly shippingAddress: ShippingAddressNode | null;
  } | null;
}

interface ShippingAddressNode {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly company: string | null;
  readonly address1: string | null;
  readonly address2: string | null;
  readonly city: string | null;
  readonly zip: string | null;
  readonly provinceCode: string | null;
  readonly countryCodeV2: string | null;
  readonly phone: string | null;
}

/**
 * `orderUpdate` REPLACES the shipping address with the input it is given (a
 * partial one is refused for want of a country, confirmed live), so the
 * address is sent whole with only its phone changed.
 */
function addressWithPhone(address: ShippingAddressNode, phone: string): Record<string, string> {
  const entries: Array<[string, string | null]> = [
    ['firstName', address.firstName],
    ['lastName', address.lastName],
    ['company', address.company],
    ['address1', address.address1],
    ['address2', address.address2],
    ['city', address.city],
    ['zip', address.zip],
    ['provinceCode', address.provinceCode],
    ['countryCode', address.countryCodeV2],
    ['phone', phone],
  ];
  return Object.fromEntries(entries.filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0));
}

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function clean(value: string | null | undefined): string | undefined {
  return present(value) ? (value as string).trim() : undefined;
}

export class ShopifyOrderContactRefresher {
  private readonly logger = new Logger(ShopifyOrderContactRefresher.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
  ) {}

  async refresh(externalOrderId: string, order: OrderCreate): Promise<void> {
    const email = clean(typeof order.metadata?.buyerEmail === 'string' ? order.metadata.buyerEmail : undefined);
    // The same pairing the create sends as the order's phone.
    const phone = clean(order.shippingAddress?.phone) ?? clean(order.billingAddress?.phone);
    if (email === undefined && phone === undefined) {
      return;
    }

    const id = toShopifyGid('Order', externalOrderId);
    const { order: current } = await this.client.query<OrderContactQuery>(ORDER_CONTACT_QUERY, { id });
    if (current === null) {
      throw new ShopifyOrderContactRefusedException(externalOrderId, 'not-found', 'Shopify no longer has this order');
    }
    if (current.cancelledAt !== null) {
      throw new ShopifyOrderContactRefusedException(externalOrderId, 'cancelled', 'The Shopify order is cancelled');
    }
    if (current.closedAt !== null) {
      throw new ShopifyOrderContactRefusedException(externalOrderId, 'closed', 'The Shopify order is closed');
    }

    const fillEmail = email !== undefined && !present(current.email);
    const fillPhone = phone !== undefined && !present(current.phone);
    const fillShippingPhone =
      phone !== undefined && current.shippingAddress !== null && !present(current.shippingAddress.phone);
    if (!fillEmail && !fillPhone && !fillShippingPhone) {
      return;
    }

    if (fillEmail || fillPhone) {
      await this.client.mutate(
        ORDER_UPDATE_MUTATION,
        { input: { id, ...(fillEmail ? { email } : {}), ...(fillPhone ? { phone } : {}) } },
        'orderUpdate',
      );
    }
    // A separate update, because Shopify refuses ANY edit of the shipping address
    // when its country is outside the store's shipping zones ("Country/region not
    // supported", seen live), and that refusal must not take the e-mail and phone
    // down with it. The refusal is surfaced as it came; the next call retries only
    // what is still missing.
    if (fillShippingPhone && current.shippingAddress !== null && phone !== undefined) {
      await this.client.mutate(
        ORDER_UPDATE_MUTATION,
        { input: { id, shippingAddress: addressWithPhone(current.shippingAddress, phone) } },
        'orderUpdate',
      );
    }
    this.logger.log(
      `Filled contact details on Shopify order ${externalOrderId} ` +
        `[${[fillEmail && 'email', fillPhone && 'phone', fillShippingPhone && 'shipping phone']
          .filter((f): f is string => typeof f === 'string')
          .join(', ')}] (order: ${order.internalOrderId ?? '<unknown>'}, connection: ${this.connectionId})`,
    );
  }
}
