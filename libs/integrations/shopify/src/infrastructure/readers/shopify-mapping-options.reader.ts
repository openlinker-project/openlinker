/**
 * Shopify Mapping Options Reader
 *
 * The Shopify side of the order mappings (carrier, payment, order status) as
 * `MappingOption`s, for `SourceOptionsReader` on the order source. Every
 * `value` is exactly what the order source puts on an ingested order, or a
 * mapping keyed on it would never match:
 *
 *   - delivery methods: an order's `shipping.methodId` is the shipping line's
 *     `code`, else its `title`. A checkout order on a delivery-profile rate
 *     carries the rate NAME there, so the profile's method definitions are
 *     listed by NAME (their GID never reaches an order). Codes seen on the
 *     shop's recent orders are added, which covers carrier-calculated rates
 *     (an app's own service codes) and orders OpenLinker or a channel created
 *     with a code of their own (the Allegro method UUID, L-S1a). Reading
 *     delivery profiles needs `read_shipping`; without it only the observed
 *     codes are listed.
 *   - payment methods: `sourcePaymentMethod` is the first payment gateway
 *     name; Shopify lists no gateways, so Shopify's own gateway names plus the
 *     ones seen on recent orders are offered.
 *   - order statuses: the neutral status the order source derives (see
 *     `mapShopifyOrderStatus`), labelled with the Shopify states folded into it.
 *
 * @module libs/integrations/shopify/src/infrastructure/readers
 */
import type { MappingOption } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import type { ShopifyConnection } from '../../domain/types/shopify-api.types';
import { SHOPIFY_BANK_DEPOSIT_GATEWAY, SHOPIFY_COD_GATEWAY } from '../../shopify.constants';
import type { ShopifyGraphqlClient } from '../http/shopify-graphql-client';

/** Orders sampled for the codes and gateways a shop actually uses. */
const RECENT_ORDERS = 100;

const DELIVERY_PROFILES_QUERY = `query OlDeliveryProfiles {
  deliveryProfiles(first: 20) {
    nodes {
      name
      profileLocationGroups {
        locationGroupZones(first: 50) {
          nodes {
            zone { name }
            methodDefinitions(first: 50) { nodes { id name active } }
          }
        }
      }
    }
  }
}`;

const RECENT_ORDER_OPTIONS_QUERY = `query OlRecentOrderOptions($first: Int!) {
  orders(first: $first, sortKey: CREATED_AT, reverse: true) {
    nodes {
      paymentGatewayNames
      shippingLines(first: 5) { nodes { code title } }
    }
  }
}`;

interface DeliveryProfilesQuery {
  readonly deliveryProfiles: ShopifyConnection<{
    readonly name: string;
    readonly profileLocationGroups: ReadonlyArray<{
      readonly locationGroupZones: ShopifyConnection<{
        readonly zone: { readonly name: string } | null;
        readonly methodDefinitions: ShopifyConnection<{
          readonly id: string;
          readonly name: string;
          readonly active: boolean;
        }>;
      }>;
    }>;
  }>;
}

interface RecentOrderOptionsQuery {
  readonly orders: ShopifyConnection<{
    readonly paymentGatewayNames: readonly string[];
    readonly shippingLines: ShopifyConnection<{ readonly code: string | null; readonly title: string }>;
  }>;
}

/** Shopify's built-in gateway names; others (Shopify Payments, apps) show up on orders. */
const BUILT_IN_GATEWAYS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'manual', label: 'Manual payment (manual)' },
  { value: SHOPIFY_COD_GATEWAY, label: SHOPIFY_COD_GATEWAY },
  { value: SHOPIFY_BANK_DEPOSIT_GATEWAY, label: SHOPIFY_BANK_DEPOSIT_GATEWAY },
];

/** Neutral status -> the Shopify states that fold into it (mirrors `mapShopifyOrderStatus`). */
const ORDER_STATUS_OPTIONS: readonly MappingOption[] = [
  { value: 'pending', label: 'Pending (Shopify: payment pending or authorized, unfulfilled)' },
  { value: 'processing', label: 'Processing (Shopify: paid, or partially fulfilled)' },
  { value: 'shipped', label: 'Shipped (Shopify: fulfilled)' },
  { value: 'refunded', label: 'Refunded (Shopify: refunded)' },
  { value: 'cancelled', label: 'Cancelled (Shopify: cancelled)' },
];

function nonEmpty(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export class ShopifyMappingOptionsReader {
  private readonly logger = new Logger(ShopifyMappingOptionsReader.name);
  private recentOrdersRead: Promise<RecentOrderOptionsQuery['orders']['nodes']> | null = null;

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
  ) {}

  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve([...ORDER_STATUS_OPTIONS]);
  }

  async listDeliveryMethods(): Promise<MappingOption[]> {
    const options = new Map<string, MappingOption>();
    for (const option of await this.profileMethods()) {
      options.set(option.value, option);
    }
    const recent = await this.recentOrders();
    for (const order of recent) {
      for (const line of order.shippingLines.nodes) {
        const value = nonEmpty(line.code) ?? nonEmpty(line.title);
        if (value !== null && !options.has(value)) {
          const title = nonEmpty(line.title);
          const label =
            title !== null && title !== value ? `${title} (seen on orders, code ${value})` : `${value} (seen on orders)`;
          options.set(value, { value, label });
        }
      }
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  async listPaymentMethods(): Promise<MappingOption[]> {
    const options = new Map<string, MappingOption>(BUILT_IN_GATEWAYS.map((g) => [g.value, { ...g }]));
    for (const order of await this.recentOrders()) {
      for (const gateway of order.paymentGatewayNames) {
        const value = nonEmpty(gateway);
        if (value !== null && !options.has(value)) {
          options.set(value, { value, label: `${value} (seen on orders)` });
        }
      }
    }
    return [...options.values()];
  }

  /** Active delivery-profile methods by name, labelled with their zones; [] when profiles cannot be read. */
  private async profileMethods(): Promise<MappingOption[]> {
    let data: DeliveryProfilesQuery;
    try {
      data = await this.client.query<DeliveryProfilesQuery>(DELIVERY_PROFILES_QUERY);
    } catch (error) {
      this.logger.warn(
        `Shopify delivery profiles could not be read (connection: ${this.connectionId}), listing only ` +
          `methods seen on orders: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
    const zonesByName = new Map<string, Set<string>>();
    for (const profile of data.deliveryProfiles.nodes) {
      for (const group of profile.profileLocationGroups) {
        for (const zone of group.locationGroupZones.nodes) {
          for (const method of zone.methodDefinitions.nodes) {
            const name = nonEmpty(method.name);
            if (name === null || !method.active) {
              continue;
            }
            const zones = zonesByName.get(name) ?? new Set<string>();
            const zoneName = nonEmpty(zone.zone?.name);
            if (zoneName !== null) {
              zones.add(zoneName);
            }
            zonesByName.set(name, zones);
          }
        }
      }
    }
    return [...zonesByName.entries()].map(([name, zones]) => ({
      value: name,
      label: zones.size > 0 ? `${name} (${[...zones].join(', ')})` : name,
    }));
  }

  /** The shop's most recent orders, read once per reader; [] when they cannot be read. */
  private recentOrders(): Promise<RecentOrderOptionsQuery['orders']['nodes']> {
    if (this.recentOrdersRead === null) {
      this.recentOrdersRead = this.client
        .query<RecentOrderOptionsQuery>(RECENT_ORDER_OPTIONS_QUERY, { first: RECENT_ORDERS })
        .then((data) => data.orders.nodes)
        .catch((error: unknown) => {
          this.logger.warn(
            `Shopify recent orders could not be read for mapping options (connection: ${this.connectionId}): ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        });
    }
    return this.recentOrdersRead;
  }
}
