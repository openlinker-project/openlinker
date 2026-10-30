/**
 * Live orders for the G11 suite (#3591)
 *
 * Every order a scenario needs is created in the SOURCE SHOP (PrestaShop via
 * the webservice, WooCommerce via REST) and then waited for through the OL API
 * until ingestion marks it `ready` - never inserted into OL's tables. The one
 * thing a shop cannot do is back-date an order, so a scenario that needs
 * "placed before the cost existed" moves the COST's timestamp instead (see
 * `backdateCostTimestampPastNow` in `cost.ts`), which is the G11-G comparison
 * seen from the other side.
 *
 * @module support/g11
 */
import type { ApiClient } from '../../api/api-client';
import type { OrderRecord, Product, ProductVariant } from '../../api/api.types';
import { WooCommerceRestClient } from '../../api/woocommerce-rest';
import { buildWooCommerceClient } from '../woocommerce-client';
import { waitForOrderByExternalId } from '../orders';
import type { SyncJobs } from '../jobs';
import { synthesizeOrder, type SynthesizedOrder } from '../order-synthesis';
import type { Poller } from '../poller';
import { PlatformType, type World } from '../../world/world';
import { lit, type G11Db } from './db';
import type { G11Setup, G11VariantRef } from './setup';

export interface G11Ctx {
  setup: G11Setup;
  api: ApiClient;
  world: World;
  jobs: SyncJobs;
  poll: Poller;
  db: G11Db;
}

function externalIdOf(
  entity: { externalIds?: Array<{ connectionId: string; externalId: string }> },
  connectionId: string,
): string | undefined {
  return entity.externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

export async function loadDriver(
  ctx: G11Ctx,
  productId: string,
  variantId: string,
): Promise<{ product: Product; variant: ProductVariant }> {
  const product = await ctx.api.products.getById(productId);
  const variants = (await ctx.api.products.listVariants(productId)).items;
  const variant = variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`variant ${variantId} not found on product ${productId}`);
  // The variants list does not carry external ids, and the shop-side order line needs the
  // combination id; read the mapping the same way ingestion resolved it.
  if (!variant.externalIds?.length) {
    const rows = ctx.db.rows<{ externalId: string; connectionId: string }>(
      `SELECT "externalId", "connectionId" FROM identifier_mappings WHERE "entityType" = 'ProductVariant' AND "internalId" = ${lit(variantId)}`,
    );
    variant.externalIds = rows.map((r) => ({ ...r, platformType: '' }));
  }
  return { product, variant };
}

/** One PrestaShop order for `quantity` units of the variant, ingested and `ready`. */
export async function createPrestashopOrder(
  ctx: G11Ctx,
  productId: string,
  ref: G11VariantRef,
  quantity = 1,
): Promise<SynthesizedOrder> {
  const connectionId = ctx.setup.connections.prestashop;
  if (!connectionId) throw new Error('setup.connections.prestashop is not set');
  const ingestConnection = ctx.world
    .connectionsFor(PlatformType.prestashop)
    .find((c) => c.id === connectionId);
  if (!ingestConnection) throw new Error(`PrestaShop connection ${connectionId} is not active on the stack`);
  const driver = await loadDriver(ctx, productId, ref.variantId);
  return synthesizeOrder(
    { api: ctx.api, world: ctx.world, jobs: ctx.jobs, poll: ctx.poll },
    { driver, quantity, ingestConnection },
  );
}

export interface WooOrderResult {
  externalOrderId: string;
  order: OrderRecord;
}

/** One WooCommerce order with one line per entry in `lines`, ingested and `ready`. */
export async function createWooOrder(
  ctx: G11Ctx,
  productId: string,
  lines: Array<{ ref: G11VariantRef; quantity: number }>,
): Promise<WooOrderResult> {
  const connectionId = ctx.setup.connections.woocommerce;
  if (!connectionId) throw new Error('setup.connections.woocommerce is not set');
  const connection = ctx.world.connectionsFor(PlatformType.woocommerce).find((c) => c.id === connectionId);
  const client: WooCommerceRestClient | null = buildWooCommerceClient(connection);
  if (!connection || !client) {
    throw new Error('WooCommerce client unavailable (connection inactive or OL_WC_CONSUMER_KEY/SECRET missing)');
  }
  const product = await ctx.api.products.getById(productId);
  const wcProductId = externalIdOf(product, connectionId);
  if (!wcProductId) throw new Error(`product ${productId} has no WooCommerce id mapped`);
  const variants = (await ctx.api.products.listVariants(productId)).items;
  const lineItems = lines.map(({ ref, quantity }) => {
    const variant = variants.find((v) => v.id === ref.variantId);
    const variationId = variant ? externalIdOf(variant, connectionId) : undefined;
    return {
      productId: Number(wcProductId),
      ...(variationId && variationId !== wcProductId ? { variationId: Number(variationId) } : {}),
      quantity,
    };
  });
  const suffix = Date.now().toString(36);
  const billing = {
    firstName: 'Erik',
    lastName: 'Testowy',
    address1: 'ul. Testowa 1',
    city: 'Warszawa',
    postcode: '00-001',
    country: 'PL',
    email: `e2e-g11-${suffix}@e2e.openlinker.test`,
  };
  const created = await client.createOrder({ billing, lineItems, status: 'processing' });
  const externalOrderId = String(created.id);
  const order = await waitForOrderByExternalId(ctx.api, {
    sourceConnectionId: connectionId,
    externalOrderId,
    timeoutMs: 180_000,
    intervalMs: 3_000,
    retriggerPoll: ctx.jobs.retriggerDirectOrderSync(connectionId, externalOrderId),
  });
  return { externalOrderId, order };
}

/** Re-run `marketplace.order.sync` for an order OL already holds (re-ingestion). */
export async function reingestOrder(ctx: G11Ctx, connectionId: string, externalOrderId: string): Promise<void> {
  const idempotencyKey = await ctx.jobs.trigger({
    connectionId,
    jobType: 'marketplace.order.sync',
    payload: {
      schemaVersion: 1,
      externalOrderId,
      sourceEventId: `${externalOrderId}:e2e-g11-reingest:${Date.now()}`,
    },
  });
  await ctx.jobs.waitForJobByKey(
    { connectionId, jobType: 'marketplace.order.sync', idempotencyKey },
    { timeoutMs: 180_000 },
  );
}
