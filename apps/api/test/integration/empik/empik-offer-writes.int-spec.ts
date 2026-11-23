/**
 * Empik Offer Writes Integration Test (#4277)
 *
 * Runs Empik stock and price writes end to end: core's inventory write-back
 * and the quantity-ack reconcile service, the production adapter-resolution
 * seam, the REAL `MiraklOfferManagerAdapter`, `MiraklOfferWriteReconciler`,
 * `MiraklImportTracker` and `MiraklOfferWriteRepository` on real Postgres. Only
 * the Mirakl transport is an in-memory fake, which also refuses any OF24 call.
 *
 * The raw SQL (the partial-index upsert, the version-guarded submit, the
 * per-SKU settle) is the part a unit test cannot prove, so it is asserted here
 * against the table.
 *
 * @module apps/api/test/integration/empik
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  INVENTORY_SYNC_SERVICE_TOKEN,
  type IInventorySyncService,
} from '@openlinker/core/inventory';
import {
  isOfferFieldUpdater,
  isOfferStatusReader,
  OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN,
  type IOfferQuantityAckReconcileService,
  type OfferManagerPort,
} from '@openlinker/core/listings';
import { MiraklOfferWriteOrmEntity } from '@openlinker/integrations-mirakl/infrastructure/persistence/entities/mirakl-offer-write.orm-entity';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  EMPIK_OFFER_MANAGER_TEST_ADAPTER_KEY,
  EMPIK_OFFER_MANAGER_TEST_PLATFORM_TYPE,
  installEmpikOfferManagerHarness,
  type EmpikOfferManagerHarness,
} from '../helpers/empik-test-offer-manager.helper';

describe('Empik Offer Writes Integration (#4277)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let empik: EmpikOfferManagerHarness;
  let connectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    empik = installEmpikOfferManagerHarness(harness);
  });

  beforeEach(async () => {
    connectionId = await seedEmpikConnection(dataSource);
  });

  afterEach(async () => {
    empik.fake.reset();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function writeBack(items: Array<{ offerId: string; quantity: number }>): Promise<unknown> {
    return harness
      .getApp()
      .get<IInventorySyncService>(INVENTORY_SYNC_SERVICE_TOKEN)
      .updateOfferQuantities(connectionId, { items });
  }

  function reconcile(): ReturnType<IOfferQuantityAckReconcileService['reconcile']> {
    return harness
      .getApp()
      .get<IOfferQuantityAckReconcileService>(OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN)
      .reconcile(connectionId, 50);
  }

  function rows(): Promise<MiraklOfferWriteOrmEntity[]> {
    return dataSource
      .getRepository(MiraklOfferWriteOrmEntity)
      .find({ where: { connectionId }, order: { offerSku: 'ASC', createdAt: 'ASC' } });
  }

  async function adapter(): Promise<OfferManagerPort> {
    return harness
      .getApp()
      .get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN)
      .getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager');
  }

  it('O1: a stock change is recorded, not sent, and a newer value replaces an unsent one', async () => {
    await writeBack([{ offerId: 'SKU-1', quantity: 5 }]);
    await writeBack([
      { offerId: 'SKU-1', quantity: 3 },
      { offerId: 'SKU-2', quantity: 0 },
    ]);

    expect(empik.fake.imports).toHaveLength(0);
    expect((await rows()).map((row) => [row.offerSku, row.value, row.status, row.version])).toEqual(
      [
        ['SKU-1', '3', 'pending', 2],
        ['SKU-2', '0', 'pending', 1],
      ]
    );
  });

  it('O2: the reconcile sends one STO01 file and applies it once Mirakl reports it complete', async () => {
    await writeBack([
      { offerId: 'SKU-1', quantity: 3 },
      { offerId: 'SKU-2', quantity: 0 },
    ]);

    await reconcile();

    expect(empik.fake.imports.map((entry) => [entry.importId, entry.path])).toEqual([
      ['imp-1', '/api/offers/stock/imports'],
    ]);
    expect(empik.fake.imports[0].content.split('\n').sort()).toEqual(
      ['', 'SKU-1;3', 'SKU-2;0', 'offer-sku;quantity'].sort()
    );
    expect(
      (await rows()).every((row) => row.status === 'submitted' && row.importId === 'imp-1')
    ).toBe(true);

    empik.fake.setOutcome('imp-1', { status: 'COMPLETE', linesInError: 0 });
    expect(await reconcile()).toMatchObject({ reconciled: 1 });
    expect((await rows()).map((row) => row.status)).toEqual(['applied', 'applied']);
    expect(empik.fake.imports).toHaveLength(1);
  });

  it('O3: a COMPLETE import with an error line fails that offer only', async () => {
    await writeBack([
      { offerId: 'SKU-1', quantity: 3 },
      { offerId: 'SKU-2', quantity: 4 },
    ]);
    await reconcile();
    empik.fake.setOutcome('imp-1', {
      status: 'COMPLETE',
      linesInError: 1,
      errorReport: 'line-number;errors;offer-sku;quantity\n3;The offer does not exist;SKU-2;4\n',
    });

    await reconcile();

    expect((await rows()).map((row) => [row.offerSku, row.status, row.error])).toEqual([
      ['SKU-1', 'applied', null],
      ['SKU-2', 'failed', 'The offer does not exist'],
    ]);
  });

  it('O4: a value recorded after the file was read stays pending and goes in the next file', async () => {
    await writeBack([{ offerId: 'SKU-1', quantity: 3 }]);
    const read = await empik.repository.findPending(connectionId, 'stock', 10);
    await writeBack([{ offerId: 'SKU-1', quantity: 9 }]);

    expect(await empik.repository.markSubmitted(read, 'imp-x')).toBe(0);
    expect((await rows()).map((row) => [row.value, row.status])).toEqual([['9', 'pending']]);
  });

  it('O5: a price is sent through PRI01, alone, and settled from the PRI02 list', async () => {
    const offers = await adapter();
    if (!isOfferFieldUpdater(offers)) throw new Error('not a field updater');

    await offers.updateOfferFields({
      externalOfferId: 'SKU-1',
      fields: { price: { amount: '44.9', currency: 'PLN' } },
    });
    await reconcile();
    empik.fake.setOutcome('imp-1', { status: 'COMPLETE', linesInError: 0 });
    await reconcile();

    expect(empik.fake.imports).toEqual([
      {
        importId: 'imp-1',
        path: '/api/offers/pricing/imports',
        content: 'offer-sku;price\nSKU-1;44.90\n',
      },
    ]);
    expect((await rows()).map((row) => [row.kind, row.status])).toEqual([['price', 'applied']]);
  });

  it('O6: an inactive offer reports its inactivity reasons', async () => {
    empik.fake.putOffer({
      shop_sku: 'SKU-1',
      active: false,
      inactivity_reasons: ['NO_MIN_SHIPPING_RATE'],
      quantity: 5,
      price: 49.99,
      currency_iso_code: 'PLN',
    });
    const offers = await adapter();
    if (!isOfferStatusReader(offers)) throw new Error('not a status reader');

    expect(await offers.getOfferStatus('SKU-1')).toMatchObject({
      publicationStatus: 'inactive',
      validationErrors: [{ code: 'NO_MIN_SHIPPING_RATE', scope: 'account' }],
      commercial: { availableQuantity: 5 },
    });
  });
});

async function seedEmpikConnection(dataSource: DataSource): Promise<string> {
  const credentialsRef = `test-empik-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: EMPIK_OFFER_MANAGER_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(
        key,
        JSON.stringify({ apiKey: 'test-empik-key-not-real' })
      ),
    })
  );
  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: EMPIK_OFFER_MANAGER_TEST_PLATFORM_TYPE,
      name: 'Test Empik offers connection',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: EMPIK_OFFER_MANAGER_TEST_ADAPTER_KEY,
      enabledCapabilities: ['OfferManager'],
    })
  );
  return connection.id;
}
