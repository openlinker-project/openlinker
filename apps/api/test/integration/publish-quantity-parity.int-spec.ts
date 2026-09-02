/**
 * Publish-Quantity Byte-Identity Parity (#2323, ADR-061)
 *
 * The Wave-1b exit criterion: on a single-source, single-location, empty-ledger
 * install, the numbers OpenLinker publishes after the availability rewire are
 * BYTE-IDENTICAL to the numbers it published before it. This suite is the
 * assertion of that claim against real Postgres — a real `connections` row
 * carrying the operator's real `config.stockSafetyBuffer`, the real
 * `AvailabilityService`, and a capturing fake `OfferManagerPort` standing where
 * the marketplace would.
 *
 * **Scope, stated rather than implied.** It drives
 * `InventorySyncService.updateOfferQuantities` — the one shipped path that
 * emits an actual per-offer *payload* (the builders emit commands, whose
 * arithmetic is pinned against the SAME exported fixture by
 * `availability.service.spec.ts`'s `applyPublishControls` matrix and by each
 * builder's own spec through a fake that reads the same connection config).
 * Standing the two builders up here would require a `ProductMaster` stub, a
 * shop stub and a category-resolution fixture per case, for arithmetic three
 * suites already pin — cost without a new guarantee.
 *
 * Three properties are asserted per case, and each is a different failure:
 *   1. the published `quantity` equals the fixture's INDEPENDENT
 *      `expectedPublishedQuantity` (never `computeAtp`, which would assert
 *      only that the function equals itself);
 *   2. the derived `idempotencyKey` is byte-equal to the one the same inputs
 *      produced before the rewire — the key is an opaque `inv:{sha256-16}`
 *      digest over `(connectionId, offerId, quantity, observedAt)` (#2285), so
 *      it is captured and compared, never re-derived;
 *   3. the whole captured payload matches a golden object, so a field added or
 *      dropped in passing is caught rather than only the number.
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  INVENTORY_SYNC_SERVICE_TOKEN,
  type IInventorySyncService,
} from '@openlinker/core/inventory';
import {
  AVAILABILITY_PARITY_CASES,
  toConnectionConfig,
} from '@openlinker/core/inventory/testing';
import type {
  OfferManagerPort,
  UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestAllegroSourceConnection } from './helpers/test-connection.helper';

const PARITY_ADAPTER_KEY = 'parity.test.offer-manager.v1';
const PARITY_PLATFORM_TYPE = 'allegro';

/** Every quantity write the "marketplace" received, in call order. */
const captured: UpdateOfferQuantityCommand[] = [];

/**
 * Seed one active connection carrying the case's raw `stockSafetyBuffer`.
 *
 * The buffer goes into the real JSONB column rather than a mock, so the
 * invalid shapes the fixture carries (`'5'`, `-3`, `NaN`, `2.7`) travel the
 * same coercion path an operator's typo does.
 */
/**
 * A FROZEN copy of the pre-#2323 idempotency-key derivation.
 *
 * Deliberately restated here rather than imported: importing the production
 * helper would make the assertion tautological (it would agree with whatever
 * the code does today), which is the exact hole this closes. This function
 * must never be "kept in sync" with the service — if the two disagree, the
 * PRODUCTION side changed and a published write-back key moved, which is a
 * destination-visible break, not a test to update.
 *
 * The quantity passed in is the POST-buffer one, because that is what feeds
 * the digest.
 */
function goldenPreRewireKey(
  connectionId: string,
  offerId: string,
  postBufferQuantity: number,
  observedAt: string
): string {
  const raw = `inventory:${connectionId}:${offerId}:${postBufferQuantity}:${observedAt}`;
  return `inv:${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

async function seedConnection(
  dataSource: DataSource,
  config: Record<string, unknown>
): Promise<string> {
  const saved = await createTestAllegroSourceConnection(dataSource, {
    adapterKey: PARITY_ADAPTER_KEY,
    platformType: PARITY_PLATFORM_TYPE,
    name: `Parity capture destination ${randomUUID()}`,
    enabledCapabilities: ['OfferManager'],
  });

  // `NaN` does not survive JSON.stringify (it becomes `null`), so the raw
  // value is written through a jsonb cast that preserves what the column can
  // actually hold — matching what an operator's stored config would look like.
  await dataSource.query(`UPDATE connections SET config = $1::jsonb WHERE id = $2`, [
    JSON.stringify(config),
    saved.id,
  ]);

  return saved.id;
}

describe('Publish-quantity byte-identity parity (#2323)', () => {
  let harness: IntegrationTestHarness;
  let inventorySync: IInventorySyncService;

  beforeAll(async () => {
    harness = await getTestHarness();
    inventorySync = harness
      .getApp()
      .get<IInventorySyncService>(INVENTORY_SYNC_SERVICE_TOKEN);

    const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
    const factoryResolver = harness
      .getApp()
      .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

    const capturingAdapter: OfferManagerPort = {
      updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
        captured.push(cmd);
        return Promise.resolve();
      },
    };

    adapterRegistry.register({
      adapterKey: PARITY_ADAPTER_KEY,
      platformType: PARITY_PLATFORM_TYPE,
      supportedCapabilities: ['OfferManager'],
      displayName: 'Capturing OfferManager (parity int-spec)',
      version: '0.0.0-test',
      isDefault: false,
    });
    factoryResolver.registerFactory(PARITY_ADAPTER_KEY, {
      createCapabilityAdapter: <T>(): Promise<T> =>
        Promise.resolve(capturingAdapter as unknown as T),
    });
  });

  beforeEach(() => {
    captured.length = 0;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('the published quantity matches the pre-rewire arithmetic', () => {
    it.each(AVAILABILITY_PARITY_CASES.map((c) => [c.name, c] as const))(
      'publishes the shipped quantity for %s',
      async (_name, testCase) => {
        const dataSource = harness.getDataSource();
        const connectionId = await seedConnection(dataSource, toConnectionConfig(testCase));

        // The write-back path takes a caller-supplied quantity, so feed it the
        // case's summed live stock — the same input the master sync would.
        const masterStock = testCase.rows
          .filter((r) => !r.isStale)
          .reduce((acc, r) => acc + r.availableQuantity, 0);

        const result = await inventorySync.updateOfferQuantities(connectionId, {
          items: [
            { offerId: 'offer-1', quantity: masterStock, observedAt: '2026-08-20T10:00:00.000Z' },
          ],
        });

        expect(result.failed).toEqual([]);
        expect(captured).toHaveLength(1);
        expect(captured[0].quantity).toBe(testCase.expectedPublishedQuantity);
      }
    );
  });

  describe('the derived idempotency key is unchanged', () => {
    it('is byte-equal for the same (connection, offer, quantity, observedAt)', async () => {
      const dataSource = harness.getDataSource();
      const connectionId = await seedConnection(dataSource, { stockSafetyBuffer: 3 });

      await inventorySync.updateOfferQuantities(connectionId, {
        items: [{ offerId: 'offer-1', quantity: 10, observedAt: '2026-08-20T10:00:00.000Z' }],
      });
      const firstKey = captured[0].idempotencyKey;

      captured.length = 0;
      await inventorySync.updateOfferQuantities(connectionId, {
        items: [{ offerId: 'offer-1', quantity: 10, observedAt: '2026-08-20T10:00:00.000Z' }],
      });

      expect(captured[0].idempotencyKey).toBe(firstKey);
      expect(firstKey).toMatch(/^inv:[0-9a-f]{16}$/);

      // Stability alone would pass on ANY formula, including a rewritten one —
      // which is not what "byte-equal to pre-rewire" claims. So the key is also
      // checked against GOLDEN_PRE_REWIRE_KEY, an independent frozen copy of
      // the pre-#2323 derivation (see its docblock). The connection id is the
      // one variable input, so it is threaded in rather than hardcoded; every
      // other term of the golden string is a literal.
      expect(firstKey).toBe(
        goldenPreRewireKey(connectionId, 'offer-1', 7, '2026-08-20T10:00:00.000Z')
      );
    });

    it('changes when the post-buffer quantity changes, because quantity feeds the digest', async () => {
      const dataSource = harness.getDataSource();
      const unbuffered = await seedConnection(dataSource, {});
      const buffered = await seedConnection(dataSource, { stockSafetyBuffer: 3 });

      await inventorySync.updateOfferQuantities(unbuffered, {
        items: [{ offerId: 'offer-1', quantity: 10, observedAt: '2026-08-20T10:00:00.000Z' }],
      });
      await inventorySync.updateOfferQuantities(buffered, {
        items: [{ offerId: 'offer-1', quantity: 10, observedAt: '2026-08-20T10:00:00.000Z' }],
      });

      expect(captured[0].quantity).toBe(10);
      expect(captured[1].quantity).toBe(7);
      expect(captured[0].idempotencyKey).not.toBe(captured[1].idempotencyKey);
    });
  });

  describe('the whole payload is unchanged, not only the number', () => {
    it('matches the golden write-back payload', async () => {
      const dataSource = harness.getDataSource();
      const connectionId = await seedConnection(dataSource, { stockSafetyBuffer: 2 });

      await inventorySync.updateOfferQuantities(connectionId, {
        items: [{ offerId: 'offer-golden', quantity: 9, observedAt: '2026-08-20T10:00:00.000Z' }],
      });

      // Transcribed from the pre-#2323 behaviour: the item is passed through
      // verbatim except for the buffered quantity and the derived key. A field
      // added or dropped in passing fails here even when the number is right.
      expect(captured[0]).toEqual({
        offerId: 'offer-golden',
        quantity: 7,
        observedAt: '2026-08-20T10:00:00.000Z',
        idempotencyKey: expect.stringMatching(/^inv:[0-9a-f]{16}$/) as unknown as string,
      });
    });

    it('honours a caller-supplied idempotency key instead of deriving one', async () => {
      const dataSource = harness.getDataSource();
      const connectionId = await seedConnection(dataSource, { stockSafetyBuffer: 2 });

      await inventorySync.updateOfferQuantities(connectionId, {
        items: [{ offerId: 'offer-1', quantity: 9, idempotencyKey: 'caller-owned-key' }],
      });

      expect(captured[0].idempotencyKey).toBe('caller-owned-key');
      expect(captured[0].quantity).toBe(7);
    });
  });

  /**
   * #1689 — the stale-variant pause writes quantity 0 to stop an offer selling.
   * That zero must survive the Control unchanged: a buffer that could push it
   * anywhere else, or an `unknown` arm that suppressed it, would leave a
   * deleted product's offer live, which is the exact failure #1689 closes.
   */
  describe('the stale-variant pause still publishes 0 (#1689 regression)', () => {
    it.each([
      ['no buffer', {}],
      ['a configured buffer', { stockSafetyBuffer: 5 }],
      ['an invalid buffer', { stockSafetyBuffer: '5' }],
    ])('zeroes the offer with %s', async (_label, config) => {
      const dataSource = harness.getDataSource();
      const connectionId = await seedConnection(dataSource, config);

      await inventorySync.updateOfferQuantity(connectionId, {
        offerId: 'offer-stale',
        quantity: 0,
        observedAt: '2026-08-20T10:00:00.000Z',
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].quantity).toBe(0);
    });
  });
});
