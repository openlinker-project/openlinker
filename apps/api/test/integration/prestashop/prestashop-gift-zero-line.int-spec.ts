/**
 * A 0,00 gift line on a PrestaShop destination order (#3939)
 *
 * With the OMS off, a gift that exists only in OpenLinker reaches the shop as an
 * ordinary line priced 0,00 and the shop lowers its own stock. This drives that
 * through the real ingestion path (Allegro source stub -> `OrderSyncService` ->
 * `PrestashopOrderProcessorAdapter`) against a real PrestaShop container and
 * records what the shop did: does it keep the 0,00 line, and does its stock move.
 *
 * @module apps/api/test/integration/prestashop
 */
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { createConnection } from 'mysql2/promise';

import type {
  IIdentifierMappingService} from '@openlinker/core/identifier-mapping';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN
} from '@openlinker/core/identifier-mapping';
import type { IOrderIngestionService } from '@openlinker/core/orders';
import { ORDER_INGESTION_SERVICE_TOKEN } from '@openlinker/core/orders';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';

import { describeUnsuccessfulSync, destinationOrderIdFromRef } from '../helpers/order-ref.helper';
import type { IntegrationTestHarness} from '../setup';
import { getTestHarness, resetTestHarness } from '../setup';
import type {
  PrestashopTestContainer} from '../helpers/prestashop-container.helper';
import {
  startSharedPrestashopContainer,
} from '../helpers/prestashop-container.helper';
import type {
  DefaultPrestashopCarriers} from '../helpers/prestashop-fixture.helper';
import {
  getDefaultPsCarriers,
  seedPrestashopProductForOrders,
} from '../helpers/prestashop-fixture.helper';
import type {
  AllegroTestSourceStub} from '../helpers/allegro-test-source-stub.helper';
import {
  installAllegroTestSourceStub,
} from '../helpers/allegro-test-source-stub.helper';
import {
  createTestAllegroSourceConnection,
  createTestPrestashopDestinationConnection,
  deleteTestConnection,
} from '../helpers/test-connection.helper';
import { createIncomingOrderForCarrierMapping } from '../fixtures/incoming-order.fixtures';

const SECRET_ENV = 'OPENLINKER_WEBHOOK_SECRET__PRESTASHOP';

describe('PrestaShop destination: 0,00 gift line (#3939)', () => {
  let harness: IntegrationTestHarness;
  let ps: PrestashopTestContainer;
  let stub: AllegroTestSourceStub;
  let allegroId: string;
  let psConnId: string;
  let carriers: DefaultPrestashopCarriers;

  beforeAll(async () => {
    harness = await getTestHarness();
    ps = await startSharedPrestashopContainer();
    process.env[SECRET_ENV] = ps.webhookSharedSecret;
    carriers = await getDefaultPsCarriers(ps.mysqlAddress);
    stub = installAllegroTestSourceStub(harness);
    allegroId = (
      await createTestAllegroSourceConnection(harness.getDataSource(), {
        adapterKey: stub.adapterKey,
        platformType: stub.platformType,
      })
    ).id;
    psConnId = (
      await createTestPrestashopDestinationConnection(harness.getDataSource(), {
        baseUrl: ps.baseUrl,
        webserviceApiKey: ps.webserviceApiKey,
        defaultCarrierId: carriers.myCheapCarrier.idCarrier,
        enabledCapabilities: ['OrderProcessorManager', 'OrderSource'],
      })
    ).id;
  }, 20 * 60_000);

  afterAll(async () => {
    if (psConnId) await deleteTestConnection(harness.getDataSource(), psConnId);
    await resetTestHarness();
  });

  async function mapProduct(
    reference: string,
    idProduct: number,
    offerId: string
  ): Promise<void> {
    const idm = harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    const internalProductId = await idm.getOrCreateInternalId('Product', String(idProduct), psConnId);
    const internalVariantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
    await idm.createMapping('Offer', offerId, allegroId, internalVariantId);
    await idm.createMapping('ProductVariant', `product:${idProduct}`, psConnId, internalVariantId);
    const ds = harness.getDataSource();
    await ds.getRepository(ProductOrmEntity).save(
      ds.getRepository(ProductOrmEntity).create({
        id: internalProductId,
        name: reference,
        sku: reference,
        price: 50,
        currency: 'PLN',
      })
    );
    await ds.getRepository(ProductVariantOrmEntity).save(
      ds.getRepository(ProductVariantOrmEntity).create({
        id: internalVariantId,
        productId: internalProductId,
        sku: reference,
      })
    );
  }

  it('should keep the gift as its own 0.00 line on the shop order', async () => {
    const paid = await seedPrestashopProductForOrders(ps.mysqlAddress, {
      reference: 'GIFT0-PAID',
      name: 'Gift zero paid product',
      price: 50,
      stockQuantity: 20,
    });
    const gift = await seedPrestashopProductForOrders(ps.mysqlAddress, {
      reference: 'GIFT0-FREE',
      name: 'Gift zero free product',
      price: 5,
      stockQuantity: 20,
    });
    await mapProduct('GIFT0-PAID', paid.idProduct, 'ALG-OFFER-PAID');
    await mapProduct('GIFT0-FREE', gift.idProduct, 'ALG-OFFER-FREE');

    const base = createIncomingOrderForCarrierMapping({
      externalOrderId: 'ALG-GIFT0-1',
      methodId: 'paczkomat-g',
      externalOfferId: 'ALG-OFFER-PAID',
      sku: 'GIFT0-PAID',
      status: 'processing',
      unitPrice: 50,
      shippingTotal: 0,
    });
    stub.setNextIncomingOrder({
      ...base,
      items: [
        ...base.items,
        {
          id: 'ALG-GIFT0-1-gift',
          productRef: { type: 'offer', externalId: 'ALG-OFFER-FREE' },
          quantity: 1,
          price: 0,
          sku: 'GIFT0-FREE',
          name: 'Free gift',
          gift: { source: 'ol-rule' },
        },
      ],
    });

    const ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    const results = await ingestion.syncOrderFromSource(allegroId, 'ALG-GIFT0-1');
    if (results[0]?.status !== 'success') throw new Error(describeUnsuccessfulSync(results[0]));
    const orderId = destinationOrderIdFromRef(results[0].orderRef);

    const sql = await createConnection({ ...ps.mysqlAddress });
    try {
      const [details] = await sql.query<RowDataPacket[]>(
        'SELECT product_reference, product_quantity, unit_price_tax_excl, unit_price_tax_incl, total_price_tax_incl FROM ps_order_detail WHERE id_order = ? ORDER BY product_reference',
        [orderId]
      );
      const [stock] = await sql.query<RowDataPacket[]>(
        'SELECT id_product, quantity FROM ps_stock_available WHERE id_product IN (?, ?) AND id_product_attribute = 0',
        [paid.idProduct, gift.idProduct]
      );
      // The evidence this spec exists to record (#3939).
      // eslint-disable-next-line no-console -- recorded probe output, not logging
      console.warn(`GIFT0_EVIDENCE ${JSON.stringify({ details, stock })}`);

      // The shop keeps the gift as its own order line, which is what its stock
      // bookkeeping and the packing slip need.
      const freeLine = details.find((row) => row.product_reference === 'GIFT0-FREE');
      expect(freeLine).toBeDefined();
      expect(Number(freeLine?.product_quantity)).toBe(1);
      // The 0,00 pin holds: the line is the gift at no charge, not at its
      // catalogue price (5.00). It used to be ignored because the Webservice pin
      // was written with the zero date, which a strict MySQL stores as NULL.
      expect(Number(freeLine?.unit_price_tax_incl)).toBe(0);
      expect(Number(freeLine?.total_price_tax_incl)).toBe(0);
      // The test container does not move stock on order creation at all (the
      // paid line is unchanged too), so the stock effect cannot be shown here.
      expect(stock).toHaveLength(2);
    } finally {
      await sql.end();
    }
  }, 20 * 60_000);
});
